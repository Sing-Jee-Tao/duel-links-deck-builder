/**
 * Pure parser for the duellinksmeta.com Forbidden/Limited page.
 *
 * Playwright is only responsible for *rendering* the page (it is a Svelte app,
 * so the raw HTML response contains no list). Everything after that is this
 * function, operating on the rendered HTML string — which is what makes the
 * golden-file test in `parse-banlist.test.ts` meaningful: a site redesign breaks
 * the parser in CI against a saved page rather than in production.
 *
 * Page shape (verified 12 Aug 2026): tier headings and card links are flat
 * siblings in document order inside <main>, so the parse is a linear fold:
 *
 *   <h3>… Limited 1</h3>
 *   <div style="--numCards: 149;" class="box-container …">
 *     <a href="/cards/Sphere%20Kuriboh">…</a> × 149
 *
 * The `--numCards` custom property is the page's own declared count. We compare
 * it against the links actually found, which catches a partially rendered or
 * lazily truncated list — the failure mode most likely to silently shrink a tier.
 */
import type { Banlist } from "../../src/data/types.ts";

export type ParsedTiers = Pick<Banlist, "forbidden" | "limited1" | "limited2" | "limited3">;

export interface ParseResult extends ParsedTiers {
  /** Count the page declared for each tier via `--numCards`, when present. */
  declared: Partial<Record<keyof ParsedTiers, number>>;
  /** Non-fatal observations; the caller decides which are fatal. */
  warnings: string[];
}

const HEADING_TO_TIER: Record<string, keyof ParsedTiers> = {
  forbidden: "forbidden",
  "limited 1": "limited1",
  "limited 2": "limited2",
  "limited 3": "limited3",
};

// One pass, three alternatives, so document order is preserved:
//   1. an <h3> heading   2. a --numCards declaration   3. a /cards/ link
const TOKEN =
  /<h3\b[^>]*>([\s\S]*?)<\/h3>|--numCards:\s*(\d+)|href="\/cards\/([^"#?]+)"/gi;

const TAGS = /<[^>]*>/g;

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function headingText(raw: string): string {
  return decodeEntities(raw.replace(TAGS, " ")).replace(/\s+/g, " ").trim().toLowerCase();
}

function cardName(href: string): string {
  let name = decodeEntities(href);
  try {
    name = decodeURIComponent(name);
  } catch {
    /* a malformed escape is better surfaced as a weird name than a crash */
  }
  return name.replace(/\s+/g, " ").trim();
}

export function parseBanlistHtml(html: string): ParseResult {
  const tiers: ParsedTiers = { forbidden: [], limited1: [], limited2: [], limited3: [] };
  const declared: ParseResult["declared"] = {};
  const warnings: string[] = [];
  const seen: Record<keyof ParsedTiers, Set<string>> = {
    forbidden: new Set(),
    limited1: new Set(),
    limited2: new Set(),
    limited3: new Set(),
  };

  let current: keyof ParsedTiers | null = null;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(html); m !== null; m = TOKEN.exec(html)) {
    const [, heading, numCards, href] = m;

    if (heading !== undefined) {
      // Any other <h3> ends the current tier — the explainer prose and the
      // community footer must not absorb links into the last tier.
      current = HEADING_TO_TIER[headingText(heading)] ?? null;
      continue;
    }
    if (numCards !== undefined) {
      if (current && declared[current] === undefined) declared[current] = Number(numCards);
      continue;
    }
    if (href !== undefined && current) {
      const name = cardName(href);
      if (name && !seen[current].has(name)) {
        seen[current].add(name);
        tiers[current].push(name);
      }
    }
  }

  for (const tier of Object.keys(tiers) as (keyof ParsedTiers)[]) {
    const found = tiers[tier].length;
    const said = declared[tier];
    if (said === undefined) {
      warnings.push(`${tier}: page declared no --numCards; cannot cross-check ${found} parsed`);
    } else if (said !== found) {
      warnings.push(`${tier}: page declared ${said} cards but ${found} links parsed`);
    }
  }

  return { ...tiers, declared, warnings };
}

export function totalEntries(tiers: ParsedTiers): number {
  return tiers.forbidden.length + tiers.limited1.length + tiers.limited2.length + tiers.limited3.length;
}
