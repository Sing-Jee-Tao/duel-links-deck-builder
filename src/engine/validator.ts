/**
 * Deck legality for Duel Links Speed Duel.
 *
 * The rule that trips up every naive implementation: Limited 1 / 2 / 3 are not
 * per-card caps. Each tier is a single budget shared across the *entire pool* of
 * cards in that tier.
 *
 *   Forbidden  — zero copies.
 *   Limited 1  — 1 card total from the whole Limited 1 pool. If A and B are both
 *                Limited 1, a legal deck has one A, or one B, or neither.
 *                Never one of each.
 *   Limited 2  — 2 total from the whole pool: AA, AB, BB, A, B, or none.
 *                AAB and AABB are illegal.
 *   Limited 3  — 3 total from the whole pool.
 *
 * `validateDeck` is pure and returns *every* violation, not just the first.
 */
import type { Banlist } from "../data/types.ts";
import { BanlistIndex, type TierNumber } from "./banlist-index.ts";
import type {
  AllowanceState,
  AllowanceTierState,
  BuildConfig,
  Deck,
  ValidationResult,
  Violation,
} from "./types.ts";

const TIER_BUDGET: Record<TierNumber, number> = { 1: 1, 2: 2, 3: 3 };

export function countCopies(entries: { copies: number }[]): number {
  return entries.reduce((sum, e) => sum + e.copies, 0);
}

function emptyAllowance(): AllowanceState {
  return {
    tiers: [
      { tier: 1, budget: 1, used: 0, slots: [] },
      { tier: 2, budget: 2, used: 0, slots: [] },
      { tier: 3, budget: 3, used: 0, slots: [] },
    ],
    spent: 0,
    total: 6,
  };
}

/**
 * Walks main + extra and records which cards spend each pooled tier budget.
 * The allowance rail renders straight off this, so a spent slot can show the
 * name of the card that spent it.
 */
export function computeAllowance(deck: Deck, index: BanlistIndex): AllowanceState {
  const allowance = emptyAllowance();
  for (const entry of [...deck.main, ...deck.extra]) {
    if (entry.copies <= 0) continue;
    const tier = index.tier(entry.name);
    if (tier === null) continue;
    const state = allowance.tiers[tier - 1] as AllowanceTierState;
    state.used += entry.copies;
    state.slots.push({ name: entry.name, copies: entry.copies });
  }
  allowance.spent = allowance.tiers.reduce((sum, t) => sum + t.used, 0);
  return allowance;
}

export function validateDeck(
  deck: Deck,
  banlist: Banlist | BanlistIndex,
  config: BuildConfig,
): ValidationResult {
  const index = banlist instanceof BanlistIndex ? banlist : new BanlistIndex(banlist);
  const violations: Violation[] = [];

  const mainCount = countCopies(deck.main);
  const extraCount = countCopies(deck.extra);

  // 1. Main Deck size.
  if (mainCount < config.minMain || mainCount > config.maxMain) {
    violations.push({
      code: "main-deck-size",
      message:
        mainCount < config.minMain
          ? `Main Deck holds ${mainCount} cards; the minimum is ${config.minMain}.`
          : `Main Deck holds ${mainCount} cards; the maximum is ${config.maxMain}.`,
      cards: [],
    });
  }

  // 2. Extra Deck size.
  if (extraCount > config.extraDeckSize) {
    violations.push({
      code: "extra-deck-size",
      message: `Extra Deck holds ${extraCount} cards; the cap is ${config.extraDeckSize}.`,
      cards: [],
    });
  }

  // 3. At most `maxCopies` of any single card name — counted across main and
  //    extra together, since a name lives in exactly one of them.
  const copiesByName = new Map<string, { display: string; copies: number }>();
  for (const entry of [...deck.main, ...deck.extra]) {
    const key = entry.name.trim().toLowerCase();
    const seen = copiesByName.get(key);
    if (seen) seen.copies += entry.copies;
    else copiesByName.set(key, { display: entry.name, copies: entry.copies });
  }
  for (const { display, copies } of copiesByName.values()) {
    if (copies > config.maxCopies) {
      violations.push({
        code: "copy-limit",
        message: `${display}: ${copies} copies, over the ${config.maxCopies}-copy limit.`,
        cards: [display],
      });
    }
  }

  // 4. Forbidden cards.
  const forbidden = [...copiesByName.values()]
    .filter(({ display, copies }) => copies > 0 && index.isForbidden(display))
    .map(({ display }) => display);
  if (forbidden.length > 0) {
    violations.push({
      code: "forbidden",
      message:
        forbidden.length === 1
          ? `${forbidden[0]} is Forbidden and cannot be played in any quantity.`
          : `${forbidden.length} Forbidden cards: ${forbidden.join(", ")}.`,
      cards: forbidden,
    });
  }

  // 5. The three pooled tier budgets.
  const allowance = computeAllowance(deck, index);
  for (const state of allowance.tiers) {
    const budget = TIER_BUDGET[state.tier];
    if (state.used > budget) {
      const names = state.slots.map((s) => (s.copies > 1 ? `${s.name} ×${s.copies}` : s.name));
      violations.push({
        code: "tier-budget",
        message:
          `Limited ${state.tier} allows ${budget} card${budget === 1 ? "" : "s"} total from the whole pool; ` +
          `this deck plays ${state.used} (${names.join(", ")}).`,
        cards: state.slots.map((s) => s.name),
        tier: state.tier,
        budget,
        used: state.used,
      });
    }
  }

  return {
    legal: violations.length === 0,
    violations,
    mainCount,
    extraCount,
    allowance,
  };
}
