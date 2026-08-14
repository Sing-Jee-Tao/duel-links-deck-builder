/**
 * Derives deck templates from duellinksmeta's tournament corpus.
 *
 * WHY: four hand-authored templates cannot cover a 10,000-card pool, and no
 * amount of card text tells you which cards experienced players actually run
 * together. `/api/v1/top-decks` does: a few thousand real King-of-Games and
 * tournament lists, each tagged with its deck type. Grouping those and counting
 * how often each card appears gives a core/flex split that is measured rather
 * than guessed — a card in 100% of Traptrix lists is core, one in 40% is a flex
 * choice, and that is exactly the distinction `DeckTemplate` already encodes.
 *
 * Everything here is pure so the shape of a template is testable against a saved
 * fixture without a network call. `fetch-decks.ts` does the I/O.
 */
import type { Card, DeckTemplate, FlexRole, FlexSlot } from "../../src/data/types.ts";
import { normalizeName } from "../../src/engine/banlist-index.ts";

/** A `/api/v1/deck-types` row, narrowed to the fields we read. */
export interface DlmDeckType {
  name: string;
  /** Rush Duel is a separate game mode and shares the endpoint. */
  rush?: boolean;
  /** 1 (best) – 4, present on only a handful of rows. */
  tier?: number | null;
  tournamentPower?: number;
  deckBreakdown?: {
    total?: number;
    avgMainSize?: number;
    skills?: { name?: string; count?: number }[];
  };
}

export interface DlmDeckCard {
  amount?: number;
  card?: { name?: string } | null;
}

/** A `/api/v1/top-decks` row, narrowed to the fields we read. */
export interface DlmTopDeck {
  _id?: string;
  created?: string;
  url?: string;
  skill?: { name?: string } | null;
  deckType?: { name?: string } | null;
  main?: DlmDeckCard[];
  extra?: DlmDeckCard[];
  /** What the list costs in gems. Absent on a handful of older entries. */
  gemsPrice?: number;
}

/** Middle value, or the mean of the two middles. 0 for an empty sample. */
export function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round((((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2));
}

export interface DeriveOptions {
  /** Only decks this recent count toward a template. */
  windowDays: number;
  /** A deck type with fewer lists than this is noise, not a template. */
  minDecks: number;
  /** How many co-occurring partners to keep per card in `synergy.json`. */
  synergyPartners: number;
  now: number;
}

export const DEFAULT_DERIVE_OPTIONS: DeriveOptions = {
  windowDays: 180,
  minDecks: 5,
  synergyPartners: 24,
  now: Date.now(),
};

/** Inclusion at or above this makes a card core rather than a flex choice. */
export const CORE_THRESHOLD = 0.75;
/** Below this a card is a one-off in someone's list, not a candidate. */
export const FLEX_THRESHOLD = 0.2;
/** An Extra Deck slot has to show up in half the lists to be worth naming. */
export const EXTRA_THRESHOLD = 0.5;

const MIN_MAIN = 20;
const MAX_MAIN = 30;
const MAX_EXTRA = 9;
const MAX_COPIES = 3;

export class TemplateError extends Error {}

/** A shift larger than this in either direction is treated as a bad pull. */
export const MAX_DRIFT = 0.25;
/** Below this share of names resolving against the pool, the join is broken. */
export const MIN_JOIN_RATE = 0.95;

// --- role classification ----------------------------------------------------

/**
 * Which flex role a card fills, from its type and effect text.
 *
 * `data/cards.json` carries effect text as unstructured prose, so this is a
 * coarse read and deliberately so: the role only decides which flex slot a
 * candidate lands in, and every slot is filled in inclusion order anyway. A
 * misfiled card costs preference order, never legality.
 */
const ROLE_PATTERNS: [FlexRole, RegExp][] = [
  ["draw", /\bdraw \d|\bdraw (?:a|one|1) card|add 1 [^.]{0,80}from your (?:main )?deck to your hand/i],
  ["recovery", /from your (?:gy|graveyard)[^.]{0,60}(?:to your hand|special summon)|return[^.]{0,40}from your (?:gy|graveyard)/i],
  ["disruption", /negate|cannot (?:be )?(?:activate|target|attack|special summon)|skip the|take control/i],
  ["removal", /destroy|banish|return (?:it|them|that target)|send (?:it|them)[^.]{0,30}to the (?:gy|graveyard)/i],
];

export function classifyRole(card: Card | undefined): FlexRole {
  if (!card) return "beater";
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(card.desc)) return role;
  }
  if (card.type.includes("Trap")) return "disruption";
  if (card.type.includes("Spell")) return "removal";
  return "beater";
}

