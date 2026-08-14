/**
 * The template-free solver, tested against invariants rather than exact lists.
 *
 * The exact contents depend on statistics that are refreshed weekly, so pinning
 * a card list here would fail on data churn rather than on a real regression.
 * What must never change is that the deck comes back legal, deterministic, and
 * actually shaped like a deck.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archetypesOf, strongestCluster, synergyDensity, synthesizeDeck } from "./synthesize.ts";
import { BanlistIndex, normalizeName } from "./banlist-index.ts";
import { countCopies } from "./validator.ts";
import { DEFAULT_CONFIG, type CardIndex, type OwnedCounts, type SynergyIndex } from "./types.ts";
import { banlist, cards, cardList, collection, fullCollection } from "./fixtures.ts";
import type { Card, CardFile, SynergyFile } from "../data/types.ts";
import { dataDir } from "../../scripts/lib/paths.ts";

const config = DEFAULT_CONFIG;
const index = new BanlistIndex(banlist);

/** Everything co-occurs with everything, so growth has something to follow. */
function synergyOver(ids: number[], partnersPerCard = 24): SynergyIndex {
  const map = new Map();
  for (const id of ids) {
    map.set(id, {
      play: 10,
      spread: 3,
      partners: ids.filter((other) => other !== id).slice(0, partnersPerCard).map((other) => [other, 5]),
    });
  }
  return map;
}

const allIds = cardList.map((c) => c.name).map((n) => cards.get(normalizeName(n))?.id ?? 0);

function synth(owned: OwnedCounts, synergy: SynergyIndex = synergyOver(allIds)) {
  return synthesizeDeck({ owned, cards, synergy, index, config });
}

describe("synthesizeDeck", () => {
  it("returns a legal deck", () => {
    const result = synth(fullCollection());
    expect(result.validation.violations.map((v) => v.message)).toEqual([]);
    expect(result.validation.legal).toBe(true);
  });

  it("reaches the minimum main deck when the collection allows", () => {
    const result = synth(fullCollection());
    expect(result.mainCount).toBeGreaterThanOrEqual(config.minMain);
    expect(result.partial).toBe(false);
  });

  it("never puts an Extra Deck card in the main deck", () => {
    for (const entry of synth(fullCollection()).deck.main) {
      expect(cards.get(normalizeName(entry.name))?.isExtraDeck, entry.name).toBe(false);
    }
  });

  it("keeps the Extra Deck inside the configured cap", () => {
    const narrow = synthesizeDeck({
      owned: fullCollection(),
      cards,
      synergy: synergyOver(allIds),
      index,
      config: { ...config, extraDeckSize: 5 },
    });
    expect(countCopies(narrow.deck.extra)).toBeLessThanOrEqual(5);
  });

  it("respects every pooled Limited budget", () => {
    const allowance = synth(fullCollection()).validation.allowance;
    for (const tier of allowance.tiers) expect(tier.used).toBeLessThanOrEqual(tier.budget);
    expect(allowance.spent).toBeLessThanOrEqual(allowance.total);
  });

  it("never includes a Forbidden card", () => {
    const result = synth(fullCollection());
    for (const entry of [...result.deck.main, ...result.deck.extra]) {
      expect(index.isForbidden(entry.name), entry.name).toBe(false);
    }
  });

  it("is deterministic for a given collection", () => {
    const owned = fullCollection();
    expect(JSON.stringify(synth(owned).deck)).toBe(JSON.stringify(synth(owned).deck));
  });

  it("does not mutate the collection it is given", () => {
    const owned = fullCollection();
    const before = JSON.stringify([...owned.entries()].sort());
    synth(owned);
    expect(JSON.stringify([...owned.entries()].sort())).toBe(before);
  });

  it("explains an empty collection rather than throwing", () => {
    const result = synth(collection({}));
    expect(result.mainCount).toBe(0);
    expect(result.reason).toMatch(/Nothing to build with yet/);
    expect(() => synth(collection({ "Core One": 1 }))).not.toThrow();
  });

  it("still builds with no synergy data at all, on card kind alone", () => {
    const result = synth(fullCollection(), new Map());
    expect(result.mainCount).toBeGreaterThanOrEqual(config.minMain);
    expect(result.validation.legal).toBe(true);
    // Nothing co-occurs, so the deck can claim no measured synergy.
    expect(result.powerScore).toBe(0);
  });

  it("carries no template, since there is none", () => {
    expect(synth(fullCollection()).template).toBeNull();
  });
});

describe("archetypesOf", () => {
  const card = (over: Partial<Card>): Card => ({
    id: 1,
    name: "x",
    type: "Effect Monster",
    race: "Warrior",
    desc: "",
    isExtraDeck: false,
    ...over,
  });

  it("uses the archetype field when the card carries one", () => {
    expect(archetypesOf(card({ archetype: "Traptrix" }), new Set())).toEqual(["Traptrix"]);
  });

  it("catches support cards that name an archetype without carrying the tag", () => {
    const known = new Set(["Six Samurai"]);
    expect(archetypesOf(card({ name: "The Six Samurai - Zanji" }), known)).toContain("Six Samurai");
  });

  it("returns nothing for a card with no archetype in sight", () => {
    expect(archetypesOf(card({ name: "Lava Golem" }), new Set(["Traptrix"]))).toEqual([]);
  });
});

