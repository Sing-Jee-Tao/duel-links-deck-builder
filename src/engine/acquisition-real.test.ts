/**
 * The cost engine against the real committed data.
 *
 * Two jobs. The first is coverage: every template must be priceable out of the
 * shipped pool, so a box table that stops joining shows up here rather than as a
 * confident zero on someone's screen.
 *
 * The second is calibration, and it is deliberately a BAND rather than a target.
 * duellinksmeta publishes a gem price per list and this prices the same list, but
 * the two are not the same quantity and are not supposed to agree:
 *
 *   - this excludes cards obtainable for free, which the published figure counts
 *   - this is an EXPECTED pack count; the published one prices nearer a full box
 *   - this consolidates cards that share a box, so those packs are paid once
 *
 * All three push the same way, so the honest expectation is that this lands
 * BELOW the published price and tracks it. What the band exists to catch is the
 * model breaking — a units error, a lost join, a box that stops dividing — not
 * a disagreement with duellinksmeta, which is the point of the feature.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { costOf, indexBoxes } from "./acquisition.ts";
import { normalizeName } from "./banlist-index.ts";
import type { CardIndex, DeckEntry } from "./types.ts";
import type { CardFile, DeckFile, DeckTemplate, SetFile } from "../data/types.ts";

const dataDir = fileURLToPath(new URL("../../data", import.meta.url));
const readJson = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

const cardFile = readJson<CardFile>(path.join(dataDir, "cards.json"));
const setFile = readJson<SetFile>(path.join(dataDir, "sets.json"));
const templates = readJson<DeckFile>(path.join(dataDir, "decks.json")).templates;

const cards: CardIndex = new Map(cardFile.cards.map((c) => [normalizeName(c.name), c]));
const boxes = indexBoxes(setFile.sets);

/** The whole list, as a player who owns nothing would have to buy it. */
function wholeList(template: DeckTemplate): DeckEntry[] {
  const entries: DeckEntry[] = [...template.coreCards, ...template.extraDeck];
  for (const slot of template.flexSlots) {
    for (const name of slot.candidates.slice(0, slot.count)) entries.push({ name, copies: 1 });
  }
  return entries;
}

const priced = templates.map((template) => ({
  template,
  cost: costOf(wholeList(template), cards, boxes),
}));

describe("the shipped box table", () => {
  it("has boxes, and most of them are priceable", () => {
    expect(setFile.sets.length).toBeGreaterThan(50);
    const packed = setFile.sets.filter((s) => s.type === "Main Box" || s.type === "Mini Box");
    const priceable = packed.filter((s) => s.packs !== undefined);
    expect(priceable.length / packed.length).toBeGreaterThan(0.9);
  });

  it("sizes a Main Box as 200 packs, which is what the game charges 10,000 gems for", () => {
    const main = setFile.sets.filter((s) => s.type === "Main Box" && s.packs !== undefined);
    // Boxes come in a few sizes, but the standard one has to be exactly right —
    // it is the anchor for every gem figure the app shows.
    expect(main.some((s) => s.packs === 200)).toBe(true);
    for (const box of main) expect(box.packs).toBeGreaterThan(50);
  });

  it("never marks a box priceable without a pile to draw from", () => {
    for (const box of setFile.sets) {
      if (box.packs !== undefined) expect(box.copies).toBeGreaterThan(0);
    }
  });
});

describe("pricing every shipped template", () => {
  it("finds a route for nearly every card in every list", () => {
    // An unknown card is one the pool has no acquisition data for at all. A few
    // are expected; a lot means the join broke.
    const unknown = priced.reduce((sum, p) => sum + p.cost.unknown.length, 0);
    const total = priced.reduce((sum, p) => sum + wholeList(p.template).length, 0);
    expect(unknown / total).toBeLessThan(0.05);
  });

  it("prices every template above zero", () => {
    for (const { template, cost } of priced) {
      expect(cost.gems, `${template.name} priced at nothing`).toBeGreaterThan(0);
    }
  });

  it("finds free routes, which is the thing the published price cannot", () => {
    // If this ever goes to zero the free-route data has stopped arriving, and
    // the app is back to sending players to a box for cards they can just earn.
    const free = priced.reduce((sum, p) => sum + p.cost.free.length, 0);
    expect(free).toBeGreaterThan(templates.length);
  });

  it("keeps every gem figure a whole number of packs", () => {
    for (const { cost } of priced) expect(cost.gems % 50).toBe(0);
  });

  it("never charges more than draining every box it opens", () => {
    for (const { template, cost } of priced) {
      for (const plan of cost.boxes) {
        expect(plan.packs, `${template.name} · ${plan.box}`).toBeLessThanOrEqual(plan.boxPacks);
        expect(plan.medianPacks).toBeLessThanOrEqual(plan.p90Packs);
      }
    }
  });
});

describe("calibration against duellinksmeta's published price", () => {
  const ratios = priced
    .filter((p) => (p.template.meta?.gemsPrice ?? 0) > 0)
    .map((p) => ({ name: p.template.name, ratio: p.cost.gems / (p.template.meta.gemsPrice as number) }));

  it("has a published price to compare against for most templates", () => {
    expect(ratios.length / templates.length).toBeGreaterThan(0.9);
  });

  it("lands in the same order of magnitude for every single template", () => {
    // Wide on purpose. This is a units-and-joins alarm, not an agreement test.
    for (const { name, ratio } of ratios) {
      expect(ratio, `${name} priced at ${ratio.toFixed(2)}× the published figure`).toBeGreaterThan(0.2);
      expect(ratio, `${name} priced at ${ratio.toFixed(2)}× the published figure`).toBeLessThan(2);
    }
  });

  it("sits below the published price on the median, for the three stated reasons", () => {
    const sorted = ratios.map((r) => r.ratio).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    expect(median).toBeGreaterThan(0.4);
    expect(median).toBeLessThan(1.1);
  });
});