/** Slot order in the template, so the strongest roles are committed first. */
const ROLE_ORDER: FlexRole[] = ["draw", "removal", "disruption", "recovery", "beater"];

// --- counting ---------------------------------------------------------------

interface CardStat {
  name: string;
  /** Lists containing the card, over lists in the group. */
  inclusion: number;
  /** Mean copies among the lists that contain it. */
  avgCopies: number;
}

/**
 * Collapses one list's rows into name → copies.
 *
 * A list can carry the same card in two rows; counting rows rather than lists
 * pushes inclusion above 100% and inflates `avgCopies`, so rows are summed and
 * the deck counted once.
 */
export function tallyDeck(entries: DlmDeckCard[] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) {
    const name = entry?.card?.name;
    if (!name) continue;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    counts.set(name, Math.min(MAX_COPIES, (counts.get(name) ?? 0) + amount));
  }
  return counts;
}

function statsFor(decks: Map<string, number>[]): CardStat[] {
  const lists = new Map<string, number>();
  const copies = new Map<string, number>();
  for (const deck of decks) {
    for (const [name, amount] of deck) {
      lists.set(name, (lists.get(name) ?? 0) + 1);
      copies.set(name, (copies.get(name) ?? 0) + amount);
    }
  }
  return [...lists]
    .map(([name, count]) => ({
      name,
      inclusion: count / decks.length,
      avgCopies: (copies.get(name) ?? 0) / count,
    }))
    .sort((a, b) => b.inclusion - a.inclusion || b.avgCopies - a.avgCopies || a.name.localeCompare(b.name, "en"));
}

// --- flex slots -------------------------------------------------------------

/**
 * Turns the flex-range cards into slots sized so that core + flex lands on the
 * list size the corpus actually plays, clamped to what the validator accepts.
 */
