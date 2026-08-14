/**
 * Builds `data/decks.json` and `data/synergy.json` from duellinksmeta's
 * tournament corpus.
 *
 * WHY: the app shipped with four hand-authored templates against a 10,644-card
 * pool, so most collections matched nothing and the "top candidates" ranking was
 * really an enumeration. `/api/v1/top-decks` carries a few thousand real
 * tournament lists tagged by deck type; grouping them yields a measured
 * core/flex split for every archetype people actually play, and counting which
 * cards share a list yields the synergy signal the template-free solver runs on.
 *
 * Like the other pipeline scripts this runs weekly in CI, never from the app,
 * and fails closed: a bad pull leaves the committed files untouched.
 *
 *   npm run fetch:decks
 */
import {
  cardsPath,
  dataDir,
  isMain,
  readJsonIfExists,
  reportToCi,
  USER_AGENT,
  writeCompactJson,
  writeJson,
} from "./lib/paths.ts";
import path from "node:path";
import { isPathAllowed } from "./lib/robots.ts";
import {
  assertTemplatesSane,
  DEFAULT_DERIVE_OPTIONS,
  deriveTemplates,
  TemplateError,
  type DlmDeckType,
  type DlmTopDeck,
} from "./lib/derive-templates.ts";
import type { CardFile, DeckFile, SynergyFile } from "../src/data/types.ts";

const DLM_ORIGIN = "https://www.duellinksmeta.com";
const TOP_DECKS_PATH = "/api/v1/top-decks";
const DECK_TYPES_PATH = "/api/v1/deck-types";
const DLM_ROBOTS = `${DLM_ORIGIN}/robots.txt`;
const PAGE_SIZE = 500;
/** The window needs ~6 pages; this only exists so a pagination bug cannot spin. */
const MAX_PAGES = 30;

export const decksPath = path.join(dataDir, "decks.json");
export const synergyPath = path.join(dataDir, "synergy.json");

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function assertAllowed(pathname: string): Promise<void> {
  const robots = await fetch(DLM_ROBOTS, { headers: { "User-Agent": USER_AGENT } });
  if (!robots.ok) {
    console.warn(`Could not read robots.txt (${robots.status}); proceeding with the documented allowance.`);
    return;
  }
  if (!isPathAllowed(await robots.text(), pathname)) {
    throw new TemplateError(`robots.txt disallows ${pathname} — not fetching.`);
  }
}

/**
 * Walks `/top-decks` newest-first and stops once a page falls entirely outside
 * the window, so a widening window costs pages and a narrow one costs none.
 */
