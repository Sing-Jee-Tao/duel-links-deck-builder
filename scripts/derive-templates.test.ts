/**
 * Golden-file test over a saved slice of duellinksmeta's tournament corpus.
 *
 * The fixture holds 17 real lists across four deck types, chosen to exercise
 * every branch that decides whether a template exists at all: two Speed Duel
 * types with enough lists to survive, one Rush Duel type that must be dropped
 * outright, and one type with too few lists to be anything but noise. The card
 * pool is saved alongside so the test does not drift when `data/cards.json` is
 * refreshed weekly.
 *
 * If duellinksmeta changes the payload shape this breaks in CI rather than in
 * production — which matters, because a silently broken derivation produces
 * templates missing their core cards, and a template missing its core ranks a
 * player's collection against a deck that does not exist.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTemplatesSane,
  buildFlexSlots,
  classifyRole,
  deriveTemplates,
  MAX_DRIFT,
  median,
  tallyDeck,
  TemplateError,
  tierScoreFor,
  type DeriveResult,
  type DlmDeckType,
  type DlmTopDeck,
} from "./lib/derive-templates.ts";
import { fixturesDir } from "./lib/paths.ts";
import type { Card } from "../src/data/types.ts";

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8")) as T;

const topDecks = read<DlmTopDeck[]>("duellinksmeta-top-decks.json");
const deckTypes = read<DlmDeckType[]>("duellinksmeta-deck-types.json");
const pool = read<Card[]>("duellinksmeta-deck-pool.json");

/** Fixed, so the 180-day window covers the fixture no matter when this runs. */
const NOW = Date.parse("2026-08-14T00:00:00.000Z");

const derived = deriveTemplates(topDecks, deckTypes, pool, { now: NOW });
const byName = (name: string) => derived.templates.find((t) => t.name === name);

