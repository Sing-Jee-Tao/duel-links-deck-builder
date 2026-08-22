/**
 * What closing a gap actually costs.
 *
 * Duel Links Meta publishes a gem price per tournament list, and the app has
 * always shown it. That number answers "what does this deck cost from nothing",
 * which is the wrong question for anyone who already owns cards — and it is the
 * only question a site that cannot see your collection is able to answer.
 *
 * This module answers the other one. It is deliberately NOT an apportionment of
 * duellinksmeta's figure across the cards you happen to be missing; that really
 * would be an invented number, which is why the app declined to do it. It is
 * arithmetic over the box itself:
 *
 *   A Duel Links box is a fixed pile of cards, drawn WITHOUT replacement, three
 *   to a pack. `data/sets.json` records how big each pile is and
 *   `Card.routes[].amount` records how many copies of a given card sit in it.
 *
 * Those two facts determine a pack count exactly, so the gem figure here is
 * derived rather than estimated. What it is NOT is a promise: pulls are random,
 * so the honest output is a distribution — a mean, a median, and a 90th
 * percentile for the unlucky — and every caller is expected to show more than
 * the mean alone.
 *
 * Three rules keep it honest, and all three exist because a WRONG AND CHEAP
 * answer is far more damaging than no answer. Under-promising costs a player
 * some patience; under-pricing sends them to spend gems on a box that cannot
 * give them what they came for.
 *
 *   1. A card obtainable without a box is FREE, and free beats any pull. It is
 *      reported as free rather than as zero gems, because it costs time.
 *   2. A box we cannot credibly price (see `BoxSet.suspect`) is never guessed
 *      at. It goes to `unpriced` and says so.
 *   3. A card with no usable route at all goes to `unknown` and is counted, so
 *      a total can never read as cheap merely because data was missing.
 */
import type { AcquisitionRoute, BoxSet, Card, CardRarity } from "../data/types.ts";
import { CARDS_PER_PACK } from "../data/types.ts";
import { normalizeName } from "./banlist-index.ts";
import type { CardIndex, DeckEntry } from "./types.ts";

/**
 * Gems for one pack.
 *
 * A game rule rather than a tuning knob, and the single place the gem/pack
 * exchange lives. It checks out against the shelf: a 200-pack Main Box is the
 * 10,000 gems a full reset is known to cost.
 */
export const GEMS_PER_PACK = 50;

/**
 * Trials per box in the multi-card simulation. Fixed, so results are stable.
 *
 * The output is a pack count rounded to the nearest whole pack, shown beside a
 * 90th percentile, so precision past about a percent is precision the answer
 * does not claim. 400 trials hold it inside that.
 *
 * The number is chosen against a budget, not picked for comfort: the Upgrade
 * screen sorts sixty-nine decks by cost, so the whole shelf has to price in one
 * pass. At 400 that pass costs less than the deck solver it runs beside, and it
 * gets cheaper as a collection fills, because there is less left to price.
 */
const TRIALS = 400;

/** Boxes are looked up by name; upstream names are unique across the shelf. */
export type BoxIndex = ReadonlyMap<string, BoxSet>;

export function indexBoxes(sets: BoxSet[]): BoxIndex {
  const index = new Map<string, BoxSet>();
  for (const set of sets) {
    const key = normalizeName(set.name);
    // First writer wins, so a re-release cannot displace the original entry.
    if (!index.has(key)) index.set(key, set);
  }
  return index;
}

/** A card you can get without spending a gem. */
export interface FreeAcquisition {
  card: string;
  copies: number;
  /** "Yugi Muto", "Ranked Duels Ticket". */
  via: string;
  /** "Level 10", "Drop". */
  detail?: string;
  rarity?: CardRarity;
}

