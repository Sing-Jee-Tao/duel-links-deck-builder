import type { Banlist } from "../data/types.ts";

/** Card names are the join key between the banlist and the card pool, and the
 *  two sources do not agree on casing or whitespace. Normalize on both sides. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export type TierNumber = 1 | 2 | 3;

/** Fast lookups over a banlist: which pool, if any, a card name draws on. */
export class BanlistIndex {
  private readonly forbidden: Set<string>;
  private readonly tierOf: Map<string, TierNumber>;

  constructor(banlist: Banlist) {
    this.forbidden = new Set(banlist.forbidden.map(normalizeName));
    this.tierOf = new Map();
    const pools: [TierNumber, string[]][] = [
      [1, banlist.limited1],
      [2, banlist.limited2],
      [3, banlist.limited3],
    ];
    for (const [tier, names] of pools) {
      for (const name of names) {
        const key = normalizeName(name);
        // A name should appear in exactly one pool. If the source ever lists one
        // twice, the stricter tier wins — never the more permissive one.
        const existing = this.tierOf.get(key);
        if (existing === undefined || tier < existing) this.tierOf.set(key, tier);
      }
    }
  }

  isForbidden(name: string): boolean {
    return this.forbidden.has(normalizeName(name));
  }

  /** The pooled tier this card draws on, or null when unlimited. */
  tier(name: string): TierNumber | null {
    return this.tierOf.get(normalizeName(name)) ?? null;
  }

  /** Copies of this card a deck may legally contain, ignoring pool pressure. */
  maxCopiesIgnoringPool(name: string, maxCopies: number): number {
    if (this.isForbidden(name)) return 0;
    const tier = this.tier(name);
    if (tier === null) return maxCopies;
    // A tier's whole budget could go to one card: L1 → 1, L2 → 2, L3 → 3.
    return Math.min(maxCopies, tier);
  }
}
