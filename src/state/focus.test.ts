/**
 * Regression cover for the bug this exists to fix: clicking the Strategy nav
 * item after reading a guide silently swapped the player onto Branded, because
 * the nav carries no deck id and the screen fell straight through to the
 * highest-tier deck.
 */
import { describe, expect, it } from "vitest";
import { resolveFocused } from "./focus.ts";

const decks = [{ id: "meta-branded" }, { id: "meta-blackwings" }, { id: "meta-traptrix" }];
const [branded, blackwings, traptrix] = decks;

describe("resolveFocused", () => {
  it("prefers the deck id in the URL above everything", () => {
    expect(resolveFocused(decks, "meta-blackwings", "meta-traptrix", branded)).toBe(blackwings);
  });

  it("falls back to the remembered deck when the nav drops the id", () => {
    // The reported bug: this used to return `branded`, the first fallback.
    expect(resolveFocused(decks, null, "meta-blackwings", branded)).toBe(blackwings);
  });

  it("uses the first fallback only when nothing was chosen", () => {
    expect(resolveFocused(decks, null, null, traptrix, branded)).toBe(traptrix);
  });

  it("skips fallbacks that are absent", () => {
    expect(resolveFocused(decks, null, null, null, undefined, branded)).toBe(branded);
  });

  it("ignores a remembered deck that no longer exists", () => {
    // Templates are regenerated weekly; an archetype can leave the meta.
    expect(resolveFocused(decks, null, "meta-retired", branded)).toBe(branded);
  });

  it("ignores a URL id that no longer exists", () => {
    expect(resolveFocused(decks, "meta-retired", "meta-traptrix", branded)).toBe(traptrix);
  });

  it("returns null when there is nothing to show at all", () => {
    expect(resolveFocused([], null, null)).toBeNull();
    expect(resolveFocused(decks, null, null)).toBeNull();
  });

  it("carries the payload through, so callers can attach their own object", () => {
    const rows = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
    expect(resolveFocused(rows, null, "b")?.label).toBe("Beta");
  });
});
