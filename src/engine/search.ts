/**
 * Pool search: how a typed query turns into a ranked list of cards.
 *
 * The old matcher tested the whole query as one contiguous substring, so a
 * single extra or reordered word emptied the results — "Black Whirlwind" found
 * only "Black Whirlwind" and never "Black Feather Whirlwind", and the failure
 * looked exactly like a missing card. Every token must now appear, but they may
 * appear anywhere and in any order; the ranking is what keeps the card you
 * literally typed at the top.
 *
 * Text is folded before comparison because the pool mixes typography an ASCII
 * keyboard cannot produce — curly apostrophes, en dashes, and the accents in
 * "Chirubimé" or "Beast Machine King Barbaros Ür".
 */
import type { Card } from "../data/types.ts";

/** Case, accents and typography all collapse so a plain ASCII query reaches them. */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    // Strip the combining marks NFD just split off: "é" → "e".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(query: string): string[] {
  const folded = foldForSearch(query);
  return folded.length === 0 ? [] : folded.split(" ");
}

/** A card with its searchable text pre-folded. Built once per pool. */
export interface SearchEntry {
  card: Card;
  name: string;
  archetype: string;
  desc: string;
}

export function buildSearchIndex(cards: readonly Card[]): SearchEntry[] {
  return cards.map((card) => ({
    card,
    name: foldForSearch(card.name),
    archetype: card.archetype ? foldForSearch(card.archetype) : "",
    desc: foldForSearch(card.desc),
  }));
}

/**
 * Relevance bands. The gaps are wide so a later tie-break can never lift a
 * weaker kind of match above a stronger one.
 */
const SCORE = {
  exactName: 100,
  namePrefix: 90,
  namePhrase: 80,
  nameInOrder: 70,
  nameAnyOrder: 60,
  archetype: 40,
  desc: 20,
  none: 0,
} as const;

/** True when every token appears in `haystack`, left to right, without overlapping. */
function containsInOrder(haystack: string, tokens: readonly string[]): boolean {
  let from = 0;
  for (const token of tokens) {
    const at = haystack.indexOf(token, from);
    if (at === -1) return false;
    from = at + token.length;
  }
  return true;
}

/** 0 means the card does not match at all and must not be shown. */
export function scoreEntry(entry: SearchEntry, tokens: readonly string[], phrase: string): number {
  if (tokens.length === 0) return SCORE.exactName;

  if (entry.name === phrase) return SCORE.exactName;
  if (entry.name.startsWith(phrase)) return SCORE.namePrefix;
  if (entry.name.includes(phrase)) return SCORE.namePhrase;

  const inName = tokens.filter((t) => entry.name.includes(t));
  if (inName.length === tokens.length) {
    return containsInOrder(entry.name, tokens) ? SCORE.nameInOrder : SCORE.nameAnyOrder;
  }

  // Fall back through the other searchable text, but only if nothing is missing:
  // a query is a conjunction, so one unmatched token disqualifies the card.
  const nameAndArchetype = `${entry.name} ${entry.archetype}`;
  if (tokens.every((t) => nameAndArchetype.includes(t))) return SCORE.archetype;

  const everything = `${nameAndArchetype} ${entry.desc}`;
  return tokens.every((t) => everything.includes(t)) ? SCORE.desc : SCORE.none;
}

/**
 * At or above this score the query was found in the card's own name, rather than
 * only in its effect text. The type-ahead shows nothing weaker: it is a jump
 * target, and a card that merely mentions your words in its rules text is not
 * one you were reaching for.
 */
export const NAME_MATCH_FLOOR: number = SCORE.nameAnyOrder;

export interface RankedCard {
  card: Card;
  score: number;
}

/**
 * Ranked matches, best first. Ties break alphabetically so the order is stable
 * and the ledger still reads like a list rather than a shuffle.
 */
export function rankCards(entries: readonly SearchEntry[], query: string): RankedCard[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return entries.map((e) => ({ card: e.card, score: SCORE.exactName }));

  const phrase = tokens.join(" ");
  const hits: RankedCard[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, tokens, phrase);
    if (score > SCORE.none) hits.push({ card: entry.card, score });
  }

  hits.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name, "en"));
  return hits;
}

export function searchIndex(entries: readonly SearchEntry[], query: string): Card[] {
  return rankCards(entries, query).map((h) => h.card);
}
