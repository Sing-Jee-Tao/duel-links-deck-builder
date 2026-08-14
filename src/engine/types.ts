import type { Banlist, Card, CardRarity, DeckTemplate, FlexRole, SynergyCard } from "../data/types.ts";

/** One card name and how many copies of it sit in a deck. */
export interface DeckEntry {
  name: string;
  copies: number;
}

export interface Deck {
  main: DeckEntry[];
  extra: DeckEntry[];
}

export interface BuildConfig {
  /** User-settable 5–9. */
  extraDeckSize: number;
  minMain: number;
  maxMain: number;
  maxCopies: number;
}

export const DEFAULT_CONFIG: BuildConfig = {
  extraDeckSize: 5,
  minMain: 20,
  maxMain: 30,
  maxCopies: 3,
};

export type ViolationCode =
  | "main-deck-size"
  | "extra-deck-size"
  | "copy-limit"
  | "forbidden"
  | "tier-budget";

export interface Violation {
  code: ViolationCode;
  /** Human-readable, shown verbatim in the legality panel. */
  message: string;
  /** Card names implicated, where the violation is about specific cards. */
  cards: string[];
  /** Set for `tier-budget`. */
  tier?: 1 | 2 | 3;
  budget?: number;
  used?: number;
}

export interface ValidationResult {
  legal: boolean;
  /** Every violation found, not just the first. */
  violations: Violation[];
  mainCount: number;
  extraCount: number;
  /** Which cards occupy each pooled tier budget, with copies. */
  allowance: AllowanceState;
}

export interface AllowanceSlotUse {
  name: string;
  copies: number;
}

export interface AllowanceTierState {
  tier: 1 | 2 | 3;
  budget: number;
  used: number;
  /** One entry per copy-consuming card, in deck order. */
  slots: AllowanceSlotUse[];
}

export interface AllowanceState {
  tiers: [AllowanceTierState, AllowanceTierState, AllowanceTierState];
  /** Total copies spent across all three tiers. */
  spent: number;
  /** Total budget across all three tiers — 6. */
  total: number;
}

/** Collection as the engine consumes it: normalized card name → 0–3 copies. */
export type OwnedCounts = ReadonlyMap<string, number>;

/** Card metadata, looked up by normalized name. */
export type CardIndex = ReadonlyMap<string, Card>;

/** Play rate, deck-type spread and co-occurring partners, by card id. */
export type SynergyIndex = ReadonlyMap<number, SynergyCard>;

export interface TemplateScore {
  template: DeckTemplate;
  /** 0–1, weighted core+flex completion. */
  completion: number;
  /** `tierScore × completion`, the ranking key. */
  rank: number;
  /** Core cards the player is short on, with how many copies are missing. */
  missingCore: DeckEntry[];
}

export interface BuildResult {
  template: DeckTemplate | null;
  deck: Deck;
  mainCount: number;
  /**
   * 0–100. For a templated deck, `tierScore × completion × 10`. For a deck the
   * solver assembled without a template, the share of its card pairs that real
   * tournament lists play together — a different measurement on the same axis.
   */
  powerScore: number;
  /** Set on a synthesized deck: the archetype its spine was seeded from. */
  archetype?: string;
  /**
   * Every core card is owned — this deck is playable as built, not a legal 20
   * cards standing in for one. Kept separate from `powerScore` because the two
   * answer different questions and conflating them hid the difference between a
   * finished tier-6 deck and a gutted tier-10 one.
   */
  ready: boolean;
  /** What is still missing before the deck matches the list it is built from. */
  shortfall: Shortfall;
  /**
   * Median gem cost of the WHOLE list per the corpus — not the cost of the
   * shortfall. Per-card gem prices do not exist upstream, so apportioning this
   * across missing cards would be an invented number.
   */
  gemsPrice: number;
  validation: ValidationResult;
  /** True when the deck could not legally reach `minMain`. */
  partial: boolean;
  /** Why the build is partial or empty. Never thrown, always explained. */
  reason?: string;
  /** Every template scored against the collection, ranked — the upgrade targets. */
  candidates: TemplateScore[];
}

/**
 * The gap between a build and the list it came from, counted in copies and
 * bucketed by rarity.
 *
 * Rarity is the bucket that matters: Duel Links players think in "three URs
 * away", not "eleven cards away", because URs are what a box actually rations.
 */
export interface Shortfall {
  /** Missing copies by rarity, e.g. `{ UR: 6, SR: 2 }`. */
  byRarity: Partial<Record<CardRarity, number>>;
  /** Total missing copies. */
  copies: number;
  /** Distinct cards missing at least one copy. */
  cards: number;
}

export interface DiffEntry extends DeckEntry {
  /** Copies of this card already in the current deck. */
  inCurrent: number;
  /** Copies the target wants. */
  inTarget: number;
}

export interface DeckDiff {
  toAcquire: DiffEntry[];
  toCut: DiffEntry[];
  /** 0–100. */
  completionPct: number;
  /** Copies shared by both decks. */
  sharedCopies: number;
  targetCopies: number;
}

export interface BuildInputs {
  owned: OwnedCounts;
  templates: DeckTemplate[];
  banlist: Banlist;
  cards: CardIndex;
  config: BuildConfig;
  /**
   * Play rates and co-occurrence from the tournament corpus. Optional: without
   * it the template-free solver still runs, but on card kind and ATK alone.
   */
  synergy?: SynergyIndex;
}

export type { FlexRole };
