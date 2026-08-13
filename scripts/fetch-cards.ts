/**
 * Pulls the Duel Links card pool from YGOPRODeck and writes `data/cards.json`.
 *
 * YGOPRODeck asks consumers to cache locally rather than call repeatedly, so
 * this runs weekly in CI and never from the app.
 *
 *   npm run fetch:cards
 */
import { cardsPath, isMain, readJsonIfExists, reportToCi, USER_AGENT, writeJson } from "./lib/paths.ts";
import type { Card, CardFile } from "../src/data/types.ts";

const ENDPOINT = "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=duel%20links";

/** Upstream shape, narrowed to the fields we read. */
interface RawCard {
  id: number;
  name: string;
  type: string;
  race: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  archetype?: string;
  desc: string;
}

const EXTRA_DECK_MARKERS = ["fusion", "synchro", "xyz", "link"];

export function isExtraDeckType(type: string): boolean {
  const lower = type.toLowerCase();
  return EXTRA_DECK_MARKERS.some((marker) => lower.includes(marker));
}

export function projectCard(raw: RawCard): Card {
  const card: Card = {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    race: raw.race,
    desc: raw.desc,
    isExtraDeck: isExtraDeckType(raw.type),
  };
  if (raw.attribute !== undefined) card.attribute = raw.attribute;
  if (raw.level !== undefined) card.level = raw.level;
  if (raw.atk !== undefined) card.atk = raw.atk;
  if (raw.def !== undefined) card.def = raw.def;
  if (raw.archetype !== undefined) card.archetype = raw.archetype;
  return card;
}

export function projectAll(raws: RawCard[]): Card[] {
  // Tokens are not deckable and only pad the pool.
  const deckable = raws.filter((raw) => raw.type !== "Token");
  return deckable
    .map(projectCard)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

async function main(): Promise<void> {
  console.log(`Fetching ${ENDPOINT}`);
  const res = await fetch(ENDPOINT, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`YGOPRODeck responded ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as { data?: RawCard[] };
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("YGOPRODeck returned no card data — refusing to overwrite cards.json");
  }

  const cards = projectAll(payload.data);
  const previous = readJsonIfExists<CardFile>(cardsPath);
  const previousCount = previous?.cards.length ?? 0;

  // The upstream Duel Links legality flag is approximate. Diff against the last
  // run so an upstream change is visible in the pull request rather than silent.
  const previousNames = new Set(previous?.cards.map((c) => c.name) ?? []);
  const currentNames = new Set(cards.map((c) => c.name));
  const added = [...currentNames].filter((n) => !previousNames.has(n));
  const removed = [...previousNames].filter((n) => !currentNames.has(n));

  const file: CardFile = {
    fetchedAt: new Date().toISOString(),
    source: ENDPOINT,
    count: cards.length,
    cards,
  };
  writeJson(cardsPath, file);

  const delta = cards.length - previousCount;
  console.log(`Cards: ${cards.length} (was ${previousCount}, ${delta >= 0 ? "+" : ""}${delta})`);
  console.log(`Extra Deck cards: ${cards.filter((c) => c.isExtraDeck).length}`);
  if (added.length) console.log(`Added (${added.length}): ${added.slice(0, 20).join(", ")}`);
  if (removed.length) console.log(`Removed (${removed.length}): ${removed.slice(0, 20).join(", ")}`);

  reportToCi(
    [
      "### Card pool refresh",
      "",
      `- Total: **${cards.length}** (was ${previousCount}, ${delta >= 0 ? "+" : ""}${delta})`,
      `- Added: ${added.length}`,
      `- Removed: ${removed.length}`,
      added.length ? `\n<details><summary>Added</summary>\n\n${added.map((n) => `- ${n}`).join("\n")}\n\n</details>` : "",
      removed.length ? `\n<details><summary>Removed</summary>\n\n${removed.map((n) => `- ${n}`).join("\n")}\n\n</details>` : "",
    ].join("\n"),
  );
}

// Only run when invoked directly; the projection helpers are imported by tests.
if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
