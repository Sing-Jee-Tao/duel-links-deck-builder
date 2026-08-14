/**
 * Builds the Duel Links card pool out of two upstreams, and holds every pure
 * decision so the shape of the pool is unit-testable without a network call.
 *
 * WHY TWO SOURCES: YGOPRODeck's `format=duel links` flag is the only legality
 * signal that API exposes, and it lags badly — as of 2026-08 it was missing
 * ~2,500 cards that Duel Links has actually released, including everything from
 * the 2026-07-28 box. duellinksmeta.com tracks the live game and carries a real
 * release date per card, so it decides *membership*. YGOPRODeck still supplies
 * the *detail*, because its `type` strings ("Synchro Monster", "Spell Card")
 * are the vocabulary the app parses downstream.
 *
 * The two sets are UNIONed rather than swapped. duellinksmeta's `release` field
 * has false negatives — cards that are plainly in the game but carry no date —
 * and dropping a card a player owns is far worse than showing one that is not
 * out yet. Cards YGOPRODeck flags but duellinksmeta has no release for are
 * reported for human review instead of being removed.
 */
import { RARITY_ORDER, type Card, type CardRarity } from "../../src/data/types.ts";

/** YGOPRODeck's payload, narrowed to the fields we read. */
export interface YgoCard {
  id: number;
  name: string;
  type: string;
  race: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  archetype?: string;
  desc: string;
  card_images?: { id: number }[];
}

/** A duellinksmeta `/api/v1/cards` record, narrowed to the fields we read. */
export interface DlmCard {
  _id?: string;
  konamiID?: string;
  name: string;
  /** Coarse: "Monster" | "Spell" | "Trap". */
  type: string;
  race?: string;
  monsterType?: string[];
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  description?: string;
  /** ISO 8601 date the card went live in Duel Links. Absent = not released. */
  release?: string;
  /** Rush Duel cards share the endpoint but are a different game mode. */
  rush?: boolean;
  /** "UR" | "SR" | "R" | "N". Only duellinksmeta knows this; YGOPRODeck does not. */
  rarity?: string;
  /** Every way the card can be got. We keep the first; see `attachAcquisition`. */
  obtain?: { amount?: number; type?: string; source?: { type?: string; name?: string } }[];
}

const EXTRA_DECK_MARKERS = ["fusion", "synchro", "xyz", "link"];

/**
 * Synthetic ids for Duel Links–exclusive cards start here. Real Konami
 * passcodes are at most 8 digits, so this range cannot collide with one — which
 * matters because `Card.id` keys the player's saved collection.
 */
export const SYNTHETIC_ID_BASE = 100_000_000;
const SYNTHETIC_ID_RANGE = 900_000_000;

export function isExtraDeckType(type: string): boolean {
  const lower = type.toLowerCase();
  return EXTRA_DECK_MARKERS.some((marker) => lower.includes(marker));
}

export function projectCard(raw: YgoCard): Card {
  const card: Card = {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    race: raw.race,
    desc: raw.desc,
    isExtraDeck: isExtraDeckType(raw.type),
  };
  if (raw.attribute !== undefined) card.attribute = raw.attribute;
  if (raw.level !== undefined) card.level = raw.level;
  if (raw.atk !== undefined) card.atk = raw.atk;
  if (raw.def !== undefined) card.def = raw.def;
  if (raw.archetype !== undefined) card.archetype = raw.archetype;
  return card;
}

/** A card counts as in the pool once Duel Links has actually released it. */
export function isReleased(card: DlmCard, now: number = Date.now()): boolean {
  if (card.rush) return false;
  if (!card.release) return false;
  const at = Date.parse(card.release);
  return Number.isFinite(at) && at <= now;
}

/**
 * Markers that already imply "Effect", so YGOPRODeck does not spell it out:
 * a Synchro with an effect is a "Synchro Monster", not a "Synchro Effect
 * Monster". Flip, Union, Ritual and Pendulum do keep the word.
 */
