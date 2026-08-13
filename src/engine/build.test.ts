import { describe, expect, it } from "vitest";
import { buildBest, diffDecks, idealDeck, rankTemplates, scoreTemplate } from "./build.ts";
import { validateDeck, countCopies } from "./validator.ts";
import { BanlistIndex } from "./banlist-index.ts";
import { DEFAULT_CONFIG, type Deck } from "./types.ts";
import { banlist, cards, collection, fullCollection, template, weakerTemplate } from "./fixtures.ts";

const config = DEFAULT_CONFIG;
const index = new BanlistIndex(banlist);

function build(owned: Parameters<typeof buildBest>[0] extends never ? never : ReturnType<typeof collection>, templates = [template]) {
  return buildBest({ owned, templates, banlist, cards, config });
}

function copiesOf(deck: Deck, name: string): number {
  return [...deck.main, ...deck.extra]
    .filter((e) => e.name.toLowerCase() === name.toLowerCase())
    .reduce((sum, e) => sum + e.copies, 0);
}

describe("scoreTemplate", () => {
  it("is 0 for an empty collection and 1 for a complete one", () => {
    expect(scoreTemplate(template, collection({})).completion).toBe(0);
    expect(scoreTemplate(template, fullCollection()).completion).toBe(1);
  });

  it("weights a missing core card above three missing flex cards", () => {
    const missingOneCore = fullCollection() as Map<string, number>;
    missingOneCore.set("core one", 2);

    const missingThreeFlex = fullCollection() as Map<string, number>;
    missingThreeFlex.set("filler b", 0);
    missingThreeFlex.set("filler c", 0);

    expect(scoreTemplate(template, missingOneCore).completion).toBeLessThan(
      scoreTemplate(template, missingThreeFlex).completion,
    );
  });

  it("counts a flex slot as covered by any candidate in the list", () => {
    const onlySecondChoice = collection({ "Trio Slot B": 3 });
    const score = scoreTemplate(template, onlySecondChoice);
    expect(score.completion).toBeGreaterThan(0);
  });

  it("reports the core cards the player is short on", () => {
    const score = scoreTemplate(template, collection({ "Core One": 1 }));
    expect(score.missingCore).toEqual([
      { name: "Core One", copies: 2 },
      { name: "Core Two", copies: 3 },
      { name: "Core Three", copies: 3 },
    ]);
  });

  it("ranks by tierScore × completion", () => {
    const ranked = rankTemplates([weakerTemplate, template], fullCollection());
    expect(ranked.map((r) => r.template.id)).toEqual(["test-deck", "weaker-deck"]);
    expect(ranked[0]!.rank).toBeCloseTo(8);
  });

  it("prefers a lower tier deck the player can actually build", () => {
    // Owns the weaker deck outright, almost none of the stronger one.
    const owned = collection({
      "Filler A": 3,
      "Filler B": 3,
      "Filler C": 3,
      "Trio Slot A": 3,
      "Free Spell": 3,
      "Core One": 1,
    });
    const ranked = rankTemplates([template, weakerTemplate], owned);
    expect(ranked[0]!.template.id).toBe("weaker-deck");
  });
});

