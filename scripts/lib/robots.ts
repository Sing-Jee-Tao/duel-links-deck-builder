/**
 * Minimal robots.txt handling, shared by the two scripts that reach out to
 * duellinksmeta.com — the banlist scraper and the card-pool fetch.
 */

/** Minimal robots.txt check for the `*` group covering our path. */
export function isPathAllowed(robotsTxt: string, pathname: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let inStar = false;
  let allowed = true;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inStar = value === "*";
    } else if (inStar && key === "disallow" && value && pathname.startsWith(value)) {
      allowed = false;
    } else if (inStar && key === "allow" && value && pathname.startsWith(value)) {
      allowed = true;
    }
  }
  return allowed;
}