/** What one box is being asked to produce, and what that is expected to take. */
export interface BoxPlan {
  box: string;
  /** "Main Box", "Mini Box". */
  type: string;
  /** The cards being chased out of this box. */
  cards: { name: string; copies: number; inBox: number; rarity?: CardRarity }[];
  /** Expected packs to pull all of them. */
  packs: number;
  /** Half of players finish by here. */
  medianPacks: number;
  /** Nine in ten finish by here — the number that stops this reading as a promise. */
  p90Packs: number;
  gems: number;
  /**
   * Packs this pull can never exceed: emptying the box, times the resets the
   * scarcest card forces. Equal to one box for almost every gap, and several
   * where the box stocks fewer copies of a card than the deck runs.
   */
  boxPacks: number;
  /** Times the box has to be reset before the gap can close at all. */
  resets: number;
}

/** A card whose only route is a box we will not put a number on. */
export interface UnpricedAcquisition {
  card: string;
  copies: number;
  /** "Structure Deck EX · Dragonic Force". */
  via: string;
  /** Present when the box was rejected as bad data rather than simply bought whole. */
  suspect?: string;
  rarity?: CardRarity;
}

/**
 * The cost of a shortfall.
 *
 * `gems` covers ONLY what `boxes` accounts for. Anything in `free`, `unpriced`
 * or `unknown` is outside it by construction, so a caller must show those
 * alongside the figure — a total presented on its own would read as complete
 * when it is not.
 */
export interface AcquisitionCost {
  gems: number;
  packs: number;
  boxes: BoxPlan[];
  free: FreeAcquisition[];
  unpriced: UnpricedAcquisition[];
  /** Cards with no route at all. Counted so the gem figure is never mistaken for whole. */
  unknown: { card: string; copies: number }[];
  /** True when every missing card was priced, freed, or is genuinely free. */
  complete: boolean;
}

export const EMPTY_COST: AcquisitionCost = {
  gems: 0,
  packs: 0,
  boxes: [],
  free: [],
  unpriced: [],
  unknown: [],
  complete: true,
};

/**
 * Expected cards drawn to reach the `want`-th copy, from a pile of `size`
 * holding `held` of them.
 *
 * This is the expected position of the k-th success in a uniformly random
 * permutation: `k·(size+1)/(held+1)`. Exact, no simulation needed, and it holds
 * past a single box too — needing more copies than the box stocks just means
 * resetting it, and the copies already pulled are kept, which is precisely what
 * the linear form describes.
 */
export function expectedDraws(size: number, held: number, want: number): number {
  if (want <= 0) return 0;
  if (held <= 0 || size <= 0) return Infinity;
  return (want * (size + 1)) / (held + 1);
}

/** Draws to packs. You cannot buy a third of a pack. */
export function drawsToPacks(draws: number): number {
  return Math.ceil(draws / CARDS_PER_PACK);
}

/** Deterministic PRNG, so a cost is the same number every time it is shown. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Target {
  /** Copies of this card in the box. */
  held: number;
  /** Copies wanted. */
  want: number;
}

/**
 * Passes through the box needed before a target can even be met.
 *
 * A box stocks a fixed number of copies, so wanting three of a card it holds one
 * of is not a matter of luck — it is three resets, and no amount of packs in a
 * single box will do it. Missing this reads as "keep opening and you will get
 * there", which is exactly the false promise this module exists to avoid.
 */
export function resetsNeeded(targets: Target[]): number {
  let most = 1;
  for (const target of targets) {
    if (target.held <= 0) continue;
    most = Math.max(most, Math.ceil(target.want / target.held));
  }
  return most;
}

/**
 * Draws to satisfy EVERY target out of one box.
 *
 * You stop when the last of them lands, so this is the expectation of a maximum
 * over draws that are not independent — two cards compete for the same slots in
 * the same pile. There is no tidy closed form for that, so the pile is dealt.
 *
 * Only the target copies are placed. The other ~580 cards in a box are
 * interchangeable filler, and shuffling them was the whole cost of this
 * function; drawing the target positions as a random subset of the pile is the
 * same distribution for a fraction of the work. Where the box has to be reset,
 * each pass is dealt afresh, because a reset really is a new pile.
 *
 * Seeded and fixed-trial, so it stays a pure function: the same gap always
 * prices at the same number rather than flickering between renders.
 */
