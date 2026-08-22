/**
 * The cost engine's job is to be right about gems, and — where it cannot be —
 * to be visibly incomplete rather than quietly cheap. Both halves are tested.
 */
import { describe, expect, it } from "vitest";
import {
  costOf,
  drawsToPacks,
  expectedDraws,
  GEMS_PER_PACK,
  indexBoxes,
  resetsNeeded,
  simulateDraws,
} from "./acquisition.ts";
import { normalizeName } from "./banlist-index.ts";
import type { AcquisitionRoute, BoxSet, Card } from "../data/types.ts";
import type { CardIndex } from "./types.ts";

function card(name: string, routes: AcquisitionRoute[], rarity?: Card["rarity"]): Card {
  return {
    id: name.length * 31,
    name,
    type: "Effect Monster",
    race: "Warrior",
    desc: "",
    isExtraDeck: false,
    rarity,
    routes,
  };
}

function index(cards: Card[]): CardIndex {
  return new Map(cards.map((c) => [normalizeName(c.name), c]));
}

const mainBox: BoxSet = {
  type: "Main Box",
  name: "Abyss Encounters",
  cards: 100,
  copies: 600,
  packs: 200,
  byRarity: { UR: 10 },
};

const otherBox: BoxSet = {
  type: "Main Box",
  name: "Valiant Souls",
  cards: 100,
  copies: 600,
  packs: 200,
  byRarity: { UR: 10 },
};

const brokenBox: BoxSet = {
  type: "Mini Box",
  name: "Scream of Resistance",
  cards: 50,
  copies: 50,
  byRarity: {},
  suspect: "copy counts are not real",
};

const structure: BoxSet = {
  type: "Structure Deck",
  name: "Dragonic Force",
  cards: 40,
  copies: 40,
  byRarity: {},
};

const boxes = indexBoxes([mainBox, otherBox, brokenBox, structure]);

const inBox = (amount: number, box = mainBox.name): AcquisitionRoute => ({
  kind: "set",
  name: box,
  setType: "Main Box",
  amount,
});

describe("expectedDraws", () => {
  it("is the expected position of the k-th copy in a shuffled pile", () => {
    // 1 copy of a card in a pile of 599 others sits, on average, halfway down.
    expect(expectedDraws(599, 1, 1)).toBe(300);
    // Three copies in a pile of 599 split it into four: the first lands at 150.
    expect(expectedDraws(599, 3, 1)).toBe(150);
  });

  it("scales linearly in the copies wanted", () => {
    expect(expectedDraws(599, 3, 2)).toBe(300);
    expect(expectedDraws(599, 3, 3)).toBe(450);
  });

  it("keeps working past a single box, which is what a reset is", () => {
    // Wanting 6 copies of a card the box stocks 3 of means resetting it. The
    // copies already pulled are kept, so the cost stays linear.
    expect(expectedDraws(599, 3, 6)).toBe(900);
  });

  it("is infinite for a card the box does not hold", () => {
    expect(expectedDraws(600, 0, 1)).toBe(Infinity);
  });

  it("costs nothing when nothing is wanted", () => {
    expect(expectedDraws(600, 3, 0)).toBe(0);
  });
});

describe("simulateDraws", () => {
  it("takes the exact mean for a single target rather than the sampled one", () => {
    const only = simulateDraws(600, [{ held: 3, want: 2 }], 1);
    expect(only.mean).toBeCloseTo(expectedDraws(600, 3, 2), 10);
  });

  it("still spreads a single target's percentiles around that mean", () => {
    // A lone pull is ALL variance, so a p90 sitting on the mean would be a lie.
    const only = simulateDraws(600, [{ held: 3, want: 2 }], 1);
    expect(only.p90).toBeGreaterThan(only.mean);
    expect(only.p50).toBeLessThan(only.p90);
  });

  it("samples a mean close to the arithmetic, which is what validates the deal", () => {
    // The simulation is the only thing pricing multi-card gaps, so it has to be
    // right where the closed form can check it.
    const sampled = simulateDraws(600, [{ held: 6, want: 2 }], 7);
    expect(sampled.p50).toBeGreaterThan(0);
    expect(Math.abs(sampled.mean - expectedDraws(600, 6, 2))).toBeLessThan(1);
  });

  it("costs more to finish two cards than either alone", () => {
    const one = simulateDraws(600, [{ held: 3, want: 1 }], 11).mean;
    const two = simulateDraws(600, [{ held: 3, want: 1 }, { held: 3, want: 1 }], 11).mean;
    expect(two).toBeGreaterThan(one);
    // …but nowhere near twice as much: the same packs serve both.
    expect(two).toBeLessThan(one * 2);
  });

  it("orders its percentiles and never exceeds the pile", () => {
    const draws = simulateDraws(600, [{ held: 1, want: 1 }, { held: 2, want: 2 }], 3);
    expect(draws.p50).toBeLessThanOrEqual(draws.p90);
    expect(draws.p90).toBeLessThanOrEqual(600);
  });

  it("is deterministic, so a cost does not move between renders", () => {
    const targets = [{ held: 2, want: 2 }, { held: 5, want: 1 }];
    expect(simulateDraws(600, targets, 42)).toEqual(simulateDraws(600, targets, 42));
  });

  it("costs nothing with no targets", () => {
    expect(simulateDraws(600, [], 1)).toEqual({ mean: 0, p50: 0, p90: 0 });
  });
});

