import { describe, expect, it } from "vitest";
import { validateDeck, computeAllowance, countCopies } from "./validator.ts";
import { BanlistIndex } from "./banlist-index.ts";
import { DEFAULT_CONFIG, type Deck, type ValidationResult } from "./types.ts";
import type { Banlist } from "../data/types.ts";

const banlist: Banlist = {
  scrapedAt: "2026-08-12T00:00:00.000Z",
  source: "scrape",
  forbidden: ["Harpie's Feather Duster", "Sangan"],
  limited1: ["Sphere Kuriboh", "Treacherous Trap Hole"],
  limited2: ["Enemy Controller", "Book of Moon"],
  limited3: ["Cosmic Cyclone", "Wall of Disruption"],
};

/** Filler that draws on no pool, so size rules never mask a tier assertion. */
function filler(copies: number, from = 0): Deck["main"] {
  const out: Deck["main"] = [];
  let remaining = copies;
  let i = from;
  while (remaining > 0) {
    const take = Math.min(3, remaining);
    out.push({ name: `Filler ${i}`, copies: take });
    remaining -= take;
    i += 1;
  }
  return out;
}

function deckOf(entries: Deck["main"], extra: Deck["extra"] = []): Deck {
  const used = countCopies(entries);
  return { main: [...entries, ...filler(20 - used, 100)], extra };
}

function check(deck: Deck, config = DEFAULT_CONFIG): ValidationResult {
  return validateDeck(deck, banlist, config);
}

function codes(result: ValidationResult): string[] {
  return result.violations.map((v) => v.code);
}

describe("deck size", () => {
  it("accepts the 20-card minimum", () => {
    expect(check(deckOf([])).legal).toBe(true);
  });

  it("rejects 19 cards", () => {
    const result = check({ main: filler(19), extra: [] });
    expect(codes(result)).toContain("main-deck-size");
    expect(result.mainCount).toBe(19);
  });

  it("accepts 30 and rejects 31", () => {
    expect(check({ main: filler(30), extra: [] }).legal).toBe(true);
    expect(codes(check({ main: filler(31), extra: [] }))).toContain("main-deck-size");
  });

  it("rejects an Extra Deck over the configured cap", () => {
    const extra = [
      { name: "Fusion A", copies: 3 },
      { name: "Fusion B", copies: 3 },
    ];
    expect(codes(check(deckOf([], extra)))).toContain("extra-deck-size");
    // The cap is user-settable 5–9; at 9 the same six cards are fine.
    expect(check(deckOf([], extra), { ...DEFAULT_CONFIG, extraDeckSize: 9 }).legal).toBe(true);
  });
});

describe("copy limit", () => {
  it("rejects a 4th copy of one name", () => {
    const result = check({ main: [{ name: "Filler 1", copies: 4 }, ...filler(16, 2)], extra: [] });
    expect(codes(result)).toContain("copy-limit");
  });

  it("counts duplicate entries of the same name together", () => {
    const result = check({
      main: [
        { name: "Filler 1", copies: 2 },
        { name: "filler 1", copies: 2 },
        ...filler(16, 2),
      ],
      extra: [],
    });
    expect(codes(result)).toContain("copy-limit");
  });
});

describe("forbidden", () => {
  it("rejects any copy of a Forbidden card", () => {
    const result = check(deckOf([{ name: "Sangan", copies: 1 }]));
    expect(codes(result)).toContain("forbidden");
    expect(result.violations.find((v) => v.code === "forbidden")?.cards).toEqual(["Sangan"]);
  });

  it("matches Forbidden names case-insensitively", () => {
    expect(codes(check(deckOf([{ name: "sangan", copies: 1 }])))).toContain("forbidden");
  });
});

describe("Limited 1 — one card total from the whole pool", () => {
  it("allows one copy of one pool card", () => {
    expect(check(deckOf([{ name: "Sphere Kuriboh", copies: 1 }])).legal).toBe(true);
  });

  it("allows the other pool card instead", () => {
    expect(check(deckOf([{ name: "Treacherous Trap Hole", copies: 1 }])).legal).toBe(true);
  });

  it("allows neither", () => {
    expect(check(deckOf([])).legal).toBe(true);
  });

  // The mistake every naive implementation makes: both are "Limited 1", each at
  // one copy, so a per-card cap says legal. The pooled budget says illegal.
  it("rejects one of each — the pooled-budget case", () => {
    const result = check(
      deckOf([
        { name: "Sphere Kuriboh", copies: 1 },
        { name: "Treacherous Trap Hole", copies: 1 },
      ]),
    );
    expect(result.legal).toBe(false);
    const violation = result.violations.find((v) => v.code === "tier-budget");
    expect(violation?.tier).toBe(1);
    expect(violation?.used).toBe(2);
    expect(violation?.budget).toBe(1);
    expect(violation?.cards).toEqual(["Sphere Kuriboh", "Treacherous Trap Hole"]);
  });

  it("rejects two copies of a single Limited 1 card", () => {
    const result = check(deckOf([{ name: "Sphere Kuriboh", copies: 2 }]));
    expect(result.violations.find((v) => v.code === "tier-budget")?.tier).toBe(1);
  });
});

