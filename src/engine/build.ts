/**
 * The build engine.
 *
 * `buildBest` picks the template the player's collection is closest to, fills it
 * out of cards they actually own, and returns it with the top upgrade candidates
 * attached. Every addition is checked by `validateDeck`, so the pooled Limited
 * budgets are enforced by the same code path the legality panel reads — the
 * engine can never hand back a deck the validator would reject.
 */
import type { DeckTemplate } from "../data/types.ts";
import { BanlistIndex, normalizeName } from "./banlist-index.ts";
import { DeckBuilder } from "./deck-builder.ts";
import { synthesizeDeck } from "./synthesize.ts";
import { countCopies, validateDeck } from "./validator.ts";
import {
  type BuildConfig,
  type BuildInputs,
  type BuildResult,
  type CardIndex,
  type Deck,
  type DeckDiff,
  type DeckEntry,
  type DiffEntry,
  type OwnedCounts,
  type SynergyIndex,
  type TemplateScore,
} from "./types.ts";

export { DeckBuilder };

/** Core cards weigh this much more than flex slots when scoring completion. */
export const CORE_WEIGHT = 5;
export const FLEX_WEIGHT = 1;

function ownedCopies(owned: OwnedCounts, name: string): number {
  return owned.get(normalizeName(name)) ?? 0;
}

/**
 * Weighted completion against one template.
 *
 * A template missing a core card ranks below one missing three flex cards,
 * because each core copy is worth `CORE_WEIGHT` and each flex slot `FLEX_WEIGHT`.
 * Flex slots are satisfied by *any* owned candidate, so they are scored by how
 * many of the slot's copies the player can cover from the candidate list.
 */
export function scoreTemplate(template: DeckTemplate, owned: OwnedCounts): TemplateScore {
  let total = 0;
  let have = 0;
  const missingCore: DeckEntry[] = [];

  for (const core of template.coreCards) {
    total += core.copies * CORE_WEIGHT;
    const got = Math.min(core.copies, ownedCopies(owned, core.name));
    have += got * CORE_WEIGHT;
    if (got < core.copies) missingCore.push({ name: core.name, copies: core.copies - got });
  }

  for (const slot of template.flexSlots) {
    total += slot.count * FLEX_WEIGHT;
    let covered = 0;
    for (const candidate of slot.candidates) {
      if (covered >= slot.count) break;
      covered += Math.min(ownedCopies(owned, candidate), slot.count - covered);
    }
    have += covered * FLEX_WEIGHT;
  }

  const completion = total === 0 ? 0 : have / total;
  return {
    template,
    completion,
    rank: template.tierScore * completion,
    missingCore,
  };
}

export function rankTemplates(templates: DeckTemplate[], owned: OwnedCounts): TemplateScore[] {
  return templates
    .map((t) => scoreTemplate(t, owned))
    .sort((a, b) => b.rank - a.rank || b.completion - a.completion || a.template.name.localeCompare(b.template.name));
}

/**
 * How much pressure adding this card puts on a pooled tier budget.
 *
 * Spending the single Limited 1 slot on the wrong card can block a better one
 * later, so a candidate that draws on a scarce pool is pushed down the order
 * unless the template ranks it clearly higher. Cards outside every pool cost
 * nothing and win ties.
 */
function budgetPenalty(name: string, index: BanlistIndex, spentByTier: Map<number, number>): number {
  const tier = index.tier(name);
  if (tier === null) return 0;
  const budget = tier;
  const used = spentByTier.get(tier) ?? 0;
  const remaining = budget - used;
  if (remaining <= 0) return Number.POSITIVE_INFINITY;
  // Scarcer pools cost more: the last L1 slot is worth far more than the third
  // L3 slot, so the penalty scales with how much of the pool one copy consumes.
  return budget / remaining;
}

