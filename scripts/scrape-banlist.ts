/**
 * Scrapes the Duel Links Forbidden/Limited list and writes `data/banlist.json`.
 *
 * There is no machine-readable Duel Links banlist, so this renders
 * duellinksmeta.com's client-rendered page with Playwright and parses the
 * result. Weekly via GitHub Actions — never at request time.
 *
 *   npm run scrape:banlist            refresh data/banlist.json
 *   npm run scrape:banlist:snapshot   also refresh the golden-file fixture
 *
 * FAIL SAFE: `data/banlist.json` is committed. If the scrape fails, empties a
 * tier, or shifts by more than 25% of total entries, this exits non-zero and
 * leaves the committed file untouched. A bad scrape must never silently produce
 * an empty banlist — that would validate illegal decks as legal.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  banlistOverridePath,
  banlistPath,
  fixturesDir,
  isMain,
  readJsonIfExists,
  reportToCi,
  USER_AGENT,
  writeJson,
} from "./lib/paths.ts";
import { parseBanlistHtml, totalEntries, type ParsedTiers } from "./lib/parse-banlist.ts";
import { buildBanlist, mergeOverride } from "./lib/merge-override.ts";
import { isPathAllowed } from "./lib/robots.ts";
import type { Banlist, BanlistOverride } from "../src/data/types.ts";

// Shared with the card-pool fetch, which hits the same host.
export { isPathAllowed } from "./lib/robots.ts";

const PAGE_URL = "https://www.duellinksmeta.com/forbidden-limited-list";
const ROBOTS_URL = "https://www.duellinksmeta.com/robots.txt";
/** A shift larger than this share of the previous total is treated as a bad scrape. */
export const MAX_SHIFT = 0.25;
export const goldenFixturePath = path.join(fixturesDir, "duellinksmeta-forbidden-limited.html");

class ScrapeError extends Error {}

/**
 * Decides whether a freshly parsed list may replace the committed one.
 * Pure, so the fail-safe rules are unit-testable without a browser.
 */
export function assertSane(next: ParsedTiers, previous: Banlist | null): void {
  for (const tier of ["forbidden", "limited1", "limited2", "limited3"] as const) {
    if (next[tier].length === 0) {
      throw new ScrapeError(`Tier "${tier}" came back empty — refusing to overwrite the committed banlist.`);
    }
  }
  if (!previous) return;
  const before = totalEntries(previous);
  const after = totalEntries(next);
  if (before === 0) return;
  const shift = Math.abs(after - before) / before;
  if (shift > MAX_SHIFT) {
    throw new ScrapeError(
      `Total entries moved ${before} → ${after} (${(shift * 100).toFixed(1)}%), over the ${(MAX_SHIFT * 100).toFixed(0)}% guard. ` +
        `Refusing to overwrite. Re-run, or apply the change by hand in data/banlist-override.json.`,
    );
  }
}

async function renderPage(): Promise<string> {
  const robots = await fetch(ROBOTS_URL, { headers: { "User-Agent": USER_AGENT } });
  if (robots.ok) {
    const body = await robots.text();
    if (!isPathAllowed(body, new URL(PAGE_URL).pathname)) {
      throw new ScrapeError(`robots.txt disallows ${PAGE_URL} — not scraping.`);
    }
  } else {
    console.warn(`Could not read robots.txt (${robots.status}); proceeding with the documented allowance.`);
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // The page is client-rendered: wait for list content, not for the response.
    // Matched on text rather than role — each heading embeds an icon whose alt
    // text ("Limited 3 Icon") lands in the accessible name.
    await page.locator("h3", { hasText: /^\s*Limited 3\s*$/ }).first().waitFor({ timeout: 60_000 });
    await page.locator('a[href^="/cards/"]').first().waitFor({ timeout: 60_000 });

    // The page also serves a Rush Duel list behind a toggle. Make sure the Speed
    // Duel list is the one on screen before reading the DOM.
    const speed = page.locator("span", { hasText: /^Speed$/ }).first();
    if ((await speed.count()) > 0 && !(await speed.evaluate((el) => el.classList.contains("active")))) {
      await speed.click();
      await page.waitForTimeout(500);
    }

    // Tiers declare their own size via --numCards; wait until the rendered link
    // count settles so a lazily filled grid is not read half-populated.
    await page.waitForFunction(
      () => {
        const declared = [...document.querySelectorAll<HTMLElement>("[style*='--numCards']")].reduce(
          (sum, el) => sum + Number(el.style.getPropertyValue("--numCards") || 0),
          0,
        );
        return declared > 0 && document.querySelectorAll('a[href^="/cards/"]').length >= declared;
      },
      undefined,
      { timeout: 60_000 },
    );

    return await page.content();
  } finally {
    await browser.close();
  }
}

/** Strips base64 image payloads: they are ~90% of the bytes and nothing parses them. */
export function slimForFixture(html: string): string {
  return html.replace(/src="data:[^"]*"/g, 'src="data:stripped"');
}

async function main(): Promise<void> {
  const snapshot = process.argv.includes("--snapshot");
  const previous = readJsonIfExists<Banlist>(banlistPath);

  console.log(`Rendering ${PAGE_URL}`);
  const html = await renderPage();
  const parsed = parseBanlistHtml(html);
  for (const w of parsed.warnings) console.warn(`WARN ${w}`);
  if (parsed.warnings.some((w) => w.includes("links parsed"))) {
    throw new ScrapeError("Parsed counts disagree with the counts the page declared — treating as a bad scrape.");
  }

  const override = readJsonIfExists<BanlistOverride>(banlistOverridePath);
  const { tiers, applied, changes } = mergeOverride(parsed, override);
  assertSane(tiers, previous);

  const banlist = buildBanlist(tiers, applied ? "override" : "scrape");
  writeJson(banlistPath, banlist);

  if (snapshot) {
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(goldenFixturePath, slimForFixture(html), "utf8");
    console.log(`Golden fixture updated: ${goldenFixturePath}`);
  }

  const counts = `forbidden ${tiers.forbidden.length} · L1 ${tiers.limited1.length} · L2 ${tiers.limited2.length} · L3 ${tiers.limited3.length}`;
  console.log(`Banlist written (${banlist.source}): ${counts}`);
  if (previous) console.log(`Previous total ${totalEntries(previous)} → ${totalEntries(tiers)}`);
  if (changes.length) console.log(`Override applied:\n  ${changes.join("\n  ")}`);

  reportToCi(
    [
      "### Banlist refresh",
      "",
      `- Source: **${banlist.source}**, scraped ${banlist.scrapedAt}`,
      `- ${counts}`,
      previous ? `- Total ${totalEntries(previous)} → ${totalEntries(tiers)}` : "- No previous list",
      changes.length ? `- Override changes:\n${changes.map((c) => `  - ${c}`).join("\n")}` : "",
    ].join("\n"),
  );
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof ScrapeError ? `Scrape aborted: ${err.message}` : err);
    console.error("data/banlist.json left untouched.");
    process.exit(1);
  });
}