describe("deriveTemplates against the golden corpus", () => {
  it("keeps only deck types with enough recent Speed Duel lists", () => {
    expect(derived.templates.map((t) => t.name)).toEqual(["Traptrix", "ABC"]);
  });

  it("drops Rush Duel deck types by their flag, not by name", () => {
    const rush = deckTypes.filter((t) => t.rush).map((t) => t.name);
    expect(rush.length).toBeGreaterThan(0);
    // The fixture's Rush type is "Spellcasters" — nothing in the name says Rush,
    // which is exactly why the flag is the signal.
    expect(rush.some((name) => !/rush/i.test(name))).toBe(true);
    for (const name of rush) expect(byName(name)).toBeUndefined();
    expect(derived.stats.decksAfterRush).toBeLessThan(derived.stats.decksInWindow);
  });

  it("drops deck types below the minimum list count", () => {
    expect(derived.stats.deckTypes).toBe(3);
    expect(derived.templates).toHaveLength(2);
  });

  it("derives the Traptrix core at the copies the corpus actually plays", () => {
    expect(byName("Traptrix")?.coreCards).toEqual([
      { name: "Traptrip Garden", copies: 3 },
      { name: "Traptrix Pudica", copies: 3 },
      { name: "Traptrix Holeutea", copies: 3 },
      { name: "Traptrix Myrmeleo", copies: 3 },
      { name: "Traptrix Dionaea", copies: 2 },
      { name: "Traptrix Trap Hole Nightmare", copies: 1 },
      { name: "Terrifying Trap Hole Nightmare", copies: 1 },
      { name: "Nibiru, the Primal Being", copies: 3 },
    ]);
  });

  it("resolves every card name against the pool", () => {
    expect(derived.stats.unresolved).toEqual([]);
    expect(derived.stats.joinRate).toBe(1);
  });

  it("produces templates the validator can accept", () => {
    for (const template of derived.templates) {
      const core = template.coreCards.reduce((sum, c) => sum + c.copies, 0);
      const flex = template.flexSlots.reduce((sum, s) => sum + s.count, 0);
      const extra = template.extraDeck.reduce((sum, c) => sum + c.copies, 0);
      expect(core + flex).toBeGreaterThanOrEqual(20);
      expect(core + flex).toBeLessThanOrEqual(30);
      expect(extra).toBeLessThanOrEqual(9);
      for (const entry of [...template.coreCards, ...template.extraDeck]) {
        expect(entry.copies).toBeGreaterThanOrEqual(1);
        expect(entry.copies).toBeLessThanOrEqual(3);
      }
      for (const slot of template.flexSlots) expect(slot.candidates.length).toBeGreaterThan(0);
    }
  });

  it("marks templates as derived and records their provenance", () => {
    const traptrix = byName("Traptrix");
    expect(traptrix?.id).toBe("meta-traptrix");
    expect(traptrix?.meta?.deckCount).toBe(6);
    expect(traptrix?.meta?.windowDays).toBe(180);
    expect(traptrix?.meta?.skills[0]).toEqual({ name: "Traptrix Territory", count: 6 });
    expect(traptrix?.meta?.sampleUrl).toMatch(/^\//);
    // Every card the guide will show has to carry an inclusion rate.
    for (const entry of traptrix?.coreCards ?? []) {
      expect(traptrix?.meta?.inclusion[entry.name]).toBeGreaterThan(0);
    }
  });

  it("promotes the Skill the deck is actually played with", () => {
    // A Duel Links deck without its Skill is a different deck, so the one Skill
    // is first-class rather than buried in the distribution.
    expect(byName("Traptrix")?.meta?.skill).toEqual({ name: "Traptrix Territory", share: 1 });
    expect(byName("ABC")?.meta?.skill).toEqual({ name: "Hyper Cannon Activation", share: 1 });
  });

  it("takes the median gem price, not the mean", () => {
    // Traptrix: 52000 52000 63500 72000 78000 85000 -> (63500 + 72000) / 2
    expect(byName("Traptrix")?.meta?.gemsPrice).toBe(67750);
    // ABC: 28500 40000 41000 49500 57000 -> the middle one
    expect(byName("ABC")?.meta?.gemsPrice).toBe(41000);
  });

  it("measures synergy over the surviving lists only", () => {
    expect(Object.keys(derived.synergy)).toHaveLength(derived.stats.namesSeen);
    const pudica = pool.find((c) => c.name === "Traptrix Pudica");
    const entry = derived.synergy[pudica?.id ?? -1];
    expect(entry?.play).toBe(6);
    expect(entry?.spread).toBe(1);
    // Cards from the same list are partners; cards from another archetype are not.
    const partnerIds = new Set(entry?.partners.map(([id]) => id));
    const myrmeleo = pool.find((c) => c.name === "Traptrix Myrmeleo");
    const drake = pool.find((c) => c.name === "B-Buster Drake");
    expect(partnerIds.has(myrmeleo?.id ?? -1)).toBe(true);
    expect(partnerIds.has(drake?.id ?? -1)).toBe(false);
  });

  it("ignores lists older than the window", () => {
    const stale = deriveTemplates(topDecks, deckTypes, pool, {
      now: NOW + 365 * 86_400_000,
    });
    expect(stale.templates).toEqual([]);
    expect(stale.stats.decksInWindow).toBe(0);
  });
});

describe("tallyDeck", () => {
  it("counts a card once per list even when it spans two rows", () => {
    const tally = tallyDeck([
      { amount: 1, card: { name: "Traptrix Pudica" } },
      { amount: 2, card: { name: "Traptrix Pudica" } },
    ]);
    expect(tally.get("Traptrix Pudica")).toBe(3);
    expect(tally.size).toBe(1);
  });

  it("never lets duplicate rows exceed the copy limit", () => {
    const tally = tallyDeck([
      { amount: 3, card: { name: "Nibiru, the Primal Being" } },
      { amount: 3, card: { name: "Nibiru, the Primal Being" } },
    ]);
    expect(tally.get("Nibiru, the Primal Being")).toBe(3);
  });

  it("skips rows with no card or no amount", () => {
    expect(tallyDeck([{ amount: 1 }, { card: { name: "X" } }, { amount: 0, card: { name: "Y" } }]).size).toBe(0);
    expect(tallyDeck(undefined).size).toBe(0);
  });

  it("keeps inclusion at or below 100% when every list doubles a row", () => {
    const doubled: DlmTopDeck[] = topDecks
      .filter((d) => d.deckType?.name === "Traptrix")
      .map((deck) => ({ ...deck, main: [...(deck.main ?? []), ...(deck.main ?? [])] }));
    const result = deriveTemplates(doubled, deckTypes, pool, { now: NOW });
    const inclusion = Object.values(result.templates[0]?.meta?.inclusion ?? {});
    expect(inclusion.length).toBeGreaterThan(0);
    for (const rate of inclusion) expect(rate).toBeLessThanOrEqual(1);
  });
});

describe("median", () => {
  it("takes the middle of an odd sample", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middles of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });

  it("is unmoved by a single wild outlier, unlike a mean", () => {
    expect(median([50, 52, 54, 1_000_000])).toBe(53);
  });

  it("is 0 for an empty sample", () => {
    expect(median([])).toBe(0);
  });
});