export function buildFlexSlots(
  flex: CardStat[],
  coreCopies: number,
  targetMain: number,
  cards: ReadonlyMap<string, Card>,
): FlexSlot[] {
  const budget = Math.max(0, Math.min(MAX_MAIN, Math.max(MIN_MAIN, targetMain)) - coreCopies);
  if (budget === 0 || flex.length === 0) return [];

  const byRole = new Map<FlexRole, CardStat[]>();
  for (const stat of flex) {
    const role = classifyRole(cards.get(normalizeName(stat.name)));
    byRole.set(role, [...(byRole.get(role) ?? []), stat]);
  }

  const roles = ROLE_ORDER.filter((role) => (byRole.get(role)?.length ?? 0) > 0);
  if (roles.length === 0) return [];

  // Weight each role by how much of the corpus's flex space it actually takes,
  // then hand every role at least one slot so no role is silently dropped.
  const weight = (role: FlexRole): number =>
    (byRole.get(role) ?? []).reduce((sum, s) => sum + s.inclusion * s.avgCopies, 0);
  const total = roles.reduce((sum, role) => sum + weight(role), 0);

  const counts = new Map<FlexRole, number>();
  for (const role of roles) counts.set(role, 1);
  let assigned = roles.length;

  // More roles than budget: keep the heaviest, drop the rest.
  if (assigned > budget) {
    const kept = [...roles].sort((a, b) => weight(b) - weight(a)).slice(0, budget);
    for (const role of roles) if (!kept.includes(role)) counts.delete(role);
    assigned = kept.length;
  }

  const remaining = budget - assigned;
  if (remaining > 0 && total > 0) {
    const shares = [...counts.keys()].map((role) => ({ role, exact: (weight(role) / total) * remaining }));
    for (const share of shares) {
      const whole = Math.floor(share.exact);
      counts.set(share.role, (counts.get(share.role) ?? 0) + whole);
      assigned += whole;
    }
    // Largest-remainder, so the slots sum to the budget exactly.
    const byRemainder = shares
      .map((s) => ({ role: s.role, fraction: s.exact - Math.floor(s.exact) }))
      .sort((a, b) => b.fraction - a.fraction || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    for (const { role } of byRemainder) {
      if (assigned >= budget) break;
      counts.set(role, (counts.get(role) ?? 0) + 1);
      assigned += 1;
    }
  }

  return ROLE_ORDER.filter((role) => counts.has(role)).map((role) => {
    const candidates = (byRole.get(role) ?? []).map((s) => s.name);
    // A slot can never ask for more copies than its candidates could legally
    // supply. Proportional sizing does not know how many candidates a role has,
    // so without this a role with one candidate could be handed four slots and
    // the template would describe a deck nobody can build.
    return { role, count: Math.min(counts.get(role) ?? 1, candidates.length * MAX_COPIES), candidates };
  });
}

// --- tier score -------------------------------------------------------------

/**
 * A 1–10 authored-scale tier score for a derived template, so sourced and
 * hand-authored templates rank against each other on one axis.
 *
 * duellinksmeta states an explicit tier for only a handful of deck types; for
 * everything else the honest signal is representation — what share of recent
 * tournament lists the deck accounts for.
 *
 * `representationRank` is a PERCENTILE among surviving deck types, not a ratio
 * to the largest. Deck counts are heavily skewed — the top archetype had 451
 * lists and the median 12 — so scoring on the raw ratio collapsed three
 * quarters of the corpus onto tier 1 and made the ranking useless.
 */
export function tierScoreFor(deckType: DlmDeckType | undefined, representationRank: number): number {
  const stated = deckType?.tier;
  if (typeof stated === "number" && stated >= 1 && stated <= 4) {
    return Math.max(7, Math.min(10, 11 - stated));
  }
  return Math.max(1, Math.min(9, Math.round(1 + 8 * representationRank)));
}

// --- the derivation ---------------------------------------------------------

export interface SynergyCard {
  /** Lists containing this card. */
  play: number;
  /** Distinct deck types running it — the staple signal. */
  spread: number;
  /** Top co-occurring partners as [card id, shared lists]. */
  partners: [number, number][];
}

export interface DeriveResult {
  templates: DeckTemplate[];
  synergy: Record<number, SynergyCard>;
  stats: {
    decksSeen: number;
    decksInWindow: number;
    decksAfterRush: number;
    deckTypes: number;
    templates: number;
    namesSeen: number;
    namesJoined: number;
    joinRate: number;
    unresolved: string[];
  };
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `meta-${base || "deck"}`;
}

export function deriveTemplates(
  topDecks: DlmTopDeck[],
  deckTypes: DlmDeckType[],
  pool: Card[],
  options: Partial<DeriveOptions> = {},
): DeriveResult {
  const opts = { ...DEFAULT_DERIVE_OPTIONS, ...options };
  const cards = new Map(pool.map((c) => [normalizeName(c.name), c]));
  const idOf = (name: string): number | undefined => cards.get(normalizeName(name))?.id;

  const typeByName = new Map(deckTypes.map((t) => [t.name, t]));
  const rushTypes = new Set(deckTypes.filter((t) => t.rush).map((t) => t.name));

  const cutoff = opts.now - opts.windowDays * 86_400_000;
  const inWindow = topDecks.filter((d) => {
    const at = Date.parse(d.created ?? "");
    return Number.isFinite(at) && at >= cutoff;
  });
  // Rush Duel is a different game mode with a different card pool. The deck-type
  // flag is the reliable signal; the "Rush!" naming convention is not applied
  // consistently upstream.
  const speedDuel = inWindow.filter((d) => d.deckType?.name && !rushTypes.has(d.deckType.name));

  const groups = new Map<string, DlmTopDeck[]>();
  for (const deck of speedDuel) {
    const name = deck.deckType?.name;
    if (!name) continue;
    groups.set(name, [...(groups.get(name) ?? []), deck]);
  }

  const surviving = [...groups.entries()]
    .filter(([, decks]) => decks.length >= opts.minDecks)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "en"));

  // --- name resolution, measured before anything is built ------------------
  const seen = new Set<string>();
  const unresolved = new Set<string>();
  for (const [, decks] of surviving) {
    for (const deck of decks) {
      for (const name of [...tallyDeck(deck.main).keys(), ...tallyDeck(deck.extra).keys()]) {
        seen.add(name);
        if (!cards.has(normalizeName(name))) unresolved.add(name);
      }
    }
  }
  const joinRate = seen.size === 0 ? 0 : (seen.size - unresolved.size) / seen.size;

  // --- synergy: play rate, deck-type spread, co-occurrence -----------------
  const play = new Map<number, number>();
  const spread = new Map<number, Set<string>>();
  const pairs = new Map<number, Map<number, number>>();

  for (const [typeName, decks] of surviving) {
    for (const deck of decks) {
      const ids = [...new Set([...tallyDeck(deck.main).keys(), ...tallyDeck(deck.extra).keys()])]
        .map(idOf)
        .filter((id): id is number => id !== undefined);
      for (const id of ids) {
        play.set(id, (play.get(id) ?? 0) + 1);
        if (!spread.has(id)) spread.set(id, new Set());
        spread.get(id)?.add(typeName);
      }
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = ids[i] as number;
          const b = ids[j] as number;
          for (const [from, to] of [
            [a, b],
            [b, a],
          ] as [number, number][]) {
            if (!pairs.has(from)) pairs.set(from, new Map());
            const row = pairs.get(from) as Map<number, number>;
            row.set(to, (row.get(to) ?? 0) + 1);
          }
        }
      }
    }
  }

  const synergy: Record<number, SynergyCard> = {};
  for (const [id, count] of [...play].sort((a, b) => a[0] - b[0])) {
    synergy[id] = {
      play: count,
      spread: spread.get(id)?.size ?? 0,
      partners: [...(pairs.get(id) ?? new Map<number, number>())]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, opts.synergyPartners),
    };
  }

  // --- templates -----------------------------------------------------------
  // `surviving` is already sorted by list count, descending, so a group's index
  // is its rank: the busiest archetype scores 1, the quietest 0.
  const rankOf = new Map<string, number>();
  surviving.forEach(([name], i) => {
    rankOf.set(name, surviving.length <= 1 ? 1 : (surviving.length - 1 - i) / (surviving.length - 1));
  });
  const templates: DeckTemplate[] = [];

  for (const [typeName, decks] of surviving) {
    const deckType = typeByName.get(typeName);
    const mainStats = statsFor(decks.map((d) => tallyDeck(d.main))).filter((s) =>
      cards.has(normalizeName(s.name)),
    );
    const extraStats = statsFor(decks.map((d) => tallyDeck(d.extra))).filter((s) =>
      cards.has(normalizeName(s.name)),
    );

    const core = mainStats.filter((s) => s.inclusion >= CORE_THRESHOLD);
    const flex = mainStats.filter((s) => s.inclusion >= FLEX_THRESHOLD && s.inclusion < CORE_THRESHOLD);
    const coreCards = core.map((s) => ({
      name: s.name,
      copies: Math.max(1, Math.min(MAX_COPIES, Math.round(s.avgCopies))),
    }));
    const coreCopies = coreCards.reduce((sum, c) => sum + c.copies, 0);

    // A core list that already overshoots the legal maximum means the grouping
    // caught two different builds under one deck type; there is no honest
    // template to derive from that.
    if (coreCopies > MAX_MAIN) continue;

    // No card in three quarters of the lists means the group has no shared
    // identity — duellinksmeta's "Other" bucket, or a strategy like Burn whose
    // lists agree on nothing. Such a template cannot anchor a build or be
    // "ready", so it is not a deck target worth offering.
    if (coreCards.length === 0) continue;

    const targetMain = Math.round(deckType?.deckBreakdown?.avgMainSize ?? MIN_MAIN);
    const flexSlots = buildFlexSlots(flex, coreCopies, targetMain, cards);
    if (coreCopies + flexSlots.reduce((sum, s) => sum + s.count, 0) < MIN_MAIN) continue;

    const extraDeck: { name: string; copies: number }[] = [];
    let extraCopies = 0;
    for (const stat of extraStats) {
      if (stat.inclusion < EXTRA_THRESHOLD) break;
      // The remaining room is the hard cap; clamp to it before the floor of 1,
      // or a full Extra Deck still admits one more card.
      const room = MAX_EXTRA - extraCopies;
      if (room <= 0) break;
      const copies = Math.min(room, Math.max(1, Math.min(MAX_COPIES, Math.round(stat.avgCopies))));
      extraDeck.push({ name: stat.name, copies });
      extraCopies += copies;
    }

    const inclusion: Record<string, number> = {};
    for (const stat of [...core, ...flex, ...extraStats.filter((s) => s.inclusion >= EXTRA_THRESHOLD)]) {
      inclusion[stat.name] = Math.round(stat.inclusion * 100) / 100;
    }

    const skills = new Map<string, number>();
    for (const deck of decks) {
      const name = deck.skill?.name;
      if (name) skills.set(name, (skills.get(name) ?? 0) + 1);
    }
    const rankedSkills = [...skills]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
      .map(([name, count]) => ({ name, count }));
    const topSkill = rankedSkills[0];

    const gemsPrice = median(
      decks.map((d) => d.gemsPrice).filter((g): g is number => typeof g === "number" && g > 0),
    );

    templates.push({
      id: slug(typeName),
      name: typeName,
      tierScore: tierScoreFor(deckType, rankOf.get(typeName) ?? 0),
      coreCards,
      flexSlots,
      extraDeck,
      meta: {
        deckCount: decks.length,
        windowDays: opts.windowDays,
        sampleUrl: decks.find((d) => d.url)?.url ?? "",
        skills: rankedSkills.slice(0, 5),
        ...(topSkill
          ? { skill: { name: topSkill.name, share: Math.round((topSkill.count / decks.length) * 100) / 100 } }
          : {}),
        gemsPrice,
        inclusion,
      },
    });
  }

  templates.sort((a, b) => b.tierScore - a.tierScore || a.name.localeCompare(b.name, "en"));

  return {
    templates,
    synergy,
    stats: {
      decksSeen: topDecks.length,
      decksInWindow: inWindow.length,
      decksAfterRush: speedDuel.length,
      deckTypes: groups.size,
      templates: templates.length,
      namesSeen: seen.size,
      namesJoined: seen.size - unresolved.size,
      joinRate,
      unresolved: [...unresolved].sort((a, b) => a.localeCompare(b, "en")),
    },
  };
}

