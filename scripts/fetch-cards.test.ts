/**
 * Covers the pure half of the card-pool build.
 *
 * The regression this suite exists for: "Black Feather Whirlwind" released in
 * Duel Links on 2026-07-28, YGOPRODeck never flagged it `format=duel links`,
 * and it was therefore missing from the search pool along with ~2,500 others.
 * Membership now comes from duellinksmeta, so a card the flag misses still
 * lands in the pool.
 */
import { describe, expect, it } from "vitest";
import {
  assertPoolSane,
  assertSetsSane,
  attachAcquisition,
  deriveSets,
  projectRoutes,
  isExtraDeckType,
  isReleased,
  mergePool,
  projectFromDlm,
  synthesizeType,
  SYNTHETIC_ID_BASE,
  type DlmCard,
  type YgoCard,
} from "./lib/duel-links-pool.ts";
import type { Card } from "../src/data/types.ts";
import { broadType, typeLabel } from "../src/screens/Collection.tsx";

const NOW = Date.parse("2026-08-13T00:00:00.000Z");

function dlm(over: Partial<DlmCard> & { name: string }): DlmCard {
  return { type: "Monster", race: "Warrior", release: "2020-01-01T00:00:00.000Z", ...over };
}

function ygo(over: Partial<YgoCard> & { name: string; id: number }): YgoCard {
  return { type: "Effect Monster", race: "Warrior", desc: "", ...over };
}