const ABSORBS_EFFECT = new Set(["Fusion", "Synchro", "XYZ", "Link", "Tuner", "Spirit", "Toon", "Gemini"]);

/** Summoning mechanic first, then sub-kind, matching YGOPRODeck's word order. */
const MARKER_ORDER = [
  "Ritual",
  "Fusion",
  "Synchro",
  "Xyz",
  "Link",
  "Pendulum",
  "Flip",
  "Union",
  "Spirit",
  "Toon",
  "Gemini",
  "Tuner",
] as const;

/**
 * Renders duellinksmeta's `monsterType[]` into YGOPRODeck's `type` vocabulary.
 * Only reached for the ~100 Duel Links–exclusive cards that have no passcode
 * and so appear in no other database; everything else keeps YGOPRODeck's own
 * string verbatim. The result has to survive `isExtraDeckType` here and
 * `broadType`/`typeLabel` in the Collection screen.
 */
export function synthesizeType(card: DlmCard): string {
  if (card.type === "Spell") return "Spell Card";
  if (card.type === "Trap") return "Trap Card";

  const markers = new Set(card.monsterType ?? []);
  const parts: string[] = MARKER_ORDER.filter((m) => markers.has(m)).map((m) => (m === "Xyz" ? "XYZ" : m));

  if (parts.length === 0) return markers.has("Effect") ? "Effect Monster" : "Normal Monster";
  if (markers.has("Effect") && !parts.some((p) => ABSORBS_EFFECT.has(p))) parts.push("Effect");
  return `${parts.join(" ")} Monster`;
}

function isExtraDeckDlm(card: DlmCard): boolean {
  const markers = card.monsterType ?? [];
  // duellinksmeta tags Extra Deck membership directly as well as by mechanic.
  if (markers.includes("extra-deck")) return true;
  return markers.some((m) => EXTRA_DECK_MARKERS.includes(m.toLowerCase()));
}

/** FNV-1a. Deterministic across runs, which is what saved collections need. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A stable id for a card that has no Konami passcode. Seeded from
 * duellinksmeta's permanent `_id` where possible so a card being renamed does
 * not silently orphan the copies a player already recorded.
 */
export function syntheticId(card: DlmCard, taken: ReadonlySet<number>): number {
  const seed = card._id ?? card.name;
  let id = SYNTHETIC_ID_BASE + (hash32(seed) % SYNTHETIC_ID_RANGE);
  // Probing keeps this deterministic; callers feed cards in a fixed order.
  while (taken.has(id)) id = SYNTHETIC_ID_BASE + ((id - SYNTHETIC_ID_BASE + 1) % SYNTHETIC_ID_RANGE);
  return id;
}

/** The Konami passcode duellinksmeta claims for a card, if it states a usable one. */
export function passcodeOf(card: DlmCard): number | null {
  const passcode = Number(card.konamiID);
  return Number.isFinite(passcode) && passcode > 0 ? passcode : null;
}

export function projectFromDlm(
  card: DlmCard,
  taken: ReadonlySet<number> = new Set(),
  passcode: number | null = passcodeOf(card),
): Card {
  const id = passcode ?? syntheticId(card, taken);
  const projected: Card = {
    id,
    name: card.name,
    type: synthesizeType(card),
    race: card.race ?? "",
    desc: card.description ?? "",
    isExtraDeck: isExtraDeckDlm(card),
  };
  if (card.attribute !== undefined) projected.attribute = card.attribute;
  if (card.level !== undefined) projected.level = card.level;
  if (card.atk !== undefined) projected.atk = card.atk;
  if (card.def !== undefined) projected.def = card.def;
  return projected;
}