/**
 * Fail-safe, mirroring `assertPoolSane`. A derivation that comes back empty or
 * swings wildly is a bad pull, and overwriting the committed templates with it
 * would take working decks away from every player at once.
 */
export function assertTemplatesSane(result: DeriveResult, previousCount: number): void {
  if (result.templates.length === 0) {
    throw new TemplateError("Derived no templates at all — refusing to overwrite decks.json.");
  }
  if (result.stats.joinRate < MIN_JOIN_RATE) {
    throw new TemplateError(
      `Only ${(result.stats.joinRate * 100).toFixed(1)}% of ${result.stats.namesSeen} card names resolved ` +
        `against the pool, under the ${(MIN_JOIN_RATE * 100).toFixed(0)}% guard. An unresolved name silently ` +
        `drops a core card from a template. Refusing to overwrite decks.json.`,
    );
  }
  if (previousCount === 0) return;
  const drift = Math.abs(result.templates.length - previousCount) / previousCount;
  if (drift > MAX_DRIFT) {
    throw new TemplateError(
      `Template count moved ${previousCount} → ${result.templates.length} ` +
        `(${(drift * 100).toFixed(1)}%), over the ${(MAX_DRIFT * 100).toFixed(0)}% guard. ` +
        `Refusing to overwrite decks.json.`,
    );
  }
}
