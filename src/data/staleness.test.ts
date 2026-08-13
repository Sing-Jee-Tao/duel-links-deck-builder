import { describe, expect, it } from "vitest";
import { ageInDays, isStale, STALE_AFTER_DAYS } from "./staleness.ts";

const now = new Date("2026-08-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("banlist staleness", () => {
  it("measures age in days", () => {
    expect(ageInDays(daysAgo(3), now)).toBeCloseTo(3);
    expect(ageInDays(now.toISOString(), now)).toBe(0);
  });

  it("is fresh inside the window", () => {
    expect(isStale(daysAgo(0), now)).toBe(false);
    expect(isStale(daysAgo(STALE_AFTER_DAYS - 1), now)).toBe(false);
    expect(isStale(daysAgo(STALE_AFTER_DAYS), now)).toBe(false);
  });

  it("goes stale past the window", () => {
    expect(isStale(daysAgo(STALE_AFTER_DAYS + 1), now)).toBe(true);
    expect(isStale(daysAgo(90), now)).toBe(true);
  });

  it("treats an unreadable timestamp as stale rather than fresh", () => {
    // Showing the warning when it is not needed is recoverable; hiding it when
    // it is needed means validating decks against a list nobody has checked.
    expect(ageInDays("not a date", now)).toBe(Number.POSITIVE_INFINITY);
    expect(isStale("", now)).toBe(true);
  });

  it("does not go stale from a clock skew into the future", () => {
    expect(isStale(new Date(now.getTime() + 86_400_000).toISOString(), now)).toBe(false);
  });
});