function spentByTier(deck: Deck, index: BanlistIndex): Map<number, number> {
  const spent = new Map<number, number>();
  for (const entry of [...deck.main, ...deck.extra]) {
    const tier = index.tier(entry.name);
    if (tier !== null) spent.set(tier, (spent.get(tier) ?? 0) + entry.copies);
  }
  return spent;
}

/** Assembles one template out of the collection, as far as it legally goes. */
function assemble(
  template: DeckTemplate,
  owned: OwnedCounts,
  index: BanlistIndex,
  cards: CardIndex,
  config: BuildConfig,
): { deck: Deck; usedNames: Set<string> } {
  const builder = new DeckBuilder(index, cards, config);
  const usedNames = new Set<string>();

  // 1. Extra Deck first: it competes for the same pooled budgets as the main
  //    deck, and the template's Extra picks are deliberate.
  for (const entry of template.extraDeck) {
    const available = Math.min(entry.copies, ownedCopies(owned, entry.name));
    if (available > 0 && builder.tryAdd(entry.name, available) > 0) usedNames.add(normalizeName(entry.name));
  }

  // 2. Core cards, heavily weighted and therefore committed before flex.
  for (const entry of template.coreCards) {
    const available = Math.min(entry.copies, ownedCopies(owned, entry.name));
    if (available > 0 && builder.tryAdd(entry.name, available) > 0) usedNames.add(normalizeName(entry.name));
  }

  // 3. Flex slots, greedily in candidate order — but scored by preference *and*
  //    remaining budget impact, and rolled back by the validator on a violation.
  for (const slot of template.flexSlots) {
    let filled = 0;
    const ordered = slot.candidates
      .map((name, preference) => ({ name, preference }))
      .filter(({ name }) => ownedCopies(owned, name) > builder.copiesOf(name))
      .sort((a, b) => {
        const spent = spentByTier(builder.snapshot(), index);
        const costA = a.preference + budgetPenalty(a.name, index, spent);
        const costB = b.preference + budgetPenalty(b.name, index, spent);
        return costA - costB || a.preference - b.preference;
      });

    for (const { name } of ordered) {
      if (filled >= slot.count) break;
      const room = Math.min(slot.count - filled, ownedCopies(owned, name) - builder.copiesOf(name));
      if (room <= 0) continue;
      const added = builder.tryAdd(name, room);
      filled += added;
      if (added > 0) usedNames.add(normalizeName(name));
    }
  }

  return { deck: builder.snapshot(), usedNames };
}

/**
 * Pads a short deck from the player's own cards, preferring cards that look like
 * the roles the template still wants: anything already named by the template
 * first, then other owned cards, biggest bodies and spells/traps ahead of
 * unplayable filler.
 */
function pad(
  deck: Deck,
  template: DeckTemplate | null,
  owned: OwnedCounts,
  index: BanlistIndex,
  cards: CardIndex,
  config: BuildConfig,
): Deck {
  const builder = new DeckBuilder(index, cards, config);
  for (const entry of deck.main) builder.tryAdd(entry.name, entry.copies);
  for (const entry of deck.extra) builder.tryAdd(entry.name, entry.copies);

  const preferred = new Set<string>();
  for (const slot of template?.flexSlots ?? []) {
    for (const candidate of slot.candidates) preferred.add(normalizeName(candidate));
  }

  const pool = [...owned.entries()]
    .filter(([, copies]) => copies > 0)
    .map(([key]) => cards.get(key))
    .filter((card): card is NonNullable<typeof card> => Boolean(card))
    // Extra Deck cards cannot pad the main deck.
    .filter((card) => !card.isExtraDeck)
    .sort((a, b) => {
      const prefA = preferred.has(normalizeName(a.name)) ? 0 : 1;
      const prefB = preferred.has(normalizeName(b.name)) ? 0 : 1;
      if (prefA !== prefB) return prefA - prefB;
      // Spells and traps do more than a small vanilla body; after that, ATK.
      const bodyA = a.atk ?? 2000;
      const bodyB = b.atk ?? 2000;
      return bodyB - bodyA || a.name.localeCompare(b.name);
    });

  for (const card of pool) {
    if (builder.mainCount() >= config.minMain) break;
    const room = Math.min(
      config.minMain - builder.mainCount(),
      ownedCopies(owned, card.name) - builder.copiesOf(card.name),
    );
    if (room > 0) builder.tryAdd(card.name, room);
  }

  return builder.snapshot();
}

