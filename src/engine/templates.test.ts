/**
 * Integration test over the real committed data: `data/cards.json`,
 * `data/banlist.json` and every `data/templates/*.json`.
 *
 * This is what catches an authored template that references a card that does not
 * exist, or that cannot legally be assembled under the current banlist — the two
 * ways hand-maintained data quietly rots as Konami moves cards between tiers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBest, idealDeck, rankTemplates, scoreTemplate } from "./build.ts";
import { validateDeck, countCopies } from "./validator.ts";
import { BanlistIndex, normalizeName } from "./banlist-index.ts";
import { DEFAULT_CONFIG, type CardIndex, type OwnedCounts } from "./types.ts";
import type { Banlist, Card, CardFile, DeckTemplate } from "../data/types.ts";

const dataDir = fileURLToPath(new URL("../../data", import.meta.url));
const readJson = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

const cardFile = readJson<CardFile>(path.join(dataDir, "cards.json"));
const banlist = readJson<Banlist>(path.join(dataDir, "banlist.json"));
const templates = fs
  .readdirSync(path.join(dataDir, "templates"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => readJson<DeckTemplate>(path.join(dataDir, "templates", f)));

const cards: CardIndex = new Map(cardFile.cards.map((c) => [normalizeName(c.name), c]));
const index = new BanlistIndex(banlist);
const config = DEFAULT_CONFIG;

/** Everything a template names, at three copies — "the player owns it all". */
function ownsTemplate(template: DeckTemplate): OwnedCounts {
  const owned = new Map<string, number>();
  const add = (name: string) => owned.set(normalizeName(name), 3);
  template.coreCards.forEach((c) => add(c.name));
  template.extraDeck.forEach((c) => add(c.name));
  template.flexSlots.forEach((s) => s.candidates.forEach(add));
  return owned;
}

function namesIn(template: DeckTemplate): string[] {
  return [
    ...template.coreCards.map((c) => c.name),
    ...template.extraDeck.map((c) => c.name),
    ...template.flexSlots.flatMap((s) => s.candidates),
  ];
}

describe("committed data", () => {
  it("ships a non-empty card pool", () => {
    expect(cardFile.cards.length).toBeGreaterThan(1000);
    expect(cardFile.cards.some((c) => c.isExtraDeck)).toBe(true);
  });

  it("ships a banlist with every tier populated", () => {
    for (const tier of ["forbidden", "limited1", "limited2", "limited3"] as const) {
      expect(banlist[tier].length, tier).toBeGreaterThan(0);
    }
  });

  it("keeps the card pool sorted by name", () => {
    const names = cardFile.cards.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("ships four templates covering different strategies", () => {
    expect(templates.length).toBeGreaterThanOrEqual(4);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });
});

describe.each(templates.map((t) => [t.name, t] as const))("template: %s", (_name, template) => {
  it("references only cards that exist in the pool", () => {
    const missing = namesIn(template).filter((n) => !cards.has(normalizeName(n)));
    expect(missing, `not in data/cards.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("names no Forbidden card as a core card", () => {
    const banned = template.coreCards.filter((c) => index.isForbidden(c.name)).map((c) => c.name);
    expect(banned, `core cards are Forbidden: ${banned.join(", ")}`).toEqual([]);
  });

  it("puts Extra Deck cards in extraDeck and main-deck cards in coreCards", () => {
    for (const entry of template.extraDeck) {
      expect(cards.get(normalizeName(entry.name))?.isExtraDeck, entry.name).toBe(true);
    }
    for (const entry of template.coreCards) {
      expect(cards.get(normalizeName(entry.name))?.isExtraDeck, entry.name).toBe(false);
    }
  });

  it("asks for no more than 3 copies of a card", () => {
    for (const entry of [...template.coreCards, ...template.extraDeck]) {
      expect(entry.copies, entry.name).toBeLessThanOrEqual(3);
      expect(entry.copies, entry.name).toBeGreaterThan(0);
    }
  });

  it("describes at least a legal minimum deck", () => {
    const core = countCopies(template.coreCards);
    const flex = template.flexSlots.reduce((sum, s) => sum + s.count, 0);
    expect(core + flex).toBeGreaterThanOrEqual(config.minMain);
    expect(core + flex).toBeLessThanOrEqual(config.maxMain);
    expect(countCopies(template.extraDeck)).toBeLessThanOrEqual(config.extraDeckSize);
  });

  it("assembles into a legal deck for a player who owns it all", () => {
    const result = buildBest({ owned: ownsTemplate(template), templates: [template], banlist, cards, config });
    expect(result.validation.violations.map((v) => v.message)).toEqual([]);
    expect(result.mainCount).toBeGreaterThanOrEqual(config.minMain);
    expect(result.partial).toBe(false);
    expect(scoreTemplate(template, ownsTemplate(template)).completion).toBe(1);
  });

  it("has an ideal list that is itself legal", () => {
    const ideal = idealDeck(template, index, cards, config);
    expect(validateDeck(ideal, banlist, config).violations.map((v) => v.message)).toEqual([]);
  });

  it("carries strategy prose for every section the Strategy screen renders", () => {
    // Only hand-authored templates carry prose; the derived ones in
    // `data/decks.json` get the data guide instead. Everything under
    // `data/templates/` is authored by definition, so the prose is required here.
    expect(template.source).toBe("authored");
    const strategy = template.strategy;
    expect(strategy).toBeDefined();
    if (!strategy) return;
    expect(strategy.gamePlan.length).toBeGreaterThan(80);
    expect(strategy.openingPriorities.length).toBeGreaterThanOrEqual(2);
    expect(strategy.keyInteractions.length).toBeGreaterThanOrEqual(2);
    expect(strategy.matchups.length).toBeGreaterThanOrEqual(2);
    for (const m of strategy.matchups) {
      expect(m.notes.length).toBeGreaterThan(20);
      if (m.winRate !== undefined) {
        expect(m.winRate).toBeGreaterThan(0);
        expect(m.winRate).toBeLessThan(100);
      }
    }
  });

  it("has a tierScore in the authored 1–10 band", () => {
    expect(template.tierScore).toBeGreaterThanOrEqual(1);
    expect(template.tierScore).toBeLessThanOrEqual(10);
  });
});

describe("engine against the real pool", () => {
  it("builds a legal deck for a player who owns the whole game", () => {
    const owned: OwnedCounts = new Map(cardFile.cards.map((c: Card) => [normalizeName(c.name), 3]));
    const result = buildBest({ owned, templates, banlist, cards, config });
    expect(result.validation.violations.map((v) => v.message)).toEqual([]);
    expect(result.template).not.toBeNull();
    // Every template is scored and offered as an upgrade target, not just the
    // three the screen used to show.
    expect(result.candidates.length).toBe(templates.length);
  });

  it("picks the highest tierScore deck when everything is equally available", () => {
    const owned: OwnedCounts = new Map(cardFile.cards.map((c: Card) => [normalizeName(c.name), 3]));
    const ranked = rankTemplates(templates, owned);
    expect(ranked[0]!.template.tierScore).toBe(Math.max(...templates.map((t) => t.tierScore)));
  });

  it("explains rather than throws for a player who owns nothing", () => {
    const result = buildBest({ owned: new Map(), templates, banlist, cards, config });
    expect(result.reason).toBeTruthy();
    expect(result.deck.main).toEqual([]);
  });
});