describe("Limited 2 — two cards total from the whole pool", () => {
  const A = "Enemy Controller";
  const B = "Book of Moon";

  it.each([
    ["AA", [{ name: A, copies: 2 }]],
    ["AB", [{ name: A, copies: 1 }, { name: B, copies: 1 }]],
    ["BB", [{ name: B, copies: 2 }]],
    ["A", [{ name: A, copies: 1 }]],
    ["B", [{ name: B, copies: 1 }]],
    ["none", []],
  ])("allows %s", (_label, entries) => {
    expect(check(deckOf(entries)).legal).toBe(true);
  });

  it.each([
    ["AAA", [{ name: A, copies: 3 }]],
    ["AAB", [{ name: A, copies: 2 }, { name: B, copies: 1 }]],
    ["AABB", [{ name: A, copies: 2 }, { name: B, copies: 2 }]],
  ])("rejects %s", (_label, entries) => {
    const result = check(deckOf(entries));
    expect(result.legal).toBe(false);
    expect(result.violations.find((v) => v.code === "tier-budget")?.tier).toBe(2);
  });
});

describe("Limited 3 — three cards total from the whole pool", () => {
  const A = "Cosmic Cyclone";
  const B = "Wall of Disruption";

  it.each([
    ["AAA", [{ name: A, copies: 3 }]],
    ["AAB", [{ name: A, copies: 2 }, { name: B, copies: 1 }]],
    ["ABB", [{ name: A, copies: 1 }, { name: B, copies: 2 }]],
    ["AB", [{ name: A, copies: 1 }, { name: B, copies: 1 }]],
  ])("allows %s", (_label, entries) => {
    expect(check(deckOf(entries)).legal).toBe(true);
  });

  it.each([
    ["AABB", [{ name: A, copies: 2 }, { name: B, copies: 2 }]],
    ["AAAB", [{ name: A, copies: 3 }, { name: B, copies: 1 }]],
  ])("rejects %s", (_label, entries) => {
    expect(check(deckOf(entries)).violations.find((v) => v.code === "tier-budget")?.tier).toBe(3);
  });
});

describe("tier budgets are independent of each other", () => {
  it("allows a full 6/6 spend across all three tiers", () => {
    const result = check(
      deckOf([
        { name: "Sphere Kuriboh", copies: 1 },
        { name: "Enemy Controller", copies: 1 },
        { name: "Book of Moon", copies: 1 },
        { name: "Cosmic Cyclone", copies: 2 },
        { name: "Wall of Disruption", copies: 1 },
      ]),
    );
    expect(result.legal).toBe(true);
    expect(result.allowance.spent).toBe(6);
    expect(result.allowance.tiers.map((t) => t.used)).toEqual([1, 2, 3]);
  });

  it("counts Extra Deck cards against the pooled budget too", () => {
    const result = check(deckOf([]), DEFAULT_CONFIG);
    expect(result.legal).toBe(true);
    const withExtra = check(
      deckOf([{ name: "Sphere Kuriboh", copies: 1 }], [{ name: "Treacherous Trap Hole", copies: 1 }]),
    );
    expect(withExtra.violations.find((v) => v.code === "tier-budget")?.tier).toBe(1);
  });
});

describe("reporting", () => {
  it("returns every violation, not just the first", () => {
    const result = check({
      main: [
        { name: "Sangan", copies: 4 },
        { name: "Sphere Kuriboh", copies: 1 },
        { name: "Treacherous Trap Hole", copies: 1 },
      ],
      extra: [],
    });
    expect(new Set(codes(result))).toEqual(
      new Set(["main-deck-size", "copy-limit", "forbidden", "tier-budget"]),
    );
  });

  it("names the card that spent each allowance slot", () => {
    const allowance = computeAllowance(
      { main: [{ name: "Enemy Controller", copies: 1 }, { name: "Book of Moon", copies: 1 }], extra: [] },
      new BanlistIndex(banlist),
    );
    expect(allowance.tiers[1].slots).toEqual([
      { name: "Enemy Controller", copies: 1 },
      { name: "Book of Moon", copies: 1 },
    ]);
    expect(allowance.tiers[1].used).toBe(2);
    expect(allowance.total).toBe(6);
  });

  it("is pure — validating does not mutate the deck", () => {
    const deck = deckOf([{ name: "Sphere Kuriboh", copies: 1 }]);
    const snapshot = JSON.stringify(deck);
    check(deck);
    expect(JSON.stringify(deck)).toBe(snapshot);
  });
});

describe("BanlistIndex", () => {
  it("caps copies by the tier's own budget", () => {
    const index = new BanlistIndex(banlist);
    expect(index.maxCopiesIgnoringPool("Sangan", 3)).toBe(0);
    expect(index.maxCopiesIgnoringPool("Sphere Kuriboh", 3)).toBe(1);
    expect(index.maxCopiesIgnoringPool("Enemy Controller", 3)).toBe(2);
    expect(index.maxCopiesIgnoringPool("Cosmic Cyclone", 3)).toBe(3);
    expect(index.maxCopiesIgnoringPool("Dark Magician", 3)).toBe(3);
  });
});
