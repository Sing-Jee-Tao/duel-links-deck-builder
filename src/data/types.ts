/**
 * Data contracts shared by the pipeline scripts (`scripts/`) and the app.
 *
 * Everything here describes a file committed under `data/`. The app reads these
 * files as static assets; it never contacts a third party at runtime.
 */

/**
 * A card in the Duel Links pool. duellinksmeta decides membership; YGOPRODeck
 * supplies the detail wherever it knows the card. See
 * `scripts/lib/duel-links-pool.ts`.
 */
export interface Card {
  /**
   * The Konami passcode. Duel Links–exclusive cards have never had a printed
   * passcode, so they get a stable synthetic id at or above 100000000 — this is
   * the key a player's saved collection is stored under, so it must not drift.
   */
  id: number;
  name: string;
  /** YGOPRODeck's type vocabulary, e.g. "Effect Monster", "Spell Card", "XYZ Monster". */
  type: string;
  race: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  archetype?: string;
  desc: string;
  /** Derived: Fusion | Synchro | XYZ | Link belong in the Extra Deck. */
  isExtraDeck: boolean;
  /**
   * Duel Links rarity. This is the real scarcity signal in the game — a deck
   * needing six URs is a different proposition from one needing six Ns — and it
   * comes from duellinksmeta rather than being estimated.
   */
  rarity?: CardRarity;
  /**
   * Where the card primarily comes from, e.g. `{ type: "Main Box", name: "Abyss
   * Encounters" }` — the first route upstream lists, kept as the headline for
   * every screen that has room for exactly one source. `routes` carries the
   * rest; this stays because it is what the collection and upgrade rows read.
   */
  obtainedFrom?: { type: string; name: string };
  /**
   * EVERY way the card can be got, not just the headline one.
   *
   * This used to be truncated to the first entry on the grounds that the extra
   * ones would bloat `cards.json` without changing a decision. Both halves of
   * that turned out to be wrong. 57.7% of released cards have more than one
   * route and 2,916 of them — including 674 URs — are obtainable without ever
   * opening a box, so the truncated field was hiding the cheapest path to more
   * than half the pool. And the full array costs ~220 kB gzipped, against the
   * ~980 kB the pool already ships.
   *
   * `amount` is what makes a gem cost computable rather than invented: it is
   * how many copies of this card sit in that box, and a box is a fixed pile.
   */
  routes?: AcquisitionRoute[];
}

/**
 * One way to get a card.
 *
 * `kind` is what decides how it is priced, so it is deliberately coarse:
 * a `set` is a random pull and costs gems in expectation, while a `character`
 * or `other` route costs time instead and must never be priced in gems.
 */
export interface AcquisitionRoute {
  kind: "set" | "character" | "other";
  /** "Main Box", "Mini Box", "Structure Deck" … for sets; absent otherwise. */
  setType?: string;
  /** "Abyss Encounters", "Yugi Muto", "Ranked Duels Ticket". */
  name: string;
  /** "Level 10", "Drop" — how a character route unlocks. */
  detail?: string;
  /** Copies of this card in that box. Only meaningful when `kind` is "set". */
  amount?: number;
}

/**
 * A box, as `data/sets.json` records it.
 *
 * A Duel Links box is a fixed pile of cards drawn without replacement, three to
 * a pack, so `copies` and the per-card `amount` are together enough to compute
 * how many packs a given pull takes. Every Main Box comes back a clean multiple
 * of three (600 copies = 200 packs), which is the check the pipeline enforces.
 */
export interface BoxSet {
  /** "Main Box", "Mini Box", "Selection Box", "Structure Deck" … */
  type: string;
  name: string;
  /** ISO 8601, where duellinksmeta states one. */
  release?: string;
  /** Distinct cards in the box. */
  cards: number;
  /** Total card copies in the box — the size of the pile you draw from. */
  copies: number;
  /**
   * How many packs empty the box.
   *
   * ABSENT MEANS DO NOT PRICE THIS BOX. That is the case either when the box is
   * not bought pack by pack (a Structure Deck is bought whole) or when the
   * upstream copy counts are not credible enough to divide — see `suspect`.
   */
  packs?: number;
  /**
   * Why this box has no `packs`, where the reason is bad data rather than the
   * box simply not being pack-drawn. Carried so CI can report it and the UI can
   * say "we cannot price this" instead of quietly showing a wrong number.
   */
  suspect?: string;
  /** Copies by rarity, e.g. `{ UR: 10, SR: 24, R: 192, N: 374 }`. */
  byRarity: Partial<Record<CardRarity, number>>;
}

/** `data/sets.json` */
export interface SetFile {
  fetchedAt: string;
  source: string;
  count: number;
  sets: BoxSet[];
}

/** Ultra Rare, Super Rare, Rare, Normal — Duel Links' four rarities. */
export type CardRarity = "UR" | "SR" | "R" | "N";