describe("tierScoreFor", () => {
  it("prefers duellinksmeta's stated tier where it has one", () => {
    expect(tierScoreFor({ name: "a", tier: 1 }, 0)).toBe(10);
    expect(tierScoreFor({ name: "a", tier: 4 }, 0)).toBe(7);
  });

  it("falls back to representation percentile, spanning the scale", () => {
    expect(tierScoreFor({ name: "a", tier: null }, 1)).toBe(9);
    expect(tierScoreFor({ name: "a", tier: null }, 0)).toBe(1);
    expect(tierScoreFor(undefined, 0.5)).toBe(5);
  });
});

describe("classifyRole", () => {
  const card = (over: Partial<Card>): Card => ({
    id: 1,
    name: "x",
    type: "Effect Monster",
    race: "Warrior",
    desc: "",
    isExtraDeck: false,
    ...over,
  });

  it("reads the role out of the effect text", () => {
    expect(classifyRole(card({ desc: "Draw 2 cards." }))).toBe("draw");
    expect(classifyRole(card({ desc: "Negate that effect." }))).toBe("disruption");
    expect(classifyRole(card({ desc: "Destroy 1 card on the field." }))).toBe("removal");
  });

  it("falls back to the card kind when the text says nothing", () => {
    expect(classifyRole(card({ type: "Trap Card", desc: "Nothing happens." }))).toBe("disruption");
    expect(classifyRole(card({ type: "Spell Card", desc: "Nothing happens." }))).toBe("removal");
    expect(classifyRole(card({ desc: "A famous monster." }))).toBe("beater");
    expect(classifyRole(undefined)).toBe("beater");
  });
});

describe("buildFlexSlots", () => {
  const cards = new Map(pool.map((c) => [c.name.toLowerCase(), c]));

  it("sizes the slots toward the target list size", () => {
    // Eight names across two roles can supply the whole eight-copy budget.
    const flex = Array.from({ length: 8 }, (_, i) => ({
      name: i % 2 === 0 ? "Forbidden Droplet" : "Nibiru, the Primal Being",
      inclusion: 0.6,
      avgCopies: 2,
    }));
    expect(buildFlexSlots(flex, 16, 24, cards).reduce((sum, s) => sum + s.count, 0)).toBe(8);
  });

  it("never asks a slot for more copies than its candidates can supply", () => {
    // Two names, so at most six copies however big the budget looks.
    const flex = [
      { name: "Forbidden Droplet", inclusion: 0.6, avgCopies: 2 },
      { name: "Nibiru, the Primal Being", inclusion: 0.4, avgCopies: 1 },
    ];
    const slots = buildFlexSlots(flex, 16, 24, cards);
    expect(slots.reduce((sum, s) => sum + s.count, 0)).toBeLessThanOrEqual(6);
    for (const slot of slots) expect(slot.count).toBeLessThanOrEqual(slot.candidates.length * 3);
  });

  it("clamps a target below the legal minimum up to it, still within the cap", () => {
    const flex = [{ name: "Forbidden Droplet", inclusion: 0.6, avgCopies: 2 }];
    // Budget would be 10, but one candidate can only ever supply three copies.
    expect(buildFlexSlots(flex, 10, 12, cards).reduce((sum, s) => sum + s.count, 0)).toBe(3);
  });

  it("returns nothing when the core already fills the deck", () => {
    expect(buildFlexSlots([{ name: "Forbidden Droplet", inclusion: 0.5, avgCopies: 1 }], 30, 30, cards)).toEqual([]);
  });
});

describe("assertTemplatesSane", () => {
  const ok: DeriveResult = {
    ...derived,
    stats: { ...derived.stats, joinRate: 1 },
  };

  it("passes a healthy derivation", () => {
    expect(() => assertTemplatesSane(ok, 2)).not.toThrow();
  });

  it("refuses an empty derivation", () => {
    expect(() => assertTemplatesSane({ ...ok, templates: [] }, 2)).toThrow(TemplateError);
  });

  it("refuses a broken name join, which would silently drop core cards", () => {
    const broken = { ...ok, stats: { ...ok.stats, joinRate: 0.5 } };
    expect(() => assertTemplatesSane(broken, 2)).toThrow(/resolved/);
  });

  it("refuses a count that swings past the drift guard, in either direction", () => {
    const previous = Math.ceil(ok.templates.length / (1 - MAX_DRIFT)) + 10;
    expect(() => assertTemplatesSane(ok, previous)).toThrow(/drift|moved/i);
  });

  it("accepts any count on the first run", () => {
    expect(() => assertTemplatesSane(ok, 0)).not.toThrow();
  });
});
