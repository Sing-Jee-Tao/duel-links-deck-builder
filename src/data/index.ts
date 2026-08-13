/**
 * Static data access. Nothing here touches a third party at runtime:
 * `data/banlist.json` and the templates are bundled, and `data/cards.json` is
 * emitted as a same-origin asset and fetched from the app's own URL.
 */
import banlistJson from "@data/banlist.json";
import cardsUrl from "@data/cards.json?url";
import { normalizeName } from "../engine/banlist-index.ts";
import type { Banlist, Card, CardFile, DeckTemplate } from "./types.ts";
import type { CardIndex } from "../engine/types.ts";

export const banlist = banlistJson as Banlist;

const templateModules = import.meta.glob<{ default: DeckTemplate }>("../../data/templates/*.json", {
  eager: true,
});

export const templates: DeckTemplate[] = Object.keys(templateModules)
  .sort()
  .map((key) => templateModules[key]!.default)
  .sort((a, b) => b.tierScore - a.tierScore || a.name.localeCompare(b.name));

export interface CardPool {
  cards: Card[];
  index: CardIndex;
  byId: ReadonlyMap<number, Card>;
  fetchedAt: string;
}

let poolPromise: Promise<CardPool> | null = null;

export function loadCardPool(): Promise<CardPool> {
  poolPromise ??= (async () => {
    const res = await fetch(cardsUrl);
    if (!res.ok) throw new Error(`Card pool failed to load (${res.status})`);
    const file = (await res.json()) as CardFile;
    return {
      cards: file.cards,
      index: new Map(file.cards.map((c) => [normalizeName(c.name), c])),
      byId: new Map(file.cards.map((c) => [c.id, c])),
      fetchedAt: file.fetchedAt,
    };
  })();
  return poolPromise;
}

/** Lets a failed load be retried from the error state's Retry button. */
export function resetCardPool(): void {
  poolPromise = null;
}

export { STALE_AFTER_DAYS } from "./staleness.ts";
import { ageInDays, isStale } from "./staleness.ts";

export function banlistAgeDays(now?: Date): number {
  return ageInDays(banlist.scrapedAt, now);
}

export function isBanlistStale(now?: Date): boolean {
  return isStale(banlist.scrapedAt, now);
}
