/**
 * Golden-file test. `scripts/__fixtures__/duellinksmeta-forbidden-limited.html`
 * is a saved copy of the *rendered* page (base64 image payloads stripped).
 *
 * If duellinksmeta redesigns, the parser breaks here in CI rather than in
 * production — which matters because the failure mode of a silently broken
 * parser is an empty banlist, and an empty banlist validates illegal decks as
 * legal. Refresh with `npm run scrape:banlist:snapshot`.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBanlistHtml, totalEntries } from "./lib/parse-banlist.ts";
import { mergeOverride } from "./lib/merge-override.ts";
import { assertSane, isPathAllowed, MAX_SHIFT, goldenFixturePath } from "./scrape-banlist.ts";
import { banlistPath, readJsonIfExists } from "./lib/paths.ts";
import type { Banlist } from "../src/data/types.ts";

const golden = fs.readFileSync(goldenFixturePath, "utf8");

describe("parseBanlistHtml against the golden page", () => {
  const parsed = parseBanlistHtml(golden);

  it("finds every tier, none empty", () => {
    expect(parsed.forbidden.length).toBeGreaterThan(0);
    expect(parsed.limited1.length).toBeGreaterThan(0);
    expect(parsed.limited2.length).toBeGreaterThan(0);
    expect(parsed.limited3.length).toBeGreaterThan(0);
  });

  it("agrees with the counts the page declares for itself", () => {
    expect(parsed.warnings).toEqual([]);
    expect(parsed.forbidden.length).toBe(parsed.declared.forbidden);
    expect(parsed.limited1.length).toBe(parsed.declared.limited1);
    expect(parsed.limited2.length).toBe(parsed.declared.limited2);
    expect(parsed.limited3.length).toBe(parsed.declared.limited3);
  });

  it("reads names, not URL escapes or markup", () => {
    for (const name of parsed.limited1) {
      expect(name).not.toMatch(/%[0-9A-F]{2}/i);
      expect(name).not.toMatch(/[<>]/);
      expect(name.trim()).toBe(name);
    }
  });

  it("puts a card in exactly one tier", () => {
    const seen = new Map<string, string>();
    for (const tier of ["forbidden", "limited1", "limited2", "limited3"] as const) {
      for (const name of parsed[tier]) {
        expect(seen.get(name), `${name} appears in two tiers`).toBeUndefined();
        seen.set(name, tier);
      }
    }
  });

  it("does not absorb the changes table above the first tier heading", () => {
    // Those links sit before <h3>Forbidden</h3>, so they belong to no tier.
    const total = totalEntries(parsed);
    const allLinks = golden.match(/href="\/cards\//g)?.length ?? 0;
    expect(total).toBeLessThan(allLinks);
  });

  it("matches the committed data/banlist.json", () => {
    const committed = readJsonIfExists<Banlist>(banlistPath);
    expect(committed).not.toBeNull();
    // The committed file is the merged (override-applied) result; with an empty
    // override it must equal the parse of the page it came from.
    const merged = mergeOverride(parsed, null).tiers;
    expect(committed!.forbidden).toEqual(merged.forbidden);
    expect(committed!.limited1).toEqual(merged.limited1);
  });
});

describe("parseBanlistHtml edge cases", () => {
  it("returns empty tiers rather than throwing on unrecognisable markup", () => {
    const parsed = parseBanlistHtml("<html><body><p>nothing here</p></body></html>");
    expect(totalEntries(parsed)).toBe(0);
    expect(parsed.warnings.length).toBe(4);
  });

  it("stops a tier at the next heading", () => {
    const html = `
      <h3>Limited 1</h3><div style="--numCards: 1;"><a href="/cards/Sphere%20Kuriboh"></a></div>
      <h3>Top Player Community</h3><a href="/cards/Not%20A%20Banned%20Card"></a>`;
    const parsed = parseBanlistHtml(html);
    expect(parsed.limited1).toEqual(["Sphere Kuriboh"]);
    expect(totalEntries(parsed)).toBe(1);
  });

  it("decodes HTML entities inside hrefs", () => {
    const html = `<h3>Forbidden</h3><div style="--numCards: 1;"><a href="/cards/Ojama%20Trio%20&amp;%20Friends"></a></div>`;
    expect(parseBanlistHtml(html).forbidden).toEqual(["Ojama Trio & Friends"]);
  });

  it("de-duplicates repeated links in a tier", () => {
    const html = `<h3>Forbidden</h3><div style="--numCards: 1;"><a href="/cards/Sangan"></a><a href="/cards/Sangan"></a></div>`;
    expect(parseBanlistHtml(html).forbidden).toEqual(["Sangan"]);
  });

  it("warns when the parsed count disagrees with the declared count", () => {
    const html = `<h3>Forbidden</h3><div style="--numCards: 9;"><a href="/cards/Sangan"></a></div>`;
    expect(parseBanlistHtml(html).warnings.join(" ")).toContain("declared 9 cards but 1 links parsed");
  });
});

describe("fail-safe guards", () => {
  const previous: Banlist = {
    scrapedAt: "2026-08-01T00:00:00.000Z",
    source: "scrape",
    forbidden: Array.from({ length: 30 }, (_, i) => `F${i}`),
    limited1: Array.from({ length: 30 }, (_, i) => `A${i}`),
    limited2: Array.from({ length: 20 }, (_, i) => `B${i}`),
    limited3: Array.from({ length: 20 }, (_, i) => `C${i}`),
  };

  it("refuses an empty tier", () => {
    expect(() => assertSane({ ...previous, limited2: [] }, previous)).toThrow(/limited2.*empty/i);
  });

  it("refuses a shift larger than the guard", () => {
    const halved = { ...previous, limited1: previous.limited1.slice(0, 3) };
    expect(() => assertSane(halved, previous)).toThrow(/Refusing to overwrite/);
  });

  it("accepts a small shift", () => {
    const nudged = { ...previous, limited3: [...previous.limited3, "C20", "C21"] };
    expect(() => assertSane(nudged, previous)).not.toThrow();
  });

  it("accepts any non-empty list when there is nothing committed yet", () => {
    expect(() => assertSane({ forbidden: ["a"], limited1: ["b"], limited2: ["c"], limited3: ["d"] }, null)).not.toThrow();
  });

  it("guards at 25%", () => {
    expect(MAX_SHIFT).toBe(0.25);
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /cdn-cgi/\n\nSitemap: https://example.com/sitemap.xml\n";

  it("allows the list page under the live robots.txt", () => {
    expect(isPathAllowed(robots, "/forbidden-limited-list")).toBe(true);
  });

  it("honours a Disallow that covers the path", () => {
    expect(isPathAllowed(robots, "/cdn-cgi/trace")).toBe(false);
    expect(isPathAllowed("User-agent: *\nDisallow: /", "/forbidden-limited-list")).toBe(false);
  });

  it("ignores rules aimed at other agents", () => {
    expect(isPathAllowed("User-agent: BadBot\nDisallow: /", "/forbidden-limited-list")).toBe(true);
  });

  it("lets a more specific Allow win", () => {
    const txt = "User-agent: *\nDisallow: /\nAllow: /forbidden-limited-list";
    expect(isPathAllowed(txt, "/forbidden-limited-list")).toBe(true);
  });
});

describe("banlist-override merge", () => {
  const scraped = {
    forbidden: ["Sangan"],
    limited1: ["Sphere Kuriboh"],
    limited2: ["Enemy Controller", "Book of Moon"],
    limited3: ["Cosmic Cyclone"],
  };

  it("is a no-op when there is no override", () => {
    const { tiers, applied } = mergeOverride(scraped, null);
    expect(applied).toBe(false);
    expect(tiers.limited2).toEqual(["Book of Moon", "Enemy Controller"]);
  });

  it("moves a card between tiers", () => {
    const { tiers, applied, changes } = mergeOverride(scraped, { limited1: ["Enemy Controller"] });
    expect(applied).toBe(true);
    expect(tiers.limited1).toEqual(["Enemy Controller", "Sphere Kuriboh"]);
    expect(tiers.limited2).toEqual(["Book of Moon"]);
    expect(changes[0]).toContain("limited2 → limited1");
  });

  it("removes a card from every tier when listed unlimited", () => {
    const { tiers } = mergeOverride(scraped, { unlimited: ["cosmic cyclone"] });
    expect(tiers.limited3).toEqual([]);
  });

  it("adds a newly forbidden card", () => {
    const { tiers } = mergeOverride(scraped, { forbidden: ["Book of Moon"] });
    expect(tiers.forbidden).toEqual(["Book of Moon", "Sangan"]);
    expect(tiers.limited2).toEqual(["Enemy Controller"]);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(scraped);
    mergeOverride(scraped, { forbidden: ["Book of Moon"] });
    expect(JSON.stringify(scraped)).toBe(before);
  });
});