/** Rarity order for display and for bucketing a shortfall, scarcest first. */
export const RARITY_ORDER: CardRarity[] = ["UR", "SR", "R", "N"];

/**
 * Cards in one pack of a Duel Links box.
 *
 * This is a game rule, not a tuning knob, and it is the bridge between the two
 * units the app has to move between: boxes are measured in copies, players buy
 * in packs. Every Main Box in the pool divides cleanly by it (600 copies = 200
 * packs), which is the invariant `deriveSets` asserts.
 */
export const CARDS_PER_PACK = 3;

/** `data/cards.json` */
export interface CardFile {
  fetchedAt: string;
  source: string;
  count: number;
  cards: Card[];
}

export type LimitTier = "forbidden" | "limited1" | "limited2" | "limited3";

/** `data/banlist.json` — card names, not ids: the source lists names only. */
export interface Banlist {
  /** ISO 8601. */
  scrapedAt: string;
  source: "scrape" | "override" | "fallback";
  forbidden: string[];
  limited1: string[];
  limited2: string[];
  limited3: string[];
}

/**
 * `data/banlist-override.json` — hand-applied on top of the scraped result so a
 * Konami announcement can land before the weekly scrape catches up. A card name
 * listed under `unlimited` is removed from every tier.
 */
export interface BanlistOverride {
  note?: string;
  /** ISO 8601 date the override was authored. */
  updatedAt?: string;
  forbidden?: string[];
  limited1?: string[];
  limited2?: string[];
  limited3?: string[];
  unlimited?: string[];
}

/** The pooled budget each tier grants across the whole deck. */
export const TIER_BUDGET: Record<Exclude<LimitTier, "forbidden">, number> = {
  limited1: 1,
  limited2: 2,
  limited3: 3,
};

export const LIMITED_TIERS = ["limited1", "limited2", "limited3"] as const;

/**
 * A target deck, derived from duellinksmeta's tournament corpus into
 * `data/decks.json` — see `scripts/lib/derive-templates.ts`.
 *
 * There is no hand-authored variant. Four templates were written by hand early
 * on; they were retired once the corpus supplied 71, because a handful of
 * maintained guides could not cover the pool and no source of strategy prose
 * exists that we can lawfully reuse. Every deck now speaks in one voice, from
 * measurement.
 */
export interface DeckTemplate {
  id: string;
  name: string;
  /** 1–10, from the deck type's stated tier or its share of recent lists. */
  tierScore: number;
  coreCards: { name: string; copies: number }[];
  flexSlots: FlexSlot[];
  extraDeck: { name: string; copies: number }[];
  meta: TemplateProvenance;
}

/** What the tournament corpus said about a derived template, shown verbatim. */
export interface TemplateProvenance {
  /** Tournament lists this template was derived from. */
  deckCount: number;
  /** How far back those lists were drawn from. */
  windowDays: number;
  /** One real list on duellinksmeta, as a path. */
  sampleUrl: string;
  /** The Skills those lists ran, most common first. */
  skills: { name: string; count: number }[];
  /**
   * The Skill the deck is actually played with, promoted out of `skills`
   * because every screen wants the one rather than the distribution. A Duel
   * Links deck without its Skill is a different deck.
   */
  skill?: { name: string; share: number };
  /**
   * Median gem cost of the lists this was derived from. Median, not mean: one
   * list packed with alternate-art staples should not move it.
   */
  gemsPrice: number;
  /** Card name → share of lists containing it, 0–1. */
  inclusion: Record<string, number>;
}

/** `data/decks.json` — the derived templates. */
export interface DeckFile {
  fetchedAt: string;
  source: string;
  windowDays: number;
  count: number;
  templates: DeckTemplate[];
}

/**
 * How often cards are played and which cards are played together, measured
 * across the same corpus. Keyed by `Card.id`. This is what lets the engine
 * assemble a deck for a collection that matches no template: the pool carries
 * effect text only as prose, but co-occurrence across thousands of real lists
 * is a usable synergy signal without parsing a single ruling.
 */
export interface SynergyCard {
  /** Lists containing this card. */
  play: number;
  /** Distinct deck types running it — high spread means a generic staple. */
  spread: number;
  /** Top co-occurring partners as [card id, shared lists]. */
  partners: [number, number][];
}

/** `data/synergy.json` */
export interface SynergyFile {
  fetchedAt: string;
  source: string;
  windowDays: number;
  /** Lists the statistics were measured over. */
  deckCount: number;
  cards: Record<number, SynergyCard>;
}

export type FlexRole =
  | "draw"
  | "removal"
  | "disruption"
  | "recovery"
  | "beater";

export interface FlexSlot {
  role: FlexRole;
  count: number;
  /** Preference order. */
  candidates: string[];
}

