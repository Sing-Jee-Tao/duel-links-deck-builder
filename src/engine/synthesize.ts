/**
 * The template-free solver: a deck out of a collection that matches no template.
 *
 * WHAT THIS IS NOT: a rules engine. `data/cards.json` carries effect text only
 * as unstructured prose — no triggers, costs or timings — so nothing here
 * "reads" a card and reasons about it. Claiming otherwise would be a lie the
 * output could not support.
 *
 * WHAT IT IS: deckbuilding knowledge learned from what people actually play.
 * `data/synergy.json` counts, across a few thousand real tournament lists, how
 * often each card appears and which cards appear alongside it. Two cards that
 * keep turning up in the same list belong together, whatever their text says.
 * That gives three usable signals, in falling order of reliability:
 *
 *   1. co-occurrence — the partners a card is actually played with
 *   2. archetype — the `archetype` field, plus cards naming it in their text
 *   3. play rate and deck-type spread — a card in 70 different deck types is a
 *      generic staple and fits any deck
 *
 * Cards the corpus has never seen fall back to card kind and ATK, which is the
 * same crude heuristic `pad` uses and is treated as the last resort it is.
 *
 * Assembly runs through `DeckBuilder`, so every copy is validated and rolled
 * back on a violation exactly as a templated build is.
 */
import type { Card } from "../data/types.ts";
import { BanlistIndex, normalizeName } from "./banlist-index.ts";
import { DeckBuilder } from "./deck-builder.ts";
import { countCopies, validateDeck } from "./validator.ts";
import type {
  BuildConfig,
  BuildResult,
  CardIndex,
  OwnedCounts,
  SynergyIndex,
  TemplateScore,
} from "./types.ts";

export interface SynthesizeInputs {
  owned: OwnedCounts;
  cards: CardIndex;
  synergy: SynergyIndex;
  index: BanlistIndex;
  config: BuildConfig;
  /** Passed straight through to the result, for the upgrade screen. */
  candidates?: TemplateScore[];
}

/** What one owned card brings, before anything is in the deck. */
interface Owned {
  card: Card;
  copies: number;
  /** Lists in the corpus containing it. */
  play: number;
  /** Distinct deck types running it — the staple signal. */
  spread: number;
  partners: ReadonlyMap<number, number>;
}

const EMPTY_PARTNERS: ReadonlyMap<number, number> = new Map();

function ownedCards(inputs: SynthesizeInputs): Owned[] {
  const list: Owned[] = [];
  for (const [key, copies] of inputs.owned) {
    if (copies <= 0) continue;
    const card = inputs.cards.get(key);
    if (!card) continue;
    if (inputs.index.isForbidden(card.name)) continue;
    const entry = inputs.synergy.get(card.id);
    list.push({
      card,
      copies,
      play: entry?.play ?? 0,
      spread: entry?.spread ?? 0,
      partners: entry ? new Map(entry.partners) : EMPTY_PARTNERS,
    });
  }
  // Fixed order in, fixed deck out: every later sort is stable on top of this.
  return list.sort((a, b) => a.card.name.localeCompare(b.card.name, "en"));
}

/**
 * Which archetype a card belongs to for clustering purposes.
 *
 * The `archetype` field covers 57% of the pool. The rest are matched by name,
 * which catches the support cards that name their archetype without carrying
 * the tag.
 */
export function archetypesOf(card: Card, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  if (card.archetype) found.add(card.archetype);
  for (const name of known) {
    if (found.has(name)) continue;
    if (card.name.includes(name)) found.add(name);
  }
  return [...found];
}

export interface Cluster {
  archetype: string;
  members: Owned[];
  /** How much of a real deck this cluster could actually be. */
  strength: number;
}

/**
 * How much a card says about which deck it is in.
 *
 * Play rate alone is the wrong signal for seeding: Forbidden Droplet is the most
 * played card in the game and appears in 72 different deck types, so scoring by
 * play rate alone let the staples named "Forbidden …" out-score a real archetype
 * and the solver seeded a deck around a name collision. Dividing by deck-type
 * spread asks the right question — a card in one deck type defines it, a card in
 * seventy defines nothing.
 */
function focus(owned: Owned): number {
  return owned.play / Math.max(1, owned.spread);
}

/**
 * The strongest archetype the collection can field.
 *
 * Strength is copies × focus summed over the cluster: a player owning three
 * copies each of eight cards that define one deck type is holding a deck, while
 * one copy each of twenty unrelated archetype cards is holding a binder.
 */
export function strongestCluster(list: Owned[]): Cluster | null {
  const known = new Set<string>();
  for (const owned of list) if (owned.card.archetype) known.add(owned.card.archetype);

  const byArchetype = new Map<string, Owned[]>();
  for (const owned of list) {
    for (const archetype of archetypesOf(owned.card, known)) {
      byArchetype.set(archetype, [...(byArchetype.get(archetype) ?? []), owned]);
    }
  }

  const clusters: Cluster[] = [...byArchetype].map(([archetype, members]) => ({
    archetype,
    members,
    strength: members.reduce((sum, m) => sum + m.copies * (focus(m) + 1), 0),
  }));

  clusters.sort(
    (a, b) => b.strength - a.strength || b.members.length - a.members.length || a.archetype.localeCompare(b.archetype, "en"),
  );
  return clusters[0] ?? null;
}

