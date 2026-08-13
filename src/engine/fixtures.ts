/** Fixtures for engine tests — deliberately small, so a failure is readable. */
import type { Banlist, Card, DeckTemplate } from "../data/types.ts";
import { normalizeName } from "./banlist-index.ts";
import type { CardIndex, OwnedCounts } from "./types.ts";

export const banlist: Banlist = {
  scrapedAt: "2026-08-12T00:00:00.000Z",
  source: "scrape",
  forbidden: ["Banned Beater"],
  limited1: ["Solo Slot A", "Solo Slot B"],
  limited2: ["Pair Slot A", "Pair Slot B"],
  limited3: ["Trio Slot A", "Trio Slot B"],
};

function monster(name: string, atk: number, extra = false): Card {
  return {
    id: name.length * 1000 + atk,
    name,
    type: extra ? "Fusion Monster" : "Effect Monster",
    race: "Warrior",
    attribute: "DARK",
    level: 4,
    atk,
    def: atk - 100,
    desc: `${name} test card.`,
    isExtraDeck: extra,
  };
}

function spell(name: string): Card {
  return {
    id: name.length * 7,
    name,
    type: "Spell Card",
    race: "Normal",
    desc: `${name} test card.`,
    isExtraDeck: false,
  };
}

export const cardList: Card[] = [
  monster("Core One", 1800),
  monster("Core Two", 1700),
  monster("Core Three", 1600),
  monster("Filler A", 1500),
  monster("Filler B", 1400),
  monster("Filler C", 1300),
  monster("Filler D", 1200),
  monster("Filler E", 1100),
  monster("Banned Beater", 3000),
  monster("Extra Body", 2500, true),
  monster("Extra Body Two", 2400, true),
  spell("Solo Slot A"),
  spell("Solo Slot B"),
  spell("Pair Slot A"),
  spell("Pair Slot B"),
  spell("Trio Slot A"),
  spell("Trio Slot B"),
  spell("Free Spell"),
];

export const cards: CardIndex = new Map(cardList.map((c) => [normalizeName(c.name), c]));

export function collection(entries: Record<string, number>): OwnedCounts {
  return new Map(Object.entries(entries).map(([name, copies]) => [normalizeName(name), copies]));
}

/** A generous collection: three of everything legal. */
export function fullCollection(): OwnedCounts {
  return new Map(cardList.map((c) => [normalizeName(c.name), 3]));
}

export const template: DeckTemplate = {
  id: "test-deck",
  name: "Test Deck",
  tierScore: 8,
  coreCards: [
    { name: "Core One", copies: 3 },
    { name: "Core Two", copies: 3 },
    { name: "Core Three", copies: 3 },
  ],
  flexSlots: [
    { role: "removal", count: 2, candidates: ["Solo Slot A", "Pair Slot A", "Free Spell"] },
    { role: "disruption", count: 3, candidates: ["Trio Slot A", "Trio Slot B", "Filler A"] },
    { role: "beater", count: 3, candidates: ["Filler B", "Filler C"] },
    { role: "draw", count: 3, candidates: ["Free Spell", "Filler D"] },
  ],
  extraDeck: [{ name: "Extra Body", copies: 1 }],
  strategy: {
    gamePlan: "Test.",
    openingPriorities: ["Test."],
    keyInteractions: ["Test."],
    matchups: [{ against: "Other", notes: "Test." }],
  },
};

export const weakerTemplate: DeckTemplate = {
  ...template,
  id: "weaker-deck",
  name: "Weaker Deck",
  tierScore: 4,
  coreCards: [
    { name: "Filler A", copies: 3 },
    { name: "Filler B", copies: 3 },
    { name: "Filler C", copies: 3 },
  ],
  extraDeck: [{ name: "Extra Body Two", copies: 1 }],
};