export interface MergedPool {
  cards: Card[];
  /** Released per duellinksmeta but absent from YGOPRODeck's Duel Links flag. */
  addedFromDlm: Card[];
  /** Flagged by YGOPRODeck but with no duellinksmeta release — kept, reported. */
  unreleasedPerDlm: Card[];
  /** Cards taking the name Duel Links shows instead of YGOPRODeck's printed one. */
  renamed: { from: string; to: string }[];
  /** How many pool cards came away with a rarity, for the CI summary. */
  rarityCovered: number;
}

const RARITIES = new Set<string>(RARITY_ORDER);

/**
 * Copies rarity and acquisition source off the duellinksmeta record.
 *
 * YGOPRODeck has neither — rarity is a Duel Links property, not a printed one —
 * so this is the only place either can come from. It runs after the in-game
 * renames are applied, because the rename makes the pool's name match
 * duellinksmeta's and the join is by name.
 *
 * Only the FIRST `obtain` entry is kept. Cards commonly list several sources and
 * the full array would add megabytes to a 5.4 MB asset without changing any
 * decision a player makes: they want to know where to go, not every place the
 * card has ever appeared.
 */
export function attachAcquisition(cards: Card[], dlm: DlmCard[]): number {
  const byName = new Map<string, DlmCard>();
  for (const card of dlm) {
    const key = byNameKey(card.name);
    // First writer wins, matching the fixed sort order callers feed in.
    if (!byName.has(key)) byName.set(key, card);
  }

  let covered = 0;
  for (const card of cards) {
    const match = byName.get(byNameKey(card.name));
    if (!match) continue;

    if (match.rarity && RARITIES.has(match.rarity)) {
      card.rarity = match.rarity as CardRarity;
      covered += 1;
    }
    const source = (match.obtain ?? []).find((entry) => entry.source?.name)?.source;
    if (source?.name) {
      card.obtainedFrom = { type: source.type ?? "Unknown", name: source.name };
    }
  }
  return covered;
}

function byNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Unions the two upstreams. `ygoFull` is the unfiltered YGOPRODeck database,
 * consulted only to dress a duellinksmeta card that YGOPRODeck knows about but
 * has not flagged for Duel Links.
 */
