/**
 * Turning a pasted card list into collection entries.
 *
 * Entering a collection one typeahead search at a time is the app's biggest
 * barrier, and the game itself cannot help — Duel Links keeps the collection on
 * Konami's servers, so there is no file to read. What a player *can* produce is
 * a list of names, from a decklist, a spreadsheet, or their own notes.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: never guess which card someone meant.
 * The pool has no duplicate names, so an exact match is certain and can be
 * applied silently. But 143 card names are a word-prefix of another —
 * "Alligator's Sword" and "Alligator's Sword Dragon" are different cards — so
 * anything short of exact is offered for confirmation rather than applied. A
 * silently wrong card is worse than an unresolved line: it produces a deck the
 * player cannot actually field, and nothing on screen would explain why.
 */
import type { Card } from "../data/types.ts";
import { foldForSearch, NAME_MATCH_FLOOR, rankCards, type SearchEntry } from "./search.ts";

/** Copies a line asks for, or `null` when it names a card and no quantity. */
export interface ParsedLine {
  /** The line as typed, kept so the UI can show what it could not resolve. */
  raw: string;
  /** The card name, with any quantity stripped off. */
  query: string;
  copies: number | null;
}

export type MatchKind = "exact" | "uncertain" | "unmatched";

export interface MatchedLine {
  line: ParsedLine;
  kind: MatchKind;
  /** Set when `kind` is `"exact"`. */
  card?: Card;
  /** Set when `kind` is `"uncertain"`: the candidates, best first. */
  options?: Card[];
}

/** How many alternatives an uncertain line offers before it is just noise. */
const MAX_OPTIONS = 5;

/** Copies are capped at the deck limit; a list claiming 9 means 3. */
const MAX_COPIES = 3;

/**
 * Lines that are structure rather than content.
 *
 * `#` and `!` also cover `.ydk` section markers, so pasting a deck file
 * degrades into "no usable names" instead of matching `#main` against the pool.
 */
const COMMENT = /^\s*(?:#|!|\/\/)/;

/** `3x Name`, `3 x Name`, `3 Name`, `3. Name`, `3) Name`. */
const LEADING_QUANTITY = /^\s*(\d{1,2})\s*(?:x|\*|\.|\)|-)?\s+(.*)$/i;

/** `Name x3`, `Name ×3`, `Name (3)`, `Name [3]`, `Name 3`. */
const TRAILING_QUANTITY = /^(.*?)\s*(?:[x×*]\s*(\d{1,2})|\((\d{1,2})\)|\[(\d{1,2})\]|\s(\d{1,2}))\s*$/i;

function clampCopies(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_COPIES, value);
}

/**
 * Splits a pasted block into one entry per line, pulling the quantity out of
 * whichever end it was written on.
 *
 * Leading quantity is tried first: in "3 Ancient Gear Golem" the 3 is a count,
 * whereas in "Ancient Gear Golem 3" it is far more likely part of the name — but
 * the trailing form still has to be read, because "Name x3" is how most
 * decklists are written.
 */
export function parseCardList(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || COMMENT.test(trimmed)) continue;

    const leading = LEADING_QUANTITY.exec(trimmed);
    if (leading?.[2]?.trim()) {
      lines.push({ raw: trimmed, query: leading[2].trim(), copies: clampCopies(leading[1]) });
      continue;
    }

    const trailing = TRAILING_QUANTITY.exec(trimmed);
    const name = trailing?.[1]?.trim();
    if (trailing && name) {
      const digits = trailing[2] ?? trailing[3] ?? trailing[4] ?? trailing[5];
      lines.push({ raw: trimmed, query: name, copies: clampCopies(digits) });
      continue;
    }

    lines.push({ raw: trimmed, query: trimmed, copies: null });
  }

  return lines;
}

/**
 * Resolves parsed lines against the pool.
 *
 * Only identity is decided here. How many copies a bare line is worth is a
 * separate question the player controls, applied by `copiesFor` at commit time.
 */
export function matchCardList(lines: readonly ParsedLine[], entries: readonly SearchEntry[]): MatchedLine[] {
  // Exact lookup is the common path and has to be O(1) per line, not a scan.
  const byName = new Map<string, Card>();
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry.card);
  }

  return lines.map((line) => {
    const folded = foldForSearch(line.query);

    const exact = byName.get(folded);
    if (exact) return { line, kind: "exact" as const, card: exact };

    // Only hits in the card's own NAME are worth offering. `rankCards` also
    // returns effect-text matches, and a card that merely mentions your words is
    // not the card you typed — the typeahead draws the same line.
    const options = rankCards(entries, line.query)
      .filter((hit) => hit.score >= NAME_MATCH_FLOOR)
      .slice(0, MAX_OPTIONS)
      .map((hit) => hit.card);

    if (options.length === 0) return { line, kind: "unmatched" as const };
    return { line, kind: "uncertain" as const, options };
  });
}

/** Copies a resolved line contributes, honouring the bare-line default. */
export function copiesFor(line: ParsedLine, bareCopies: number): number {
  return Math.min(MAX_COPIES, line.copies ?? bareCopies);
}

export interface ImportSummary {
  exact: number;
  uncertain: number;
  unmatched: number;
}

export function summarize(matches: readonly MatchedLine[]): ImportSummary {
  return {
    exact: matches.filter((m) => m.kind === "exact").length,
    uncertain: matches.filter((m) => m.kind === "uncertain").length,
    unmatched: matches.filter((m) => m.kind === "unmatched").length,
  };
}