/** How many decks a build run assembles. */
export const MAX_BUILDS = 5;

/**
 * Assembles one ranked template into a finished, validated deck.
 *
 * Lifted out of `buildBest` so several templates can be built from one
 * collection without re-deriving the banlist index per deck.
 */
export function buildTemplate(
  score: TemplateScore,
  inputs: BuildInputs,
  index: BanlistIndex,
  candidates: TemplateScore[],
): BuildResult {
  const assembled = assemble(score.template, inputs.owned, index, inputs.cards, inputs.config);
  const deck =
    countCopies(assembled.deck.main) < inputs.config.minMain
      ? pad(assembled.deck, score.template, inputs.owned, index, inputs.cards, inputs.config)
      : assembled.deck;

  const validation = validateDeck(deck, index, inputs.config);
  const mainCount = countCopies(deck.main);
  const partial = mainCount < inputs.config.minMain;

  // Never throw on an unbuildable collection: return the partial deck and say why.
  let reason: string | undefined;
  if (partial) {
    const short = inputs.config.minMain - mainCount;
    reason =
      `Could not legally reach ${inputs.config.minMain} cards — ${short} short. ` +
      `Every remaining owned card is Forbidden, already at 3 copies, or blocked by a spent Limited allowance.`;
  }

  return {
    template: score.template,
    deck,
    mainCount,
    powerScore: Math.round(score.template.tierScore * score.completion * 10 * 10) / 10,
    validation,
    partial,
    ...(reason ? { reason } : {}),
    candidates,
  };
}

/** The last resort: a legal pile out of whatever the collection holds. */
function buildFallback(inputs: BuildInputs, index: BanlistIndex, candidates: TemplateScore[]): BuildResult {
  const deck = pad({ main: [], extra: [] }, null, inputs.owned, index, inputs.cards, inputs.config);
  const built = countCopies(deck.main);
  return {
    template: null,
    deck,
    mainCount: built,
    powerScore: 0,
    validation: validateDeck(deck, index, inputs.config),
    partial: true,
    reason:
      built === 0
        ? "Nothing to build with yet — no owned cards match any deck template."
        : `No template matched your collection. Padded to ${built} cards from what you own.`,
    candidates,
  };
}

/**
 * Every deck the collection can legally support, strongest first.
 *
 * A collection rarely maps onto exactly one archetype — the same cards usually
 * support several, at different completions — so the Build screen offers the
 * top few rather than picking one and hiding the rest. Ordering by power score
 * preserves the ranking order, since power score is `rank × 10`.
 */
const EMPTY_SYNERGY: SynergyIndex = new Map();

/**
 * At or above this overlap the solver's deck is not a second option, it is the
 * same deck arrived at twice.
 */
export const DUPLICATE_OVERLAP_PCT = 80;