describe("strongestCluster", () => {
  it("prefers depth of ownership over a wide scatter of singles", () => {
    const deep: Card = { id: 1, name: "Deep One", type: "Effect Monster", race: "Warrior", desc: "", isExtraDeck: false, archetype: "Deep" };
    const wide: Card = { id: 2, name: "Wide One", type: "Effect Monster", race: "Warrior", desc: "", isExtraDeck: false, archetype: "Wide" };
    const wideTwo: Card = { ...wide, id: 3, name: "Wide Two" };
    const cluster = strongestCluster([
      { card: deep, copies: 3, play: 40, spread: 2, partners: new Map() },
      { card: wide, copies: 1, play: 2, spread: 1, partners: new Map() },
      { card: wideTwo, copies: 1, play: 2, spread: 1, partners: new Map() },
    ]);
    expect(cluster?.archetype).toBe("Deep");
  });

  it("does not let a family of staples pose as an archetype", () => {
    // "Forbidden Droplet" and friends share the archetype "Forbidden" and are the
    // most played cards in the game, but they appear in every deck type, so they
    // define none of them.
    const staple: Card = { id: 1, name: "Forbidden Droplet", type: "Spell Card", race: "Normal", desc: "", isExtraDeck: false, archetype: "Forbidden" };
    const stapleTwo: Card = { ...staple, id: 2, name: "Forbidden Lance" };
    const engine: Card = { id: 3, name: "Traptrix Pudica", type: "Effect Monster", race: "Insect", desc: "", isExtraDeck: false, archetype: "Traptrix" };
    const engineTwo: Card = { ...engine, id: 4, name: "Traptrix Myrmeleo" };
    const cluster = strongestCluster([
      { card: staple, copies: 3, play: 1583, spread: 72, partners: new Map() },
      { card: stapleTwo, copies: 3, play: 400, spread: 40, partners: new Map() },
      { card: engine, copies: 3, play: 234, spread: 1, partners: new Map() },
      { card: engineTwo, copies: 3, play: 234, spread: 1, partners: new Map() },
    ]);
    expect(cluster?.archetype).toBe("Traptrix");
  });

  it("is null when nothing has an archetype", () => {
    const loose: Card = { id: 1, name: "Loose", type: "Spell Card", race: "Normal", desc: "", isExtraDeck: false };
    expect(strongestCluster([{ card: loose, copies: 3, play: 1, spread: 1, partners: new Map() }])).toBeNull();
  });
});

describe("synergyDensity", () => {
  const member = (id: number, partners: number[]) => ({
    card: { id, name: `c${id}`, type: "Spell Card", race: "Normal", desc: "", isExtraDeck: false } as Card,
    copies: 1,
    play: 1,
    spread: 1,
    partners: new Map(partners.map((p) => [p, 1])),
  });

  it("is 1 when every pair is played together", () => {
    expect(synergyDensity([member(1, [2, 3]), member(2, [1, 3]), member(3, [1, 2])])).toBe(1);
  });

  it("is 0 when no pair has ever shared a list", () => {
    expect(synergyDensity([member(1, []), member(2, []), member(3, [])])).toBe(0);
  });

  it("counts a pair once even when only one side records it", () => {
    expect(synergyDensity([member(1, [2]), member(2, [])])).toBe(1);
  });

  it("is 0 for a deck too small to have a pair", () => {
    expect(synergyDensity([member(1, [2])])).toBe(0);
  });
});

/**
 * The case the solver exists for: a collection that matches no template, built
 * against the real pool and the real corpus statistics.
 */
describe("against the real pool", () => {
  const readJson = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
  const cardFile = readJson<CardFile>(path.join(dataDir, "cards.json"));
  const synergyFile = readJson<SynergyFile>(path.join(dataDir, "synergy.json"));
  const realCards: CardIndex = new Map(cardFile.cards.map((c) => [normalizeName(c.name), c]));
  const realSynergy: SynergyIndex = new Map(
    Object.entries(synergyFile.cards).map(([id, entry]) => [Number(id), entry]),
  );

  /** Deterministic pseudo-random pick, so a failure is reproducible. */
  function scatter(count: number): OwnedCounts {
    const owned = new Map<string, number>();
    let seed = 12345;
    for (let i = 0; i < count; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const card = cardFile.cards[seed % cardFile.cards.length];
      if (card) owned.set(normalizeName(card.name), 3);
    }
    return owned;
  }

  it("builds a legal deck out of an incoherent collection", () => {
    const result = synthesizeDeck({ owned: scatter(120), cards: realCards, synergy: realSynergy, index: new BanlistIndex(banlistFile()), config });
    expect(result.validation.violations.map((v) => v.message)).toEqual([]);
    expect(result.mainCount).toBeGreaterThanOrEqual(config.minMain);
    expect(result.mainCount).toBeLessThanOrEqual(config.maxMain);
  });

  it("finds the archetype in a collection that is mostly one archetype", () => {
    const traptrix = cardFile.cards.filter((c) => c.archetype === "Traptrix" && !c.isExtraDeck);
    expect(traptrix.length).toBeGreaterThan(5);
    const owned = new Map(traptrix.map((c) => [normalizeName(c.name), 3]));
    const result = synthesizeDeck({ owned, cards: realCards, synergy: realSynergy, index: new BanlistIndex(banlistFile()), config });
    expect(result.archetype).toBe("Traptrix");
    expect(result.validation.legal).toBe(true);
  });

  function banlistFile() {
    return readJson<import("../data/types.ts").Banlist>(path.join(dataDir, "banlist.json"));
  }
});
