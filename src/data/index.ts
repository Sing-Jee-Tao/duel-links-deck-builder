/**
 * Static data access. Nothing here touches a third party at runtime:
 * `data/banlist.json` and the four hand-authored templates are bundled, and the
 * three large files — the card pool, the derived templates and the synergy
 * statistics — are emitted as same-origin assets and fetched from the app's own
 * URL.
 */
import banlistJson from "@data/banlist.json";
import cardsUrl from "@data/cards.json?url";
import decksUrl from "@data/decks.json?url";
import synergyUrl from "@data/synergy.json?url";
import { normalizeName } from "../engine/banlist-index.ts";
import type {
  Banlist,
  Card,
  CardFile,
  DeckFile,
  DeckTemplate,
  SynergyCard,
  SynergyFile,
} from "./types.ts";
import type { CardIndex, SynergyIndex } from "../engine/types.ts";

export const banlist = banlistJson as Banlist;

const templateModules = import.meta.glob<{ default: DeckTemplate }>("../../data/templates/*.json", {
  eager: true,
});

/**
 * The hand-authored templates, bundled because they are small and because they
 * are the only ones that carry strategy prose. Derived templates arrive with
 * `loadAppData`.
 */
export const authoredTemplates: DeckTemplate[] = Object.keys(templateModules)
  .sort()
  .map((key) => templateModules[key]!.default)
  .sort((a, b) => b.tierScore - a.tierScore || a.name.localeCompare(b.name));

export interface CardPool {
  cards: Card[];
  index: CardIndex;
  byId: ReadonlyMap<number, Card>;
  fetchedAt: string;
}

export type { SynergyIndex };

export interface AppData {
  pool: CardPool;
  /** Authored and derived together, ranked. */
  templates: DeckTemplate[];
  synergy: SynergyIndex;
  /** When the tournament corpus behind the derived templates was last pulled. */
  decksFetchedAt: string;
  /** Lists the derived templates and the synergy statistics were measured over. */
  corpusDeckCount: number;
}

let dataPromise: Promise<AppData> | null = null;

async function getJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} failed to load (${res.status})`);
  return (await res.json()) as T;
}

export function loadAppData(): Promise<AppData> {
  dataPromise ??= (async () => {
    const [cardFile, deckFile, synergyFile] = await Promise.all([
      getJson<CardFile>(cardsUrl, "Card pool"),
      getJson<DeckFile>(decksUrl, "Deck templates"),
      getJson<SynergyFile>(synergyUrl, "Synergy data"),
    ]);

    const pool: CardPool = {
      cards: cardFile.cards,
      index: new Map(cardFile.cards.map((c) => [normalizeName(c.name), c])),
      byId: new Map(cardFile.cards.map((c) => [c.id, c])),
      fetchedAt: cardFile.fetchedAt,
    };

    const synergy = new Map<number, SynergyCard>(
      Object.entries(synergyFile.cards).map(([id, entry]) => [Number(id), entry]),
    );

    return {
      pool,
      templates: rankTemplateList([...authoredTemplates, ...deckFile.templates]),
      synergy,
      decksFetchedAt: deckFile.fetchedAt,
      corpusDeckCount: synergyFile.deckCount,
    };
  })();
  return dataPromise;
}

/** Highest tier first, then alphabetical — the order every screen lists them in. */
export function rankTemplateList(list: DeckTemplate[]): DeckTemplate[] {
  return [...list].sort((a, b) => b.tierScore - a.tierScore || a.name.localeCompare(b.name));
}

/** Lets a failed load be retried from the error state's Retry button. */
export function resetAppData(): void {
  dataPromise = null;
}

export { STALE_AFTER_DAYS } from "./staleness.ts";
import { ageInDays, isStale } from "./staleness.ts";

export function banlistAgeDays(now?: Date): number {
  return ageInDays(banlist.scrapedAt, now);
}

export function isBanlistStale(now?: Date): boolean {
  return isStale(banlist.scrapedAt, now);
}