async function fetchTopDecks(windowDays: number, now: number): Promise<DlmTopDeck[]> {
  const cutoff = now - windowDays * 86_400_000;
  const all: DlmTopDeck[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${DLM_ORIGIN}${TOP_DECKS_PATH}?limit=${PAGE_SIZE}&page=${page}&sort=-created`;
    const batch = await getJson<DlmTopDeck[]>(url);
    if (!Array.isArray(batch)) throw new TemplateError(`top-decks page ${page} was not an array.`);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    const oldest = batch.reduce((min, d) => Math.min(min, Date.parse(d.created ?? "") || Infinity), Infinity);
    if (Number.isFinite(oldest) && oldest < cutoff) break;
  }

  if (all.length === 0) {
    throw new TemplateError("duellinksmeta returned no tournament decks — refusing to overwrite decks.json");
  }
  console.log(`Fetched ${DLM_ORIGIN}${TOP_DECKS_PATH}: ${all.length} rows`);
  return all;
}

async function fetchDeckTypes(): Promise<DlmDeckType[]> {
  const rows = await getJson<DlmDeckType[]>(`${DLM_ORIGIN}${DECK_TYPES_PATH}?limit=2000`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TemplateError("duellinksmeta returned no deck types — refusing to overwrite decks.json");
  }
  console.log(`Fetched ${DLM_ORIGIN}${DECK_TYPES_PATH}: ${rows.length} rows`);
  return rows;
}

function list(names: string[], limit = 20): string {
  const head = names.slice(0, limit).join(", ");
  return names.length > limit ? `${head}, … (+${names.length - limit})` : head;
}

function details(summary: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `\n<details><summary>${summary}</summary>\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n</details>`;
}

async function main(): Promise<void> {
  const pool = readJsonIfExists<CardFile>(cardsPath);
  if (!pool || pool.cards.length === 0) {
    throw new TemplateError(
      "data/cards.json is missing or empty. Templates are validated against the pool, so run " +
        "`npm run fetch:cards` first.",
    );
  }

  await assertAllowed(TOP_DECKS_PATH);
  await assertAllowed(DECK_TYPES_PATH);

  const now = Date.now();
  const { windowDays } = DEFAULT_DERIVE_OPTIONS;
  const [topDecks, deckTypes] = await Promise.all([fetchTopDecks(windowDays, now), fetchDeckTypes()]);

  const result = deriveTemplates(topDecks, deckTypes, pool.cards, { now });
  const previous = readJsonIfExists<DeckFile>(decksPath);
  assertTemplatesSane(result, previous?.templates.length ?? 0);

  const source = `${DLM_ORIGIN}${TOP_DECKS_PATH} + ${DLM_ORIGIN}${DECK_TYPES_PATH}`;
  const fetchedAt = new Date(now).toISOString();

  const deckFile: DeckFile = {
    fetchedAt,
    source,
    windowDays,
    count: result.templates.length,
    templates: result.templates,
  };
  const synergyFile: SynergyFile = {
    fetchedAt,
    source,
    windowDays,
    deckCount: result.stats.decksAfterRush,
    cards: result.synergy,
  };
  writeJson(decksPath, deckFile);
  writeCompactJson(synergyPath, synergyFile);

  const { stats } = result;
  const previousCount = previous?.templates.length ?? 0;
  const delta = result.templates.length - previousCount;
  const sign = delta >= 0 ? "+" : "";
  const previousNames = new Set(previous?.templates.map((t) => t.name) ?? []);
  const currentNames = new Set(result.templates.map((t) => t.name));
  const added = [...currentNames].filter((n) => !previousNames.has(n)).sort((a, b) => a.localeCompare(b, "en"));
  const removed = [...previousNames].filter((n) => !currentNames.has(n)).sort((a, b) => a.localeCompare(b, "en"));

  console.log(`Decks in the last ${windowDays} days: ${stats.decksInWindow} (${stats.decksAfterRush} Speed Duel)`);
  console.log(`Deck types seen: ${stats.deckTypes}; templates derived: ${stats.templates} (was ${previousCount})`);
  console.log(`Card names resolved against the pool: ${stats.namesJoined}/${stats.namesSeen} (${(stats.joinRate * 100).toFixed(2)}%)`);
  console.log(`Synergy entries: ${Object.keys(result.synergy).length}`);
  if (added.length) console.log(`Added (${added.length}): ${list(added)}`);
  if (removed.length) console.log(`Removed (${removed.length}): ${list(removed)}`);

  reportToCi(
    [
      "### Deck template refresh",
      "",
      `- Templates: **${stats.templates}** (was ${previousCount}, ${sign}${delta})`,
      `- Derived from ${stats.decksAfterRush} Speed Duel lists over the last ${windowDays} days`,
      `- Rush Duel lists dropped: ${stats.decksInWindow - stats.decksAfterRush}`,
      `- Card names resolved: ${stats.namesJoined}/${stats.namesSeen} (${(stats.joinRate * 100).toFixed(2)}%)`,
      `- Synergy entries: ${Object.keys(result.synergy).length}`,
      "",
      stats.unresolved.length
        ? `⚠️ ${stats.unresolved.length} card names in the corpus are not in \`data/cards.json\`. They are ` +
          "skipped, so a template may be missing a card. Usually this means the pool is stale — " +
          "check that `fetch:cards` ran first."
        : "Every card name in the corpus resolved against the pool.",
      details("Added", added),
      details("Removed", removed),
      details("Unresolved names (skipped)", stats.unresolved),
    ].join("\n"),
  );
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof TemplateError ? `Template derivation aborted: ${err.message}` : err);
    console.error("data/decks.json and data/synergy.json left untouched.");
    process.exit(1);
  });
}
