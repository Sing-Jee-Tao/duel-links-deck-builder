/**
 * The import matcher, tested hardest on the case that would do real damage:
 * silently resolving a name to the wrong card.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copiesFor, matchCardList, parseCardList, summarize } from "./import.ts";
import { buildSearchIndex } from "./search.ts";
import { cardList } from "./fixtures.ts";
import type { Card, CardFile } from "../data/types.ts";

const entries = buildSearchIndex(cardList);

const match = (text: string) => matchCardList(parseCardList(text), entries);

describe("parseCardList", () => {
  it("reads a quantity written in front of the name", () => {
    expect(parseCardList("3x Core One")).toEqual([{ raw: "3x Core One", query: "Core One", copies: 3 }]);
    expect(parseCardList("2 Core One")[0]?.copies).toBe(2);
    expect(parseCardList("3 x Core One")[0]?.query).toBe("Core One");
    expect(parseCardList("1. Core One")[0]?.copies).toBe(1);
  });

  it("reads a quantity written after the name", () => {
    expect(parseCardList("Core One x3")[0]).toEqual({ raw: "Core One x3", query: "Core One", copies: 3 });
    expect(parseCardList("Core One ×2")[0]?.copies).toBe(2);
    expect(parseCardList("Core One (2)")[0]?.copies).toBe(2);
    expect(parseCardList("Core One [1]")[0]?.copies).toBe(1);
  });

  it("leaves copies null when the line is only a name", () => {
    expect(parseCardList("Core One")).toEqual([{ raw: "Core One", query: "Core One", copies: null }]);
  });

  it("caps a quantity at the three-copy deck limit", () => {
    expect(parseCardList("9x Core One")[0]?.copies).toBe(3);
  });

  it("skips blank lines and comments", () => {
    expect(parseCardList("\n\n  \n")).toEqual([]);
    expect(parseCardList("# a note\n// another\nCore One")).toHaveLength(1);
  });

  it("degrades a pasted .ydk into nothing rather than nonsense", () => {
    // Section markers must not be matched against the pool as if they were names.
    const ydk = "#created by ...\n#main\n89631139\n89631139\n!side\n";
    const names = parseCardList(ydk).map((l) => l.query);
    expect(names).toEqual(["89631139", "89631139"]);
    // And those bare passcodes resolve to nothing, rather than to a wrong card.
    expect(matchCardList(parseCardList(ydk), entries).every((m) => m.kind === "unmatched")).toBe(true);
  });

  it("keeps a trailing number that is part of the name", () => {
    // "3" here is the quantity; the name itself is what is left.
    expect(parseCardList("3 Filler A")[0]?.query).toBe("Filler A");
  });
});

describe("matchCardList", () => {
  it("resolves an exact name with no ambiguity", () => {
    const [result] = match("Core One");
    expect(result?.kind).toBe("exact");
    expect(result?.card?.name).toBe("Core One");
  });

  it("matches regardless of case and surrounding whitespace", () => {
    expect(match("   cOrE oNe   ")[0]?.kind).toBe("exact");
  });

  it("reports a name it cannot find at all", () => {
    const [result] = match("Definitely Not A Card");
    expect(result?.kind).toBe("unmatched");
    expect(result?.card).toBeUndefined();
  });

  it("never resolves a partial name on its own", () => {
    // "Core" is a prefix of three real cards. Picking one would be a guess.
    const [result] = match("Core");
    expect(result?.kind).toBe("uncertain");
    expect(result?.options?.length).toBeGreaterThan(1);
    expect(result?.card).toBeUndefined();
  });

  it("does not offer a card that only matches on effect text", () => {
    // Every fixture card's desc ends "test card." — a name hit is required, so
    // this must find nothing rather than returning the whole pool.
    const [result] = match("test card");
    expect(result?.kind).toBe("unmatched");
  });

  it("counts each kind for the summary line", () => {
    expect(summarize(match("Core One\nCore\nNot A Card"))).toEqual({ exact: 1, uncertain: 1, unmatched: 1 });
  });
});

describe("copiesFor", () => {
  it("uses the line's own quantity when it has one", () => {
    expect(copiesFor({ raw: "", query: "", copies: 2 }, 1)).toBe(2);
  });

  it("falls back to the bare-line default otherwise", () => {
    expect(copiesFor({ raw: "", query: "", copies: null }, 3)).toBe(3);
    expect(copiesFor({ raw: "", query: "", copies: null }, 1)).toBe(1);
  });

  it("never exceeds three copies", () => {
    expect(copiesFor({ raw: "", query: "", copies: null }, 9)).toBe(3);
  });
});

/**
 * The prefix-collision case, against the real pool. This is the regression that
 * matters: 143 pool names are a word-prefix of another card's name, and quietly
 * resolving one to the other hands the player a deck they cannot field.
 */
describe("against the real pool", () => {
  const dataDir = fileURLToPath(new URL("../../data", import.meta.url));
  const cardFile = JSON.parse(fs.readFileSync(path.join(dataDir, "cards.json"), "utf8")) as CardFile;
  const realEntries = buildSearchIndex(cardFile.cards);
  const realMatch = (text: string) => matchCardList(parseCardList(text), realEntries);

  const named = (name: string): Card | undefined => cardFile.cards.find((c) => c.name === name);

  it("has the collision this test depends on", () => {
    expect(named("Alligator's Sword")).toBeDefined();
    expect(named("Alligator's Sword Dragon")).toBeDefined();
  });

  it("does not silently resolve a name that is a prefix of another card", () => {
    const [result] = realMatch("Alligator's Sword");
    // Exact equality wins outright — the shorter name IS a real card.
    expect(result?.kind).toBe("exact");
    expect(result?.card?.name).toBe("Alligator's Sword");
  });

  it("offers both when the typed name is a prefix of several and exact of none", () => {
    const [result] = realMatch("Alligator's Sword Dra");
    expect(result?.kind).toBe("uncertain");
    expect(result?.options?.map((c) => c.name)).toContain("Alligator's Sword Dragon");
    expect(result?.card).toBeUndefined();
  });

  it("matches a name pasted with a curly apostrophe", () => {
    // The pool stores ASCII apostrophes, but duellinksmeta and most word
    // processors render them curly — so this is what a real paste looks like,
    // and an unfolded comparison would silently fail to find the card.
    const ascii = cardFile.cards.find((c) => c.name.includes("'"));
    expect(ascii, "pool should contain an apostrophe name").toBeDefined();
    if (!ascii) return;
    const [result] = realMatch(ascii.name.replace(/'/g, "’"));
    expect(result?.kind).toBe("exact");
    expect(result?.card?.name).toBe(ascii.name);
  });

  it("matches a name pasted with an en dash where the pool has a hyphen", () => {
    const hyphen = cardFile.cards.find((c) => / - /.test(c.name));
    expect(hyphen, "pool should contain a hyphenated name").toBeDefined();
    if (!hyphen) return;
    const [result] = realMatch(hyphen.name.replace(/ - /g, " – "));
    expect(result?.kind).toBe("exact");
    expect(result?.card?.name).toBe(hyphen.name);
  });

  it("reads a realistic pasted decklist end to end", () => {
    const results = realMatch(
      ["# my traptrix list", "3x Traptrix Pudica", "Traptrix Myrmeleo x3", "2 Nibiru, the Primal Being", "Forbidden Droplet"].join(
        "\n",
      ),
    );
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.kind === "exact")).toBe(true);
    expect(results.map((r) => r.line.copies)).toEqual([3, 3, 2, null]);
  });
});
