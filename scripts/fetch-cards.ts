/**
 * Builds `data/cards.json` — the Duel Links card pool — from two upstreams.
 *
 * duellinksmeta.com decides which cards are in the game (it carries a real
 * per-card Duel Links release date); YGOPRODeck supplies the printed detail.
 * See `scripts/lib/duel-links-pool.ts` for why it takes both.
 *
 * Both sources ask consumers to cache locally rather than call repeatedly, so
 * this runs weekly in CI and never from the app.
 *
 *   npm run fetch:cards
 */
import {
  cardsPath,
  isMain,
  readJsonIfExists,
  reportToCi,
  USER_AGENT,
  writeJson,
} from "./lib/paths.ts";
import { isPathAllowed } from "./lib/robots.ts";
import {
  assertPoolSane,
  isReleased,
  mergePool,
  PoolError,
  type DlmCard,
  type YgoCard,
} from "./lib/duel-links-pool.ts";
import type { CardFile } from "../src/data/types.ts";

const YGO_DUEL_LINKS = "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=duel%20links";
const YGO_ALL = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const DLM_ORIGIN = "https://www.duellinksmeta.com";
const DLM_PATH = "/api/v1/cards";
const DLM_ROBOTS = `${DLM_ORIGIN}/robots.txt`;
const DLM_PAGE_SIZE = 3000;
/** The endpoint is ~18k rows; this only exists so a pagination bug cannot spin. */
const DLM_MAX_PAGES = 40;

export {
  isExtraDeckType,
  projectCard,
  synthesizeType,
  projectFromDlm,
  mergePool,
  assertPoolSane,
} from "./lib/duel-links-pool.ts";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function fetchYgoprodeck(url: string, label: string): Promise<YgoCard[]> {
  console.log(`Fetching ${url}`);
  const payload = await getJson<{ data?: YgoCard[] }>(url);
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new PoolError(`YGOPRODeck returned no ${label} data — refusing to overwrite cards.json`);
  }
  return payload.data;
}

/** duellinksmeta paginates; walk until a short page comes back. */
async function fetchDuelLinksMeta(): Promise<DlmCard[]> {
  const robots = await fetch(DLM_ROBOTS, { headers: { "User-Agent": USER_AGENT } });
  if (robots.ok) {
    if (!isPathAllowed(await robots.text(), DLM_PATH)) {
      throw new PoolError(`robots.txt disallows ${DLM_PATH} — not fetching.`);
    }
  } else {
    console.warn(`Could not read robots.txt (${robots.status}); proceeding with the documented allowance.`);
  }

  const all: DlmCard[] = [];
  for (let page = 1; page <= DLM_MAX_PAGES; page++) {
    const url = `${DLM_ORIGIN}${DLM_PATH}?limit=${DLM_PAGE_SIZE}&page=${page}`;
    const batch = await getJson<DlmCard[]>(url);
    if (!Array.isArray(batch)) throw new PoolError(`duellinksmeta page ${page} was not an array.`);
    all.push(...batch);
    if (batch.length < DLM_PAGE_SIZE) break;
  }
  if (all.length === 0) {
    throw new PoolError("duellinksmeta returned no cards — refusing to overwrite cards.json");
  }
  console.log(`Fetched ${DLM_ORIGIN}${DLM_PATH}: ${all.length} rows`);
  return all;
}

function list(names: string[], limit = 20): string {
  const head = names.slice(0, limit).join(", ");
  return names.length > limit ? `${head}, … (+${names.length - limit})` : head;
}

function details(summary: string, names: string[]): string {
  if (names.length === 0) return "";
  return `\n<details><summary>${summary}</summary>\n\n${names.map((n) => `- ${n}`).join("\n")}\n\n</details>`;
}

async function main(): Promise<void> {
  const [duelLinksFlagged, everything, dlmAll] = await Promise.all([
    fetchYgoprodeck(YGO_DUEL_LINKS, "Duel Links"),
    fetchYgoprodeck(YGO_ALL, "full database"),
    fetchDuelLinksMeta(),
  ]);

  const released = dlmAll.filter((card) => isReleased(card));
  console.log(`duellinksmeta: ${released.length} of ${dlmAll.length} rows are released Speed Duel cards`);

  const { cards, addedFromDlm, unreleasedPerDlm, renamed } = mergePool(duelLinksFlagged, everything, released);

  const previous = readJsonIfExists<CardFile>(cardsPath);
  const previousCount = previous?.cards.length ?? 0;
  assertPoolSane(cards, previousCount);

  const previousNames = new Set(previous?.cards.map((c) => c.name) ?? []);
  const currentNames = new Set(cards.map((c) => c.name));
  const added = [...currentNames].filter((n) => !previousNames.has(n)).sort((a, b) => a.localeCompare(b, "en"));
  const removed = [...previousNames].filter((n) => !currentNames.has(n)).sort((a, b) => a.localeCompare(b, "en"));

  const file: CardFile = {
    fetchedAt: new Date().toISOString(),
    source: `${YGO_DUEL_LINKS} + ${YGO_ALL} + ${DLM_ORIGIN}${DLM_PATH}`,
    count: cards.length,
    cards,
  };
  writeJson(cardsPath, file);

  const delta = cards.length - previousCount;
  const sign = delta >= 0 ? "+" : "";
  const review = unreleasedPerDlm.map((c) => c.name).sort((a, b) => a.localeCompare(b, "en"));
  const renames = renamed.map((r) => `${r.from} → ${r.to}`).sort((a, b) => a.localeCompare(b, "en"));

  console.log(`Cards: ${cards.length} (was ${previousCount}, ${sign}${delta})`);
  console.log(`Extra Deck cards: ${cards.filter((c) => c.isExtraDeck).length}`);
  console.log(`Recovered by duellinksmeta (YGOPRODeck did not flag them): ${addedFromDlm.length}`);
  console.log(`Kept but unreleased per duellinksmeta — review: ${review.length}`);
  if (renames.length) console.log(`Took the in-game name (${renames.length}): ${renames.join(", ")}`);
  if (added.length) console.log(`Added (${added.length}): ${list(added)}`);
  if (removed.length) console.log(`Removed (${removed.length}): ${list(removed)}`);

  reportToCi(
    [
      "### Card pool refresh",
      "",
      `- Total: **${cards.length}** (was ${previousCount}, ${sign}${delta})`,
      `- Recovered by duellinksmeta: ${addedFromDlm.length}`,
      `- Added: ${added.length}`,
      `- Removed: ${removed.length}`,
      `- Renamed to the in-game name: ${renames.length}`,
      "",
      review.length
        ? `⚠️ ${review.length} cards are flagged Duel Links by YGOPRODeck but have no duellinksmeta ` +
          "release date. They are **kept** — duellinksmeta's release field has false negatives, and " +
          "dropping a card a player owns is worse than showing one early. Skim for anything that " +
          "clearly is not in the game."
        : "No cards are in doubt: every YGOPRODeck-flagged card has a duellinksmeta release date.",
      details("Added", added),
      details("Removed", removed),
      details("Renamed to the in-game name", renames),
      details("Unreleased per duellinksmeta (kept for review)", review),
    ].join("\n"),
  );
}

// Only run when invoked directly; the projection helpers are imported by tests.
if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof PoolError ? `Pool build aborted: ${err.message}` : err);
    console.error("data/cards.json left untouched.");
    process.exit(1);
  });
}