describe("isReleased", () => {
  it("takes cards Duel Links has already put out", () => {
    expect(isReleased(dlm({ name: "Out", release: "2026-07-28T05:00:00.000Z" }), NOW)).toBe(true);
  });

  it("rejects Rush Duel, undated and future cards", () => {
    expect(isReleased(dlm({ name: "Rush", rush: true }), NOW)).toBe(false);
    expect(isReleased(dlm({ name: "Undated", release: undefined }), NOW)).toBe(false);
    expect(isReleased(dlm({ name: "Later", release: "2026-12-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isReleased(dlm({ name: "Junk", release: "not a date" }), NOW)).toBe(false);
  });
});

describe("synthesizeType", () => {
  const cases: [string[], string, string][] = [
    [[], "Spell", "Spell Card"],
    [[], "Trap", "Trap Card"],
    [[], "Monster", "Normal Monster"],
    [["Normal"], "Monster", "Normal Monster"],
    [["Effect"], "Monster", "Effect Monster"],
    [["Effect", "Tuner"], "Monster", "Tuner Monster"],
    [["Synchro", "Effect"], "Monster", "Synchro Monster"],
    [["Synchro", "Tuner", "Effect"], "Monster", "Synchro Tuner Monster"],
    [["Xyz", "Effect"], "Monster", "XYZ Monster"],
    [["Link", "Effect"], "Monster", "Link Monster"],
    [["Fusion", "Effect"], "Monster", "Fusion Monster"],
    [["Flip", "Effect"], "Monster", "Flip Effect Monster"],
    [["Union", "Effect"], "Monster", "Union Effect Monster"],
    [["Ritual", "Effect"], "Monster", "Ritual Effect Monster"],
    [["Pendulum", "Effect"], "Monster", "Pendulum Effect Monster"],
    [["Toon", "Effect"], "Monster", "Toon Monster"],
    [["Spirit", "Effect"], "Monster", "Spirit Monster"],
    [["Gemini", "Effect"], "Monster", "Gemini Monster"],
  ];

  for (const [monsterType, type, expected] of cases) {
    it(`${type} [${monsterType.join(",")}] → ${expected}`, () => {
      expect(synthesizeType(dlm({ name: "x", type, monsterType }))).toBe(expected);
    });
  }

  it("round-trips through every consumer of the type string", () => {
    for (const [monsterType, type, expected] of cases) {
      const card = projectFromDlm(dlm({ name: "x", type, monsterType, race: "Continuous" }));
      const extra = ["Fusion", "Synchro", "Xyz", "Link"].some((m) => monsterType.includes(m));

      expect(isExtraDeckType(expected)).toBe(extra);
      expect(card.isExtraDeck).toBe(extra);
      expect(broadType(card)).toBe(type === "Monster" ? "Monster" : type);
      // The Collection screen renders this directly — it must never come out blank.
      expect(typeLabel(card)).toMatch(/^(MONSTER|SPELL|TRAP)\/\S/);
    }
  });

  it("treats duellinksmeta's explicit extra-deck marker as Extra Deck", () => {
    expect(projectFromDlm(dlm({ name: "x", monsterType: ["extra-deck", "Effect"] })).isExtraDeck).toBe(true);
  });
});

describe("projectFromDlm", () => {
  it("uses the Konami passcode as the id when there is one", () => {
    expect(projectFromDlm(dlm({ name: "Real", konamiID: "7602800" })).id).toBe(7602800);
  });

  it("gives passcode-less Duel Links exclusives a stable id outside passcode range", () => {
    const exclusive = dlm({ name: "Amazoness Arena", _id: "60c2b3a9a0e24f2d54a51341", type: "Spell" });
    const first = projectFromDlm(exclusive);
    expect(first.id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE);
    // Saved collections key on this id, so it must not move between runs.
    expect(projectFromDlm(exclusive).id).toBe(first.id);
  });

  it("steps off an id that is already taken rather than colliding", () => {
    const exclusive = dlm({ name: "Clash", _id: "abc" });
    const natural = projectFromDlm(exclusive).id;
    expect(projectFromDlm(exclusive, new Set([natural])).id).toBe(natural + 1);
  });
});

describe("attachAcquisition", () => {
  const card = (name: string): Card => ({
    id: 1,
    name,
    type: "Effect Monster",
    race: "Warrior",
    desc: "",
    isExtraDeck: false,
  });

  it("copies rarity and the first acquisition source off the duellinksmeta record", () => {
    const cards = [card("Sphere Kuriboh")];
    const covered = attachAcquisition(cards, [
      dlm({
        name: "Sphere Kuriboh",
        rarity: "UR",
        obtain: [
          { source: { type: "Main Box", name: "Abyss Encounters" } },
          { source: { type: "Event", name: "Some Campaign" } },
        ],
      }),
    ]);
    expect(covered).toBe(1);
    expect(cards[0]?.rarity).toBe("UR");
    // The first source is still the headline, but the rest are no longer lost.
    expect(cards[0]?.obtainedFrom).toEqual({ type: "Main Box", name: "Abyss Encounters" });
    expect(cards[0]?.routes).toHaveLength(2);
  });

  it("matches on the folded name, so typography does not break the join", () => {
    const cards = [card("Battlin' Boxing Cross Counter")];
    attachAcquisition(cards, [dlm({ name: "Battlin' Boxing Cross Counter", rarity: "SR" })]);
    expect(cards[0]?.rarity).toBe("SR");
  });

  it("leaves a card untouched when duellinksmeta has no record of it", () => {
    const cards = [card("Unknown Card")];
    expect(attachAcquisition(cards, [dlm({ name: "Something Else", rarity: "UR" })])).toBe(0);
    expect(cards[0]?.rarity).toBeUndefined();
    expect(cards[0]?.obtainedFrom).toBeUndefined();
  });

  it("ignores a rarity outside the four Duel Links grades", () => {
    const cards = [card("Odd One")];
    expect(attachAcquisition(cards, [dlm({ name: "Odd One", rarity: "Secret Rare" })])).toBe(0);
    expect(cards[0]?.rarity).toBeUndefined();
  });

  it("skips obtain entries that name no source", () => {
    const cards = [card("Vague")];
    attachAcquisition(cards, [
      dlm({ name: "Vague", rarity: "R", obtain: [{ amount: 1 }, { source: { name: "Structure Deck EX" } }] }),
    ]);
    expect(cards[0]?.obtainedFrom).toEqual({ type: "Unknown", name: "Structure Deck EX" });
  });
});

describe("mergePool", () => {
  it("carries rarity onto pool cards, including ones with no release date", () => {
    const flagged = [ygo({ name: "Kept", id: 5, desc: "long enough" })];
    // "Kept" has no duellinksmeta release, so it is not in the released subset —
    // but it is still in the pool, and still has a rarity worth showing.
    const { cards, rarityCovered } = mergePool(flagged, flagged, [], [
      dlm({ name: "Kept", rarity: "SR", obtain: [{ source: { type: "Mini Box", name: "Voltage Vortex" } }] }),
    ]);
    expect(rarityCovered).toBe(1);
    expect(cards[0]?.rarity).toBe("SR");
    expect(cards[0]?.obtainedFrom?.name).toBe("Voltage Vortex");
  });

  it("defaults the acquisition lookup to the released list when none is given", () => {
    const flagged = [ygo({ name: "Plain", id: 6, desc: "long enough" })];
    const { rarityCovered } = mergePool(flagged, flagged, [dlm({ name: "Plain", rarity: "N" })]);
    expect(rarityCovered).toBe(1);
  });

  const whirlwind = dlm({
    name: "Black Feather Whirlwind",
    _id: "62ddd693d4d4b99dbbc9567f",
    konamiID: "7602800",
    type: "Spell",
    race: "Continuous",
    description: "Once per turn, if you Special Summon a DARK Synchro Monster…",
    release: "2026-07-28T05:00:00.000Z",
  });

  it("recovers a released card that YGOPRODeck never flagged for Duel Links", () => {
    const flagged = [ygo({ id: 91351370, name: "Black Whirlwind", type: "Spell Card", race: "Continuous" })];
    const full = [...flagged, ygo({ id: 7602800, name: "Black Feather Whirlwind", type: "Spell Card", race: "Continuous", desc: "Once per turn…" })];

    const { cards, addedFromDlm } = mergePool(flagged, full, [whirlwind]);

    expect(addedFromDlm.map((c) => c.name)).toEqual(["Black Feather Whirlwind"]);
    const found = cards.find((c) => c.name === "Black Feather Whirlwind");
    expect(found).toMatchObject({ id: 7602800, type: "Spell Card", race: "Continuous", isExtraDeck: false });
    // …and does not displace the separate card it is easily confused with.
    expect(cards.find((c) => c.name === "Black Whirlwind")?.id).toBe(91351370);
  });

  it("prefers YGOPRODeck detail over duellinksmeta when both know the card", () => {
    const full = [ygo({ id: 2009101, name: "Gale", type: "Tuner Monster", archetype: "Blackwing", desc: "real text" })];
    const { cards } = mergePool([], full, [dlm({ name: "Gale", konamiID: "2009101", description: "short" })]);
    expect(cards[0]).toMatchObject({ type: "Tuner Monster", archetype: "Blackwing", desc: "real text" });
  });

  it("falls back to duellinksmeta for cards no other database has", () => {
    const exclusive = dlm({ name: "Cosmos", _id: "dl-only", monsterType: ["Effect"], race: "Plant", attribute: "DARK", level: 3, atk: 600, def: 900, description: "…" });
    const { cards } = mergePool([], [], [exclusive]);
    expect(cards[0]).toMatchObject({ name: "Cosmos", type: "Effect Monster", race: "Plant", attribute: "DARK", level: 3 });
    expect(cards[0]!.id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE);
  });

  it("keeps YGOPRODeck-flagged cards duellinksmeta has no release for, and reports them", () => {
    const flagged = [ygo({ id: 29843091, name: "Ojama Trio", type: "Trap Card", race: "Normal" })];
    const { cards, unreleasedPerDlm } = mergePool(flagged, flagged, []);
    expect(cards.map((c) => c.name)).toContain("Ojama Trio");
    expect(unreleasedPerDlm.map((c) => c.name)).toEqual(["Ojama Trio"]);
  });

  it("drops Tokens, dedupes, and sorts by name", () => {
    const flagged = [
      ygo({ id: 1, name: "Zebra" }),
      ygo({ id: 2, name: "Sheep Token", type: "Token" }),
      ygo({ id: 3, name: "Apple" }),
    ];
    const { cards } = mergePool(flagged, flagged, [
      dlm({ name: "Zebra", konamiID: "1" }),
      dlm({ name: "Mango", konamiID: "4" }),
    ]);

    expect(cards.map((c) => c.name)).toEqual(["Apple", "Mango", "Zebra"]);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("matches on name when the passcodes disagree, so a card is not duplicated", () => {
    const flagged = [ygo({ id: 111, name: "Alt Art Guy" })];
    const { cards } = mergePool(flagged, flagged, [dlm({ name: "Alt Art Guy", konamiID: "999" })]);
    expect(cards).toHaveLength(1);
  });

  it("takes the in-game name so the scraped banlist can join on it", () => {
    // Duel Links ships TCG "Synchronized Realm" as "Synch Realm"; the Forbidden
    // list uses the in-game name, and it lists this card as forbidden.
    const flagged = [ygo({ id: 61032879, name: "Synchronized Realm", type: "Spell Card", race: "Continuous" })];
    const { cards, renamed } = mergePool(flagged, flagged, [
      dlm({ name: "Synch Realm", konamiID: "61032879", type: "Spell", race: "Continuous" }),
    ]);

    expect(cards.map((c) => c.name)).toEqual(["Synch Realm"]);
    expect(cards[0]!.id).toBe(61032879);
    expect(renamed).toEqual([{ from: "Synchronized Realm", to: "Synch Realm" }]);
  });

  it("refuses a rename that would collide with another card's name", () => {
    const flagged = [ygo({ id: 1, name: "Alpha" }), ygo({ id: 2, name: "Beta" })];
    const { cards, renamed } = mergePool(flagged, flagged, [dlm({ name: "Beta", konamiID: "1" })]);
    expect(cards.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
    expect(renamed).toEqual([]);
  });

  it("keeps both cards when duellinksmeta files two of them under one passcode", () => {
    // Real data: 6498706 is claimed by "Fusion Deployment" and by the Duel Links
    // exclusive "For Our Dreams". Trusting it drops the second card entirely.
    const flagged = [ygo({ id: 6498706, name: "Fusion Deployment", type: "Spell Card", race: "Normal" })];
    const { cards } = mergePool(flagged, flagged, [
      dlm({ name: "Fusion Deployment", konamiID: "6498706", type: "Spell", race: "Normal" }),
      dlm({ name: "For Our Dreams", konamiID: "6498706", type: "Trap", race: "Normal" }),
    ]);

    expect(cards.map((c) => c.name).sort()).toEqual(["For Our Dreams", "Fusion Deployment"]);
    // The disputed passcode stays with the card YGOPRODeck confirms owns it.
    expect(cards.find((c) => c.name === "Fusion Deployment")?.id).toBe(6498706);
    expect(cards.find((c) => c.name === "For Our Dreams")?.id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE);
  });

  it("joins an alt-art passcode back to its parent printing", () => {
    const full = [ygo({ id: 111, name: "Parent", card_images: [{ id: 111 }, { id: 222 }] })];
    const { cards } = mergePool([], full, [dlm({ name: "Parent (alt)", konamiID: "222" })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 111, name: "Parent" });
  });
});

describe("assertPoolSane", () => {
  const pool = (n: number) => Array.from({ length: n }, (_, i) => projectFromDlm(dlm({ name: `c${i}`, konamiID: String(i + 1) })));

  it("refuses an empty pool", () => {
    expect(() => assertPoolSane([], 8123)).toThrow(/empty/i);
  });

  it("refuses a pool that shrank past the guard", () => {
    expect(() => assertPoolSane(pool(6000), 8123)).toThrow(/shrank/i);
  });

  it("allows the large growth the two-source union produces", () => {
    expect(() => assertPoolSane(pool(10649), 8123)).not.toThrow();
  });

  it("allows a first run with nothing to compare against", () => {
    expect(() => assertPoolSane(pool(10), 0)).not.toThrow();
  });
});

describe("projectRoutes", () => {
  it("keeps every route, not just the first", () => {
    const routes = projectRoutes(
      dlm({
        name: "Sphere Kuriboh",
        obtain: [
          { type: "sets", amount: 1, source: { type: "Main Box", name: "The Ultimate Rising" } },
          { type: "characters", subSource: "Level 10", source: { name: "Yugi Muto" } },
          { type: "otherSources", source: { name: "Ranked Duels Ticket" } },
        ],
      }),
    );
    expect(routes).toEqual([
      { kind: "set", name: "The Ultimate Rising", setType: "Main Box", amount: 1 },
      { kind: "character", name: "Yugi Muto", detail: "Level 10" },
      { kind: "other", name: "Ranked Duels Ticket" },
    ]);
  });

  it("collapses a route the card lists twice", () => {
    // A character who both drops a card and grants it at a level lists twice
    // upstream; two identical rows read as two separate opportunities.
    const routes = projectRoutes(
      dlm({
        name: "Twice",
        obtain: [
          { type: "characters", subSource: "Drop", source: { name: "Mako Tsunami" } },
          { type: "characters", subSource: "Drop", source: { name: "Mako Tsunami" } },
        ],
      }),
    );
    expect(routes).toHaveLength(1);
  });

  it("drops an entry with no usable source name", () => {
    expect(projectRoutes(dlm({ name: "Nameless", obtain: [{ type: "sets", amount: 3 }] }))).toEqual([]);
  });

  it("never puts a copy count on a non-set route", () => {
    // `amount` is what the box math divides by. A character reward is one card,
    // and letting a stray amount through would price a free route as a pull.
    const routes = projectRoutes(
      dlm({ name: "Freebie", obtain: [{ type: "characters", amount: 9, source: { name: "Yugi Muto" } }] }),
    );
    expect(routes[0]?.amount).toBeUndefined();
  });
});

describe("deriveSets", () => {
  /** A box of `cards` distinct cards holding `each` copies apiece. */
  const box = (name: string, type: string, cards: number, each: number, rarity = "N"): DlmCard[] =>
    Array.from({ length: cards }, (_, i) =>
      dlm({
        name: `${name} card ${i}`,
        rarity,
        obtain: [{ type: "sets", amount: each, source: { type, name } }],
      }),
    );

  it("rebuilds a Main Box as the game's own structure", () => {
    const sets = deriveSets(box("Abyss Encounters", "Main Box", 100, 6));
    expect(sets[0]).toMatchObject({ type: "Main Box", name: "Abyss Encounters", cards: 100, copies: 600, packs: 200 });
  });

  it("counts copies by rarity, which is what rations a box", () => {
    const sets = deriveSets([...box("B", "Main Box", 2, 6, "UR"), ...box("B", "Main Box", 3, 6, "N")]);
    expect(sets[0]?.byRarity).toEqual({ UR: 12, N: 18 });
  });

  it("rounds a box that is a copy or two off, rather than refusing it", () => {
    // Raider's Requiem really does come back at 539 rather than 540. That moves
    // a price by 0.2%; refusing to answer would be the worse trade.
    const sets = deriveSets([...box("Raider's Requiem", "Main Box", 89, 6), ...box("Raider's Requiem", "Main Box", 1, 5)]);
    expect(sets[0]?.copies).toBe(539);
    expect(sets[0]?.packs).toBe(180);
    expect(sets[0]?.suspect).toBeUndefined();
  });

  it("refuses to price a box whose copy counts were never filled in", () => {
    // "Scream of Resistance" lists all 50 cards at one copy each. Priced, it
    // would claim a full box costs 17 packs against a real 100.
    const sets = deriveSets(box("Scream of Resistance", "Mini Box", 50, 1));
    expect(sets[0]?.copies).toBe(50);
    expect(sets[0]?.packs).toBeUndefined();
    expect(sets[0]?.suspect).toMatch(/not real/i);
  });

  it("leaves a Structure Deck unpriced without calling it suspect", () => {
    // It is bought whole, so there is no pack count to state — and that is not
    // a data problem the way an empty box is.
    const sets = deriveSets(box("Dragonic Force", "Structure Deck", 40, 1));
    expect(sets[0]?.packs).toBeUndefined();
    expect(sets[0]?.suspect).toBeUndefined();
  });

  it("excludes Rush Duel, which draws from different boxes", () => {
    const rush = box("Rush Box", "Main Box", 50, 6).map((c) => ({ ...c, rush: true }));
    expect(deriveSets(rush)).toEqual([]);
  });
});

describe("assertSetsSane", () => {
  const good = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      type: "Main Box",
      name: `box ${i}`,
      cards: 100,
      copies: 600,
      packs: 200,
      byRarity: {},
    }));

  it("refuses an empty table", () => {
    expect(() => assertSetsSane([], 60)).toThrow(/no boxes/i);
  });

  it("refuses a box with copies but no cards", () => {
    expect(() =>
      assertSetsSane([...good(9), { type: "Main Box", name: "hollow", cards: 0, copies: 600, byRarity: {} }], 0),
    ).toThrow(/parse failure/i);
  });

  it("refuses a collapse in box count", () => {
    expect(() => assertSetsSane(good(10), 100)).toThrow(/fell from/i);
  });

  it("tolerates the handful of boxes that are always unpriceable", () => {
    const sets = [...good(19), { type: "Mini Box", name: "broken", cards: 50, copies: 50, byRarity: {}, suspect: "x" }];
    expect(() => assertSetsSane(sets, 20)).not.toThrow();
  });

  it("refuses when the priceable share falls off a cliff", () => {
    const broken = Array.from({ length: 10 }, (_, i) => ({
      type: "Mini Box",
      name: `broken ${i}`,
      cards: 50,
      copies: 50,
      byRarity: {},
      suspect: "x",
    }));
    expect(() => assertSetsSane([...good(10), ...broken], 20)).toThrow(/changed shape/i);
  });
});
