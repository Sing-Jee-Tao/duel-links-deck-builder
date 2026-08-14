/**
 * A deck under construction, keyed by normalized name so copies merge.
 *
 * This is the single place a card enters a deck. Every added copy is validated
 * and rolled back on a violation, which is what makes it impossible for any part
 * of the engine — templated build or template-free solver — to return a deck the
 * legality panel would reject.
 *
 * It lives in its own module because both `build.ts` and `synthesize.ts` need
 * it, and importing it from either would make the two depend on each other.
 */
import { BanlistIndex, normalizeName } from "./banlist-index.ts";
import { countCopies, validateDeck } from "./validator.ts";
import type { BuildConfig, CardIndex, Deck, DeckEntry } from "./types.ts";

export class DeckBuilder {
  private readonly main = new Map<string, DeckEntry>();
  private readonly extra = new Map<string, DeckEntry>();

  constructor(
    private readonly index: BanlistIndex,
    private readonly cards: CardIndex,
    private readonly config: BuildConfig,
  ) {}

  snapshot(): Deck {
    return {
      main: [...this.main.values()].map((e) => ({ ...e })),
      extra: [...this.extra.values()].map((e) => ({ ...e })),
    };
  }

  copiesOf(name: string): number {
    const key = normalizeName(name);
    return (this.main.get(key)?.copies ?? 0) + (this.extra.get(key)?.copies ?? 0);
  }

  mainCount(): number {
    return countCopies([...this.main.values()]);
  }

  extraCount(): number {
    return countCopies([...this.extra.values()]);
  }

  private target(name: string): Map<string, DeckEntry> {
    return this.cards.get(normalizeName(name))?.isExtraDeck ? this.extra : this.main;
  }

  /**
   * Adds `copies` of `name` only if the deck stays legal apart from being under
   * the minimum size — which is expected mid-build and fixed by padding later.
   * Returns how many copies were actually added.
   */
  tryAdd(name: string, copies: number): number {
    let added = 0;
    for (let i = 0; i < copies; i += 1) {
      if (!this.addOne(name)) break;
      added += 1;
    }
    return added;
  }

  private addOne(name: string): boolean {
    const key = normalizeName(name);
    const bucket = this.target(name);
    const existing = bucket.get(key);
    const before = existing?.copies ?? 0;
    bucket.set(key, { name: existing?.name ?? name, copies: before + 1 });

    const result = validateDeck(this.snapshot(), this.index, this.config);
    // Being short of the minimum is the normal mid-build state; anything else
    // means this copy is not legal and must be rolled back.
    const blocking = result.violations.filter(
      (v) => !(v.code === "main-deck-size" && result.mainCount < this.config.minMain),
    );
    if (blocking.length > 0) {
      if (before === 0) bucket.delete(key);
      else bucket.set(key, { name: existing?.name ?? name, copies: before });
      return false;
    }
    return true;
  }
}