describe("resetsNeeded", () => {
  it("is one when the box stocks enough copies", () => {
    expect(resetsNeeded([{ held: 3, want: 3 }])).toBe(1);
  });

  it("counts a reset per box-worth of copies wanted", () => {
    expect(resetsNeeded([{ held: 1, want: 3 }])).toBe(3);
    expect(resetsNeeded([{ held: 2, want: 3 }])).toBe(2);
  });

  it("takes the scarcest card, since one pass serves them all", () => {
    expect(resetsNeeded([{ held: 6, want: 3 }, { held: 1, want: 2 }])).toBe(2);
  });
});

describe("drawsToPacks", () => {
  it("rounds up, because a pack cannot be bought in thirds", () => {
    expect(drawsToPacks(3)).toBe(1);
    expect(drawsToPacks(4)).toBe(2);
  });
});

describe("costOf", () => {
  it("prices a box pull in gems and packs", () => {
    const cards = index([card("Aluber", [inBox(1)], "UR")]);
    const cost = costOf([{ name: "Aluber", copies: 1 }], cards, boxes);

    expect(cost.boxes).toHaveLength(1);
    expect(cost.boxes[0]?.box).toBe("Abyss Encounters");
    expect(cost.gems).toBe(cost.packs * GEMS_PER_PACK);
    expect(cost.complete).toBe(true);
    // One copy, alone in a pile of 600: (600+1)/2 = 300.5 draws, so 101 packs.
    expect(cost.packs).toBe(101);
    expect(cost.gems).toBe(101 * GEMS_PER_PACK);
  });

  it("reports a free card as free, never as zero gems", () => {
    // The whole point: a card a character hands you must not send anyone to a box.
    const cards = index([
      card("Sphere Kuriboh", [
        { kind: "set", name: mainBox.name, setType: "Main Box", amount: 1 },
        { kind: "character", name: "Yugi Muto", detail: "Level 10" },
      ], "UR"),
    ]);
    const cost = costOf([{ name: "Sphere Kuriboh", copies: 2 }], cards, boxes);

    expect(cost.gems).toBe(0);
    expect(cost.boxes).toEqual([]);
    expect(cost.free).toEqual([
      { card: "Sphere Kuriboh", copies: 2, via: "Yugi Muto", detail: "Level 10", rarity: "UR" },
    ]);
    expect(cost.complete).toBe(true);
  });

  it("consolidates cards that share a box instead of paying per card", () => {
    const cards = index([
      card("A", [inBox(2)]),
      card("B", [inBox(2)]),
      card("C", [inBox(2)]),
    ]);
    const cost = costOf(
      [{ name: "A", copies: 1 }, { name: "B", copies: 1 }, { name: "C", copies: 1 }],
      cards,
      boxes,
    );
    expect(cost.boxes).toHaveLength(1);
    expect(cost.boxes[0]?.cards).toHaveLength(3);

    const alone = costOf([{ name: "A", copies: 1 }], cards, boxes);
    expect(cost.packs).toBeGreaterThan(alone.packs);
    expect(cost.packs).toBeLessThan(alone.packs * 3);
  });

  it("sends a card into the box already being opened when it has a choice", () => {
    const cards = index([
      card("Anchor", [inBox(2)]),
      // Available from either box; consolidating is the cheaper answer.
      card("Roamer", [inBox(2, otherBox.name), inBox(2)]),
    ]);
    const cost = costOf([{ name: "Anchor", copies: 1 }, { name: "Roamer", copies: 1 }], cards, boxes);
    expect(cost.boxes).toHaveLength(1);
    expect(cost.boxes[0]?.box).toBe(mainBox.name);
  });

  it("never charges more than emptying the box, when one box can supply it", () => {
    // Past a full drain the copies are yours by exhaustion, so no estimate
    // above that can be true.
    const cards = index([card("Plentiful", [inBox(6)])]);
    const cost = costOf([{ name: "Plentiful", copies: 3 }], cards, boxes);
    expect(cost.packs).toBeLessThanOrEqual(mainBox.packs as number);
    expect(cost.boxes[0]?.resets).toBe(1);
  });

  it("charges for the resets a scarce card forces, rather than capping at one box", () => {
    // The box stocks ONE copy. Three copies is three resets, and no number of
    // packs in a single box will produce them — capping here would quote a
    // third of the real price for the most expensive kind of gap there is.
    const cards = index([card("Scarce", [inBox(1)])]);
    const cost = costOf([{ name: "Scarce", copies: 3 }], cards, boxes);

    expect(cost.boxes[0]?.resets).toBe(3);
    expect(cost.packs).toBeGreaterThan(mainBox.packs as number);
    // Three passes at ~half a box each: (600+1)/2 × 3 = 901.5 draws → 301 packs.
    expect(cost.packs).toBe(301);
    expect(cost.boxes[0]?.boxPacks).toBe(600);
  });

  it("refuses to price a box whose copy counts are not real", () => {
    const cards = index([
      card("Ghost", [{ kind: "set", name: brokenBox.name, setType: "Mini Box", amount: 1 }], "UR"),
    ]);
    const cost = costOf([{ name: "Ghost", copies: 1 }], cards, boxes);

    expect(cost.gems).toBe(0);
    expect(cost.unpriced).toHaveLength(1);
    expect(cost.unpriced[0]?.suspect).toMatch(/not real/);
    // The gap is NOT closed, and the total must say so.
    expect(cost.complete).toBe(false);
  });

  it("leaves a Structure Deck unpriced rather than treating it as a pull", () => {
    const cards = index([
      card("Fixed", [{ kind: "set", name: structure.name, setType: "Structure Deck", amount: 1 }]),
    ]);
    const cost = costOf([{ name: "Fixed", copies: 1 }], cards, boxes);
    expect(cost.unpriced[0]?.via).toBe("Structure Deck · Dragonic Force");
    expect(cost.complete).toBe(false);
  });

  it("counts a card with no route as unknown, not as free", () => {
    // The dangerous direction is a total that reads cheap because data was thin.
    const cards = index([card("Mystery", [])]);
    const cost = costOf([{ name: "Mystery", copies: 3 }], cards, boxes);

    expect(cost.unknown).toEqual([{ card: "Mystery", copies: 3 }]);
    expect(cost.free).toEqual([]);
    expect(cost.gems).toBe(0);
    expect(cost.complete).toBe(false);
  });

  it("counts a card missing from the pool entirely as unknown", () => {
    const cost = costOf([{ name: "Not In Pool", copies: 1 }], index([]), boxes);
    expect(cost.unknown).toHaveLength(1);
    expect(cost.complete).toBe(false);
  });

  it("costs nothing for an empty shortfall", () => {
    const cost = costOf([], index([]), boxes);
    expect(cost).toMatchObject({ gems: 0, packs: 0, complete: true });
  });

  it("ignores an entry that is not actually short", () => {
    const cards = index([card("A", [inBox(2)])]);
    expect(costOf([{ name: "A", copies: 0 }], cards, boxes).boxes).toEqual([]);
  });

  it("orders percentiles so the unlucky case is never below the expected one", () => {
    const cards = index([card("A", [inBox(1)]), card("B", [inBox(1)])]);
    const plan = costOf([{ name: "A", copies: 1 }, { name: "B", copies: 1 }], cards, boxes).boxes[0];
    expect(plan?.medianPacks).toBeLessThanOrEqual(plan?.p90Packs as number);
  });
});