describe("buildBest", () => {
  it("returns a legal deck from a full collection", () => {
    const result = build(fullCollection());
    expect(result.template?.id).toBe("test-deck");
    expect(result.validation.legal).toBe(true);
    expect(result.validation.violations).toEqual([]);
    expect(result.mainCount).toBeGreaterThanOrEqual(config.minMain);
    expect(result.partial).toBe(false);
  });

  it("never returns a deck the validator rejects", () => {
    const result = build(fullCollection());
    expect(validateDeck(result.deck, banlist, config).legal).toBe(true);
  });

  it("plays the core cards it owns", () => {
    const result = build(fullCollection());
    expect(copiesOf(result.deck, "Core One")).toBe(3);
    expect(copiesOf(result.deck, "Core Two")).toBe(3);
    expect(copiesOf(result.deck, "Core Three")).toBe(3);
  });

  it("never includes a Forbidden card, however many are owned", () => {
    const owned = fullCollection() as Map<string, number>;
    owned.set("banned beater", 3);
    const result = build(owned);
    expect(copiesOf(result.deck, "Banned Beater")).toBe(0);
  });

  it("respects the pooled Limited 1 budget while filling flex slots", () => {
    const result = build(fullCollection());
    const l1 = result.validation.allowance.tiers[0];
    expect(l1.used).toBeLessThanOrEqual(1);
    expect(copiesOf(result.deck, "Solo Slot A") + copiesOf(result.deck, "Solo Slot B")).toBeLessThanOrEqual(1);
  });

  it("keeps every pooled budget inside its allowance", () => {
    const result = build(fullCollection());
    for (const tier of result.validation.allowance.tiers) {
      expect(tier.used).toBeLessThanOrEqual(tier.budget);
    }
    expect(result.validation.allowance.spent).toBeLessThanOrEqual(6);
  });

  it("keeps the Extra Deck inside the configured cap", () => {
    const owned = fullCollection();
    const wide = buildBest({ owned, templates: [template], banlist, cards, config: { ...config, extraDeckSize: 5 } });
    expect(countCopies(wide.deck.extra)).toBeLessThanOrEqual(5);
  });

  it("puts Extra Deck cards in the Extra Deck, not the main deck", () => {
    const result = build(fullCollection());
    for (const entry of result.deck.main) {
      expect(cards.get(entry.name.toLowerCase())?.isExtraDeck ?? false).toBe(false);
    }
  });

  it("pads a short deck up to the minimum from owned cards", () => {
    // Enough core for a start, plus plenty of unrelated bodies to pad with.
    const owned = collection({
      "Core One": 3,
      "Core Two": 3,
      "Filler A": 3,
      "Filler B": 3,
      "Filler C": 3,
      "Filler D": 3,
      "Filler E": 3,
      "Free Spell": 3,
    });
    const result = build(owned);
    expect(result.mainCount).toBe(20);
    expect(result.validation.legal).toBe(true);
    expect(result.partial).toBe(false);
  });

  it("returns a partial deck with a reason rather than throwing", () => {
    const result = build(collection({ "Core One": 3, "Core Two": 2 }));
    expect(result.partial).toBe(true);
    expect(result.mainCount).toBeLessThan(20);
    expect(result.reason).toMatch(/Could not legally reach 20/);
    expect(() => build(collection({ "Core One": 1 }))).not.toThrow();
  });

  it("explains an empty collection instead of failing", () => {
    const result = build(collection({}));
    expect(result.template).toBeNull();
    expect(result.mainCount).toBe(0);
    expect(result.powerScore).toBe(0);
    expect(result.reason).toMatch(/Nothing to build with yet/);
  });

  it("returns the top 3 templates as upgrade candidates", () => {
    const result = buildBest({
      owned: fullCollection(),
      templates: [template, weakerTemplate],
      banlist,
      cards,
      config,
    });
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0]!.template.id).toBe("test-deck");
    expect(result.candidates[0]!.rank).toBeGreaterThanOrEqual(result.candidates[1]!.rank);
  });

  it("scores power out of 100", () => {
    expect(build(fullCollection()).powerScore).toBeCloseTo(80, 1);
  });

  it("is pure — building twice from the same collection gives the same deck", () => {
    const owned = fullCollection();
    expect(JSON.stringify(build(owned).deck)).toBe(JSON.stringify(build(owned).deck));
  });

  it("does not mutate the collection it is given", () => {
    const owned = fullCollection();
    const before = JSON.stringify([...owned.entries()].sort());
    build(owned);
    expect(JSON.stringify([...owned.entries()].sort())).toBe(before);
  });

  it("prefers a budget-free candidate over one that burns a scarce slot", () => {
    // Both flex candidates are owned. "Solo Slot A" is the first preference but
    // consumes the only Limited 1 slot; the deck should not waste it on a slot
    // an unlimited card fills just as well.
    const narrow = {
      ...template,
      flexSlots: [{ role: "removal" as const, count: 2, candidates: ["Solo Slot A", "Free Spell"] }],
    };
    const result = buildBest({ owned: fullCollection(), templates: [narrow], banlist, cards, config });
    expect(copiesOf(result.deck, "Free Spell")).toBeGreaterThan(0);
    expect(result.validation.allowance.tiers[0].used).toBeLessThanOrEqual(1);
  });
});

describe("idealDeck", () => {
  it("describes the finished list regardless of ownership", () => {
    const ideal = idealDeck(template, index, cards, config);
    expect(copiesOf(ideal, "Core One")).toBe(3);
    expect(countCopies(ideal.main)).toBeGreaterThanOrEqual(config.minMain);
  });

  it("is itself legal", () => {
    expect(validateDeck(idealDeck(template, index, cards, config), banlist, config).legal).toBe(true);
  });
});

describe("diffDecks", () => {
  const current: Deck = {
    main: [
      { name: "Core One", copies: 3 },
      { name: "Filler A", copies: 2 },
    ],
    extra: [],
  };
  const target: Deck = {
    main: [
      { name: "Core One", copies: 3 },
      { name: "Core Two", copies: 2 },
    ],
    extra: [{ name: "Extra Body", copies: 1 }],
  };

  it("lists only the copies actually missing", () => {
    const diff = diffDecks(current, target);
    expect(diff.toAcquire).toEqual([
      { name: "Core Two", copies: 2, inCurrent: 0, inTarget: 2 },
      { name: "Extra Body", copies: 1, inCurrent: 0, inTarget: 1 },
    ]);
  });

  it("lists what has to come out", () => {
    expect(diffDecks(current, target).toCut).toEqual([
      { name: "Filler A", copies: 2, inCurrent: 2, inTarget: 0 },
    ]);
  });

  it("counts partial overlap rather than treating a card as all-or-nothing", () => {
    const diff = diffDecks(
      { main: [{ name: "Core One", copies: 1 }], extra: [] },
      { main: [{ name: "Core One", copies: 3 }], extra: [] },
    );
    expect(diff.toAcquire).toEqual([{ name: "Core One", copies: 2, inCurrent: 1, inTarget: 3 }]);
    expect(diff.completionPct).toBe(33);
  });

  it("reports 100% for identical decks and empties both lists", () => {
    const diff = diffDecks(target, target);
    expect(diff.completionPct).toBe(100);
    expect(diff.toAcquire).toEqual([]);
    expect(diff.toCut).toEqual([]);
  });

  it("reports 0% when nothing is shared", () => {
    expect(diffDecks(current, { main: [{ name: "Core Three", copies: 3 }], extra: [] }).completionPct).toBe(0);
  });

  it("matches names case-insensitively", () => {
    const diff = diffDecks({ main: [{ name: "core one", copies: 3 }], extra: [] }, { main: [{ name: "Core One", copies: 3 }], extra: [] });
    expect(diff.completionPct).toBe(100);
  });

  it("is symmetric — cuts one way are acquisitions the other", () => {
    const forward = diffDecks(current, target);
    const back = diffDecks(target, current);
    expect(forward.toAcquire.map((e) => e.name).sort()).toEqual(back.toCut.map((e) => e.name).sort());
  });
});
