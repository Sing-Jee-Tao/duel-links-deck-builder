import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const dataDir = path.join(repoRoot, "data");
export const fixturesDir = path.join(repoRoot, "scripts", "__fixtures__");

export const cardsPath = path.join(dataDir, "cards.json");
export const banlistPath = path.join(dataDir, "banlist.json");
export const banlistOverridePath = path.join(dataDir, "banlist-override.json");

export function readJsonIfExists<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    throw new Error(`${file} exists but is not valid JSON: ${String(err)}`);
  }
}

/** Writes pretty JSON with a trailing newline so diffs stay reviewable. */
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Writes minified JSON, for files that ship to the browser and that no one
 * reviews by eye. Indenting the synergy statistics cost 2 MB of whitespace on a
 * file whose diff is meaningless either way — it is counts, not decisions.
 */
export function writeCompactJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

/**
 * Appends a line to the GitHub Actions step summary when running in CI, so the
 * count diff shows up on the pull request rather than only in the job log.
 */
export function reportToCi(markdown: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  fs.appendFileSync(summary, `${markdown}\n`, "utf8");
}

/** True when `moduleUrl` is the module node was told to execute. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(moduleUrl)) === path.resolve(entry);
}

export const USER_AGENT =
  "DeckLedgerBot/0.1 (+https://github.com/sing-jee-tao/duel-links-deck-builder; weekly data refresh; contact via repo issues)";
