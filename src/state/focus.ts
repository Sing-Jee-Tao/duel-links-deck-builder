/**
 * Which deck a screen should show when the URL does not say.
 *
 * The nav items are one generic link reused by every screen, so they carry no
 * deck id. Following "Strategy" after reading about Blackwings therefore arrived
 * with nothing selected, and the screen fell straight through to the
 * highest-tier deck — silently swapping the player onto Branded. The fix is a
 * remembered choice, and this is the order it is consulted in.
 */
export interface Focusable {
  id: string;
}

export function resolveFocused<T extends Focusable>(
  candidates: readonly T[],
  /** The deck id in the URL — the most direct request there is. */
  selected: string | null,
  /** The last deck the player explicitly opened, from the store. */
  focusedDeckId: string | null,
  /**
   * Sensible last resorts, in order — for Strategy that is the deck being
   * built, then the strongest; for Upgrade, the top-ranked candidate.
   */
  ...fallbacks: (T | null | undefined)[]
): T | null {
  const byId = (id: string | null): T | undefined =>
    id === null ? undefined : candidates.find((candidate) => candidate.id === id);

  return byId(selected) ?? byId(focusedDeckId) ?? fallbacks.find((f): f is T => Boolean(f)) ?? null;
}