export function simulateDraws(
  size: number,
  targets: Target[],
  seed: number,
): { mean: number; p50: number; p90: number } {
  if (targets.length === 0) return { mean: 0, p50: 0, p90: 0 };

  const rand = mulberry32(seed);
  const passes = resetsNeeded(targets);

  // One label per target copy in the box, dealt fresh each pass.
  const labels: number[] = [];
  for (const [i, target] of targets.entries()) {
    for (let c = 0; c < target.held; c++) labels.push(i);
  }
  const slots = labels.length;
  if (slots === 0 || slots > size) return { mean: Infinity, p50: Infinity, p90: Infinity };

  const results: number[] = [];
  const seen = new Array<number>(targets.length);
  const positions = new Int32Array(slots);
  // Reused across every trial. Partial Fisher-Yates over it draws a distinct
  // subset in O(slots) with no allocation and no membership set, then the same
  // swaps are undone so the next trial starts from a clean pile.
  const pile = new Int32Array(size);
  for (let i = 0; i < size; i++) pile[i] = i;
  const swaps = new Int32Array(slots);

  for (let trial = 0; trial < TRIALS; trial++) {
    seen.fill(0);
    let remaining = targets.length;
    let drawn = size * passes;

    for (let pass = 0; pass < passes && remaining > 0; pass++) {
      for (let i = 0; i < slots; i++) {
        const j = i + Math.floor(rand() * (size - i));
        swaps[i] = j;
        const tmp = pile[i] as number;
        pile[i] = pile[j] as number;
        pile[j] = tmp;
        positions[i] = pile[i] as number;
      }
      for (let i = slots - 1; i >= 0; i--) {
        const j = swaps[i] as number;
        const tmp = pile[i] as number;
        pile[i] = pile[j] as number;
        pile[j] = tmp;
      }
      positions.sort();

      // Which target sits at which of those positions is itself uniform.
      for (let i = slots - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = labels[i] as number;
        labels[i] = labels[j] as number;
        labels[j] = tmp;
      }

      for (let i = 0; i < slots; i++) {
        const t = labels[i] as number;
        const target = targets[t] as Target;
        if (seen[t] === target.want) continue;
        seen[t] = (seen[t] as number) + 1;
        if (seen[t] === target.want && --remaining === 0) {
          drawn = pass * size + (positions[i] as number) + 1;
          break;
        }
      }
    }
    results.push(drawn);
  }

  results.sort((a, b) => a - b);
  // A single target has an exact mean, so use it rather than the sampled one —
  // but take the percentiles from the deal either way. Collapsing them onto the
  // mean, as an earlier version did, made "unlucky case" print the expected
  // value: a spread of exactly zero on a process that is nothing but spread.
  const sampled = results.reduce((sum, v) => sum + v, 0) / results.length;
  const only = targets.length === 1 ? (targets[0] as Target) : null;
  return {
    mean: only ? expectedDraws(size, only.held, only.want) : sampled,
    p50: results[Math.floor(results.length * 0.5)] as number,
    p90: results[Math.floor(results.length * 0.9)] as number,
  };
}

