/**
 * Applies `data/banlist-override.json` on top of a scraped result so a Konami
 * announcement can be hand-applied before the weekly scrape catches up.
 *
 * Rules, in order:
 *   - a name listed in `unlimited` is removed from every tier
 *   - a name listed under a tier is placed in that tier and removed from the others
 *   - names are matched case-insensitively but stored in the override's casing
 */
import type { Banlist, BanlistOverride } from "../../src/data/types.ts";
import type { ParsedTiers } from "./parse-banlist.ts";

const TIERS = ["forbidden", "limited1", "limited2", "limited3"] as const;

export interface MergeResult {
  tiers: ParsedTiers;
  /** True when the override actually changed something. */
  applied: boolean;
  changes: string[];
}

export function mergeOverride(scraped: ParsedTiers, override: BanlistOverride | null): MergeResult {
  const tiers: ParsedTiers = {
    forbidden: [...scraped.forbidden],
    limited1: [...scraped.limited1],
    limited2: [...scraped.limited2],
    limited3: [...scraped.limited3],
  };
  const changes: string[] = [];
  const sortTiers = () => {
    for (const tier of TIERS) tiers[tier].sort((a, b) => a.localeCompare(b, "en"));
  };
  if (!override) {
    sortTiers();
    return { tiers, applied: false, changes };
  }

  const removeEverywhere = (name: string): (typeof TIERS)[number][] => {
    const from: (typeof TIERS)[number][] = [];
    const key = name.toLowerCase();
    for (const tier of TIERS) {
      const before = tiers[tier].length;
      tiers[tier] = tiers[tier].filter((n) => n.toLowerCase() !== key);
      if (tiers[tier].length !== before) from.push(tier);
    }
    return from;
  };

  for (const name of override.unlimited ?? []) {
    const from = removeEverywhere(name);
    if (from.length) changes.push(`unlimited: ${name} (was ${from.join(", ")})`);
  }

  for (const tier of TIERS) {
    for (const name of override[tier] ?? []) {
      const from = removeEverywhere(name);
      tiers[tier].push(name);
      changes.push(from.length ? `${name}: ${from.join(", ")} → ${tier}` : `${name}: → ${tier}`);
    }
  }

  sortTiers();
  return { tiers, applied: changes.length > 0, changes };
}

export function buildBanlist(
  tiers: ParsedTiers,
  source: Banlist["source"],
  scrapedAt = new Date().toISOString(),
): Banlist {
  return { scrapedAt, source, ...tiers };
}
