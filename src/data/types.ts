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
}

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
 * A target deck. Either hand-authored in `data/templates/*.json`, or derived
 * from duellinksmeta's tournament corpus into `data/decks.json` — see
 * `scripts/lib/derive-templates.ts`.
 */
export interface DeckTemplate {
  id: string;
  name: string;
  /** 1–10. Authored for hand-written decks, derived from meta share otherwise. */
  tierScore: number;
  coreCards: { name: string; copies: number }[];
  flexSlots: FlexSlot[];
  extraDeck: { name: string; copies: number }[];
  source: TemplateSource;
  /**
   * Only hand-authored decks carry prose. A derived template has none, and
   * inventing it would be worse than the data guide the Strategy screen builds
   * from `meta` instead.
   */
  strategy?: DeckStrategy;
  /** Present exactly when `source` is `"meta"`. */
  meta?: TemplateProvenance;
}

export type TemplateSource = "authored" | "meta";

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

export interface DeckStrategy {
  gamePlan: string;
  openingPriorities: string[];
  keyInteractions: string[];
  matchups: { against: string; notes: string; winRate?: number }[];
}
