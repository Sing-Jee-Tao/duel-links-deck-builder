/**
 * Banlist freshness. Kept separate from `data/index.ts` so it is testable
 * without pulling in the bundled JSON.
 *
 * `stale` is a UI-visible condition, not a silent failure: a deck checked
 * against a two-week-old list may be illegal in ranked play, and the tool has to
 * say so rather than quietly reporting "Legal".
 */

/** A list older than this renders the stale-refresh warning. */
export const STALE_AFTER_DAYS = 14;

const MS_PER_DAY = 86_400_000;

export function ageInDays(scrapedAt: string, now: Date = new Date()): number {
  const scraped = new Date(scrapedAt).getTime();
  // An unparseable timestamp is treated as infinitely old: the warning showing
  // when it should not is recoverable, the reverse is not.
  if (Number.isNaN(scraped)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - scraped) / MS_PER_DAY;
}

export function isStale(scrapedAt: string, now?: Date): boolean {
  return ageInDays(scrapedAt, now) > STALE_AFTER_DAYS;
}