/** A stable seed per box, so two runs of the same gap agree to the digit. */
function seedFor(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A box route we are willing to price. */
function priceableBox(route: AcquisitionRoute, boxes: BoxIndex): BoxSet | null {
  if (route.kind !== "set" || !route.amount) return null;
  const box = boxes.get(normalizeName(route.name));
  if (!box || box.packs === undefined || box.copies <= 0) return null;
  return box;
}

/**
 * Prices a shortfall.
 *
 * Cards are assigned to boxes before anything is simulated, and the assignment
 * matters more than the arithmetic does: chasing three cards out of one box is
 * far cheaper than chasing them one at a time, because the same packs are doing
 * all three jobs. So a card that could come from either of two boxes is sent to
 * whichever is already being opened. That is greedy rather than optimal — the
 * exact version is a set-cover — but it errs toward consolidating, which is
 * both the cheaper answer and the one a player would actually take.
 */
export function costOf(missing: DeckEntry[], cards: CardIndex, boxes: BoxIndex): AcquisitionCost {
  const free: FreeAcquisition[] = [];
  const unpriced: UnpricedAcquisition[] = [];
  const unknown: { card: string; copies: number }[] = [];

  /** Cards still needing a box, with every box that could supply them. */
  const pending: { name: string; copies: number; rarity?: CardRarity; options: Map<string, BoxSet> }[] = [];

  for (const entry of missing) {
    if (entry.copies <= 0) continue;
    const card: Card | undefined = cards.get(normalizeName(entry.name));
    const routes = card?.routes ?? [];
    const rarity = card?.rarity;

    // A route that costs no gems always wins. This is the rule that stops the
    // app sending someone to a box for a card a character simply hands them.
    const gift = routes.find((r) => r.kind === "character" || r.kind === "other");
    if (gift) {
      free.push({ card: entry.name, copies: entry.copies, via: gift.name, detail: gift.detail, rarity });
      continue;
    }

    const options = new Map<string, BoxSet>();
    for (const route of routes) {
      const box = priceableBox(route, boxes);
      if (box) options.set(normalizeName(box.name), box);
    }
    if (options.size > 0) {
      pending.push({ name: entry.name, copies: entry.copies, rarity, options });
      continue;
    }

    // Left over: a real route into a box we will not put a number on, or none.
    const set = routes.find((r) => r.kind === "set");
    if (set) {
      const box = boxes.get(normalizeName(set.name));
      unpriced.push({
        card: entry.name,
        copies: entry.copies,
        via: box ? `${box.type} · ${box.name}` : set.name,
        suspect: box?.suspect,
        rarity,
      });
    } else {
      unknown.push({ card: entry.name, copies: entry.copies });
    }
  }

  // Greedy consolidation: repeatedly commit to the box that serves the most
  // outstanding cards, so shared packs are counted once rather than per card.
  const assigned = new Map<string, typeof pending>();
  const left = [...pending];
  while (left.length > 0) {
    const tally = new Map<string, number>();
    for (const item of left) {
      for (const key of item.options.keys()) tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of tally) {
      // Tie-break on name so the choice cannot depend on Map ordering.
      if (count > bestCount || (count === bestCount && best !== null && key < best)) {
        best = key;
        bestCount = count;
      }
    }
    if (best === null) break;
    const taken = left.filter((item) => item.options.has(best as string));
    assigned.set(best, taken);
    for (const item of taken) left.splice(left.indexOf(item), 1);
  }

  const plans: BoxPlan[] = [];
  for (const [key, items] of assigned) {
    const box = items[0]?.options.get(key);
    if (!box || box.packs === undefined) continue;

    const targets: Target[] = [];
    const listed: BoxPlan["cards"] = [];
    for (const item of items) {
      const card = cards.get(normalizeName(item.name));
      const route = card?.routes?.find(
        (r) => r.kind === "set" && normalizeName(r.name) === key && r.amount,
      );
      const held = route?.amount ?? 0;
      if (held <= 0) continue;
      targets.push({ held, want: item.copies });
      listed.push({ name: item.name, copies: item.copies, inBox: held, rarity: item.rarity });
    }
    if (targets.length === 0) continue;

    const draws = simulateDraws(box.copies, targets, seedFor(box.name));
    // Emptying the box is a hard ceiling — past that the copies are yours by
    // exhaustion. But it is the ceiling on ONE pass, and a card the box stocks
    // one of, wanted three times, needs three resets. Capping at a single box
    // there would quote a third of the real price for the most expensive kind
    // of gap there is.
    const cap = box.packs * resetsNeeded(targets);
    const packs = Math.min(drawsToPacks(draws.mean), cap);
    plans.push({
      box: box.name,
      type: box.type,
      cards: listed,
      packs,
      medianPacks: Math.min(drawsToPacks(draws.p50), cap),
      p90Packs: Math.min(drawsToPacks(draws.p90), cap),
      gems: packs * GEMS_PER_PACK,
      boxPacks: cap,
      resets: resetsNeeded(targets),
    });
  }

  plans.sort((a, b) => b.gems - a.gems || a.box.localeCompare(b.box, "en"));
  const packs = plans.reduce((sum, p) => sum + p.packs, 0);

  return {
    gems: packs * GEMS_PER_PACK,
    packs,
    boxes: plans,
    free,
    unpriced,
    unknown,
    complete: unpriced.length === 0 && unknown.length === 0,
  };
}
