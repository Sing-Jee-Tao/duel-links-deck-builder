/**
 * The bug this suite exists for: searching "Black Whirlwind" returned only
 * "Black Whirlwind" and never "Black Feather Whirlwind", because the whole query
 * had to appear as one contiguous run of characters. A near-miss query looked
 * exactly like a missing card.
 */
import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  foldForSearch,
  NAME_MATCH_FLOOR,
  rankCards,
  searchIndex,
  tokenize,
} from "./search.ts";
import type { Card } from "../data/types.ts";

function card(name: string, over: Partial<Card> = {}): Card {
  return { id: name.length + name.charCodeAt(0), name, type: "Spell Card", race: "Continuous", desc: "", isExtraDeck: false, ...over };
}

const blackWhirlwind = card("Black Whirlwind", {
  archetype: "Blackwing",
  desc: 'When a "Blackwing" monster is Normal Summoned to your field: You can add 1 "Blackwing" monster.',
});
const blackFeatherWhirlwind = card("Black Feather Whirlwind", {
  desc: "Once per turn, if you Special Summon a DARK Synchro Monster from the Extra Deck.",
});
const simoon = card("Blackwing - Simoon the Poison Wind", {
  archetype: "Blackwing",
  desc: 'You can place 1 "Black Whirlwind" from your Deck face-up in your Spell & Trap Zone.',
});
const yosen = card("Yosen Whirlwind", { archetype: "Yosenju" });
const unrelated = card("Dark Magician", { desc: "The ultimate wizard in terms of attack and defense." });

const pool = [blackWhirlwind, blackFeatherWhirlwind, simoon, yosen, unrelated];
const index = buildSearchIndex(pool);
const names = (query: string) => searchIndex(index, query).map((c) => c.name);

describe("foldForSearch", () => {
  it("folds case, accents and the typography an ASCII keyboard cannot reach", () => {
    expect(foldForSearch("Chirubimé")).toBe("chirubime");
    expect(foldForSearch("Barbaros Ür")).toBe("barbaros ur");
    expect(foldForSearch("Battlin’ Boxing")).toBe("battlin' boxing");
    expect(foldForSearch("Vaylantz – Master")).toBe("vaylantz - master");
  });

  it("collapses padding and repeated spaces", () => {
    expect(foldForSearch("  Black   WHIRLWIND ")).toBe("black whirlwind");
    expect(tokenize("  Black   Feather Whirlwind ")).toEqual(["black", "feather", "whirlwind"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("searchIndex", () => {
  it("finds cards whose name merely contains the words, not the whole phrase", () => {
    // The reported bug, in one assertion.
    const found = names("Black Whirlwind");
    expect(found).toContain("Black Feather Whirlwind");
    expect(found[0]).toBe("Black Whirlwind");
  });

  it("ranks an exact name above a looser name match above an effect-text mention", () => {
    expect(names("black whirlwind")).toEqual([
      "Black Whirlwind", // exact
      "Black Feather Whirlwind", // both words, in order
      "Blackwing - Simoon the Poison Wind", // only quotes it in its effect text
    ]);
  });

  it("does not care about word order", () => {
    expect(names("whirlwind black")).toContain("Black Feather Whirlwind");
    expect(names("feather whirlwind black")).toContain("Black Feather Whirlwind");
  });

  it("requires every word — a query is a conjunction, not a suggestion", () => {
    expect(names("black whirlwind unicorn")).toEqual([]);
    expect(names("magician")).toEqual(["Dark Magician"]);
  });

  it("matches on archetype", () => {
    expect(names("yosenju")).toEqual(["Yosen Whirlwind"]);
  });

  it("returns the whole pool, in pool order, for an empty query", () => {
    expect(names("")).toEqual(pool.map((c) => c.name));
    expect(names("   ")).toEqual(pool.map((c) => c.name));
  });

  it("puts a prefix match ahead of a mid-name match", () => {
    const ordered = names("whirlwind");
    expect(ordered.indexOf("Yosen Whirlwind")).toBeLessThan(ordered.indexOf("Blackwing - Simoon the Poison Wind"));
  });

  it("is stable — equal-scoring cards come back alphabetically", () => {
    expect(names("blackwing")).toEqual(names("blackwing"));
  });

  it("reaches accented names from an ASCII query", () => {
    const accented = buildSearchIndex([card("Chirubimé, Princess of Autumn Leaves")]);
    expect(searchIndex(accented, "chirubime")).toHaveLength(1);
    expect(searchIndex(accented, "chirubimé")).toHaveLength(1);
  });
});

describe("NAME_MATCH_FLOOR", () => {
  it("separates name matches from effect-text-only matches", () => {
    const ranked = rankCards(index, "black whirlwind");
    const byName = ranked.filter((r) => r.score >= NAME_MATCH_FLOOR).map((r) => r.card.name);

    expect(byName).toEqual(["Black Whirlwind", "Black Feather Whirlwind"]);
    // Simoon only quotes the card in its rules text, so the type-ahead skips it.
    expect(ranked.some((r) => r.card === simoon && r.score < NAME_MATCH_FLOOR)).toBe(true);
  });
});