export function buildDecks(inputs: BuildInputs, limit = MAX_BUILDS): BuildResult[] {
  const index = new BanlistIndex(inputs.banlist);
  const candidates = rankTemplates(inputs.templates, inputs.owned);

  const results = candidates
    .filter((score) => score.completion > 0)
    .slice(0, limit)
    .map((score) => buildTemplate(score, inputs, index, candidates))
    // A template that assembles nothing is not an option to offer.
    .filter((result) => result.mainCount > 0);

  // The deck the collection makes on its own terms. It is the only answer for a
  // player who owns nothing any template names, and a real alternative for one
  // who does — so it is offered alongside, not only as a fallback.
  const synthesized = synthesizeDeck({
    owned: inputs.owned,
    cards: inputs.cards,
    synergy: inputs.synergy ?? EMPTY_SYNERGY,
    index,
    config: inputs.config,
    candidates,
  });
  // When the collection is deep in one archetype the solver rediscovers the deck
  // a template already describes. Offering both is noise, and the templated one
  // is better informed — it knows the copy counts real lists settled on.
  const duplicated = results.some(
    (result) => diffDecks(result.deck, synthesized.deck).completionPct >= DUPLICATE_OVERLAP_PCT,
  );
  if (synthesized.mainCount > 0 && !duplicated) results.push(synthesized);

  results.sort((a, b) => b.powerScore - a.powerScore);
  return results.length > 0 ? results : [buildFallback(inputs, index, candidates)];
}

/** The single strongest deck. Equivalent to `buildDecks(inputs)[0]`. */
export function buildBest(inputs: BuildInputs): BuildResult {
  return buildDecks(inputs)[0] as BuildResult;
}

/**
 * The single diff behind the whole upgrade screen: the shopping list and the
 * swap list are two views of this one result.
 */
export function diffDecks(current: Deck, target: Deck): DeckDiff {
  const tally = (deck: Deck): Map<string, DeckEntry> => {
    const map = new Map<string, DeckEntry>();
    for (const entry of [...deck.main, ...deck.extra]) {
      const key = normalizeName(entry.name);
      const seen = map.get(key);
      if (seen) seen.copies += entry.copies;
      else map.set(key, { name: entry.name, copies: entry.copies });
    }
    return map;
  };

  const currentTally = tally(current);
  const targetTally = tally(target);
  const toAcquire: DiffEntry[] = [];
  const toCut: DiffEntry[] = [];
  let shared = 0;

  for (const [key, entry] of targetTally) {
    const inCurrent = currentTally.get(key)?.copies ?? 0;
    shared += Math.min(inCurrent, entry.copies);
    if (entry.copies > inCurrent) {
      toAcquire.push({
        name: entry.name,
        copies: entry.copies - inCurrent,
        inCurrent,
        inTarget: entry.copies,
      });
    }
  }

  for (const [key, entry] of currentTally) {
    const inTarget = targetTally.get(key)?.copies ?? 0;
    if (entry.copies > inTarget) {
      toCut.push({
        name: entry.name,
        copies: entry.copies - inTarget,
        inCurrent: entry.copies,
        inTarget,
      });
    }
  }

  const targetCopies = countCopies([...targetTally.values()]);
  const byName = (a: DiffEntry, b: DiffEntry) => b.copies - a.copies || a.name.localeCompare(b.name);

  return {
    toAcquire: toAcquire.sort(byName),
    toCut: toCut.sort(byName),
    completionPct: targetCopies === 0 ? 100 : Math.round((shared / targetCopies) * 100),
    sharedCopies: shared,
    targetCopies,
  };
}

/**
 * The full target list a template describes, ignoring ownership — what the deck
 * looks like when finished. Used as the right-hand side of the upgrade diff.
 */
export function idealDeck(template: DeckTemplate, index: BanlistIndex, cards: CardIndex, config: BuildConfig): Deck {
  const builder = new DeckBuilder(index, cards, config);
  for (const entry of template.extraDeck) builder.tryAdd(entry.name, entry.copies);
  for (const entry of template.coreCards) builder.tryAdd(entry.name, entry.copies);

  for (const slot of template.flexSlots) {
    let filled = 0;
    for (const name of slot.candidates) {
      if (filled >= slot.count) break;
      const maxCopies = index.maxCopiesIgnoringPool(name, config.maxCopies);
      const room = Math.min(slot.count - filled, maxCopies - builder.copiesOf(name));
      if (room > 0) filled += builder.tryAdd(name, room);
    }
  }
  return builder.snapshot();
}