export function mergePool(
  ygoDuelLinks: YgoCard[],
  ygoFull: YgoCard[],
  dlm: DlmCard[],
  /**
   * The unfiltered duellinksmeta list, used only for rarity and acquisition
   * data. A card YGOPRODeck flags but duellinksmeta has no release date for is
   * still kept in the pool, and it still has a rarity worth showing — so the
   * lookup must not be limited to the released subset.
   */
  dlmAll: DlmCard[] = dlm,
): MergedPool {
  // Tokens are not deckable and only pad the pool.
  const seed = ygoDuelLinks.filter((raw) => raw.type !== "Token").map(projectCard);

  const fullById = new Map<number, YgoCard>();
  const fullByName = new Map<string, YgoCard>();
  for (const raw of ygoFull) {
    if (raw.type === "Token") continue;
    fullById.set(raw.id, raw);
    // Alt-art printings carry their own passcode; duellinksmeta may cite either.
    for (const image of raw.card_images ?? []) if (!fullById.has(image.id)) fullById.set(image.id, raw);
    fullByName.set(byNameKey(raw.name), raw);
  }

  // Fixed order in, fixed synthetic ids out.
  const candidates = [...dlm].sort((a, b) => a.name.localeCompare(b.name, "en"));

  // duellinksmeta sometimes files two different cards under one passcode — 6498706
  // is both "Fusion Deployment" and the Duel Links–exclusive "For Our Dreams". A
  // passcode claimed by more than one name identifies neither, so those cards match
  // by name only and take a synthetic id if that fails. Without this the second card
  // looks like a duplicate of the first and is silently dropped.
  const namesPerPasscode = new Map<number, Set<string>>();
  for (const card of candidates) {
    const passcode = passcodeOf(card);
    if (passcode === null) continue;
    const claimed = namesPerPasscode.get(passcode) ?? new Set<string>();
    claimed.add(byNameKey(card.name));
    namesPerPasscode.set(passcode, claimed);
  }
  const trustedPasscode = (card: DlmCard): number | null => {
    const passcode = passcodeOf(card);
    if (passcode === null) return null;
    return (namesPerPasscode.get(passcode)?.size ?? 0) > 1 ? null : passcode;
  };

  // Duel Links sometimes ships a card under its own name — TCG "Synchronized
  // Realm" is "Synch Realm" in game, and rebalanced to 250 damage. Take the name
  // the player actually sees: it is what the scraped Forbidden/Limited list joins
  // on, so keeping YGOPRODeck's printed name leaves a forbidden card unmatched,
  // and an unmatched forbidden card validates as legal.
  const inGameName = new Map<number, string>();
  for (const card of candidates) {
    const passcode = trustedPasscode(card);
    if (passcode !== null) inGameName.set(passcode, card.name);
  }

  const renamed: { from: string; to: string }[] = [];
  const seedNames = new Set(seed.map((c) => byNameKey(c.name)));
  for (const card of seed) {
    const inGame = inGameName.get(card.id);
    if (inGame === undefined || inGame === card.name) continue;
    // Never let a rename collide with a card that already holds that name.
    if (seedNames.has(byNameKey(inGame))) continue;
    seedNames.delete(byNameKey(card.name));
    seedNames.add(byNameKey(inGame));
    renamed.push({ from: card.name, to: inGame });
    card.name = inGame;
  }

  const ids = new Set(seed.map((c) => c.id));
  const names = new Set(seed.map((c) => byNameKey(c.name)));
  const addedFromDlm: Card[] = [];
  const releasedIds = new Set<number>();
  const releasedNames = new Set<string>();

  for (const card of candidates) {
    const passcode = trustedPasscode(card);
    if (passcode !== null) releasedIds.add(passcode);
    releasedNames.add(byNameKey(card.name));

    if (names.has(byNameKey(card.name))) continue;
    if (passcode !== null && ids.has(passcode)) continue;

    const match = (passcode !== null ? fullById.get(passcode) : undefined) ?? fullByName.get(byNameKey(card.name));
    const projected = match ? projectCard(match) : projectFromDlm(card, ids, passcode);
    if (ids.has(projected.id)) continue;

    ids.add(projected.id);
    names.add(byNameKey(projected.name));
    addedFromDlm.push(projected);
  }

  const unreleasedPerDlm = seed.filter(
    (card) => !releasedIds.has(card.id) && !releasedNames.has(byNameKey(card.name)),
  );

  const cards = [...seed, ...addedFromDlm].sort((a, b) => a.name.localeCompare(b.name, "en"));
  const rarityCovered = attachAcquisition(cards, dlmAll);
  return { cards, addedFromDlm, unreleasedPerDlm, renamed, rarityCovered };
}

/** A shrink larger than this share of the previous total is treated as a bad pull. */
export const MAX_SHRINK = 0.25;

export class PoolError extends Error {}

/**
 * Fail-safe, mirroring the banlist scraper's `assertSane`. Growth is expected —
 * the first union run adds ~2,500 cards — so only shrinkage is guarded: losing
 * cards is what breaks a saved collection.
 */
export function assertPoolSane(next: Card[], previousCount: number): void {
  if (next.length === 0) {
    throw new PoolError("Merged pool came back empty — refusing to overwrite cards.json.");
  }
  if (previousCount === 0) return;
  const shrink = (previousCount - next.length) / previousCount;
  if (shrink > MAX_SHRINK) {
    throw new PoolError(
      `Pool shrank ${previousCount} → ${next.length} (${(shrink * 100).toFixed(1)}%), over the ` +
        `${(MAX_SHRINK * 100).toFixed(0)}% guard. Refusing to overwrite cards.json.`,
    );
  }
}
