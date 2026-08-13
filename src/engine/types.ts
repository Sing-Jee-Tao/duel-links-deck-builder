import type { Banlist, Card, DeckTemplate, FlexRole } from "../data/types.ts";

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
  /** 0–100, `tierScore × completion × 10`. */
  powerScore: number;
  validation: ValidationResult;
  /** True when the deck could not legally reach `minMain`. */
  partial: boolean;
  /** Why the build is partial or empty. Never thrown, always explained. */
  reason?: string;
  /** Top 3 templates by rank, for the upgrade screen. */
  candidates: TemplateScore[];
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
}

export type { FlexRole };