/** How strongly a card pulls toward what is already in the deck. */
function affinity(owned: Owned, inDeck: readonly Owned[]): number {
  let total = 0;
  for (const member of inDeck) {
    total += owned.partners.get(member.card.id) ?? 0;
    // Co-occurrence is symmetric in the corpus but stored top-K per card, so a
    // strong partner can be missing from one side's list. Read both.
    total += member.partners.get(owned.card.id) ?? 0;
  }
  return total;
}

/**
 * The last-resort ordering for cards the corpus has never seen: spells and
 * traps do more than a small vanilla body, then raw ATK. Mirrors `pad`.
 */
function fallbackScore(card: Card): number {
  return card.atk ?? 2000;
}

/**
 * Synergy density: the share of card pairs in the deck that real lists actually
 * play together. A coherent archetype deck scores high because its cards keep
 * appearing in each other's partner lists; a pile of unrelated staples does not.
 *
 * This is a different measurement from a template's `tierScore × completion`,
 * on the same 0–100 axis, and the Build screen says so.
 */
export function synergyDensity(members: readonly Owned[]): number {
  if (members.length < 2) return 0;
  let linked = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i] as Owned;
      const b = members[j] as Owned;
      pairs += 1;
      if (a.partners.has(b.card.id) || b.partners.has(a.card.id)) linked += 1;
    }
  }
  return pairs === 0 ? 0 : linked / pairs;
}

export function synthesizeDeck(inputs: SynthesizeInputs): BuildResult {
  const { config, index, cards } = inputs;
  const list = ownedCards(inputs);
  const builder = new DeckBuilder(index, cards, config);
  const chosen: Owned[] = [];

  const take = (owned: Owned, limit: number): boolean => {
    const room = Math.min(owned.copies, limit) - builder.copiesOf(owned.card.name);
    if (room <= 0) return false;
    const added = builder.tryAdd(owned.card.name, room);
    if (added > 0 && !chosen.includes(owned)) chosen.push(owned);
    return added > 0;
  };

  // 1. Extra Deck first: it draws on the same pooled Limited budgets as the main
  //    deck, so committing it later would let a main-deck card spend the slot.
  const extras = list
    .filter((owned) => owned.card.isExtraDeck)
    .sort((a, b) => b.play - a.play || b.spread - a.spread || a.card.name.localeCompare(b.card.name, "en"));
  for (const owned of extras) {
    if (countCopies(builder.snapshot().extra) >= config.extraDeckSize) break;
    take(owned, 1);
  }

  const main = list.filter((owned) => !owned.card.isExtraDeck);

  // 2. Seed with the archetype the collection is deepest in. This is the deck's
  //    spine — without it the greedy growth below has nothing to grow from and
  //    just collects staples.
  const cluster = strongestCluster(main);
  const spine = (cluster?.members ?? [])
    .filter((owned) => !owned.card.isExtraDeck)
    .sort((a, b) => focus(b) - focus(a) || b.copies - a.copies || a.card.name.localeCompare(b.card.name, "en"));
  for (const owned of spine) {
    if (builder.mainCount() >= config.maxMain) break;
    take(owned, config.maxCopies);
  }

  // 3. Grow by co-occurrence: repeatedly add whichever owned card the corpus
  //    most often plays alongside what is already here.
  const remaining = () => main.filter((owned) => builder.copiesOf(owned.card.name) === 0);
  while (builder.mainCount() < config.minMain) {
    const pool = remaining();
    if (pool.length === 0) break;
    const scored = pool
      .map((owned) => ({ owned, score: affinity(owned, chosen) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.owned.spread - a.owned.spread ||
          b.owned.play - a.owned.play ||
          fallbackScore(b.owned.card) - fallbackScore(a.owned.card) ||
          a.owned.card.name.localeCompare(b.owned.card.name, "en"),
      );
    const next = scored[0];
    // Nothing legal left to add — the loop must not spin on a full allowance.
    if (!next || !take(next.owned, config.maxCopies)) {
      if (next) {
        // Mark it consumed so the next pass does not pick it again.
        const at = main.indexOf(next.owned);
        if (at >= 0) main.splice(at, 1);
        continue;
      }
      break;
    }
  }

  const deck = builder.snapshot();
  const validation = validateDeck(deck, index, config);
  const mainCount = countCopies(deck.main);
  const partial = mainCount < config.minMain;
  const density = synergyDensity(chosen.filter((owned) => !owned.card.isExtraDeck));

  let reason: string | undefined;
  if (mainCount === 0) {
    reason = "Nothing to build with yet — no owned cards can legally start a deck.";
  } else if (partial) {
    reason =
      `Could not legally reach ${config.minMain} cards — ${config.minMain - mainCount} short. ` +
      `Every remaining owned card is Forbidden, already at 3 copies, or blocked by a spent Limited allowance.`;
  }

  return {
    template: null,
    deck,
    mainCount,
    powerScore: Math.round(density * 100 * 10) / 10,
    validation,
    partial,
    ...(reason ? { reason } : {}),
    candidates: inputs.candidates ?? [],
    ...(cluster && mainCount > 0 ? { archetype: cluster.archetype } : {}),
  };
}

/** The name the Build screen shows for a synthesized deck. */
export function synthesizedName(result: BuildResult): string {
  return result.archetype ? `${result.archetype} — from your collection` : "Best from your collection";
}

/** Re-export so the normalized lookup is available to callers of this module. */
export { normalizeName };
