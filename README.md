# Deck Ledger — Duel Links deck builder

**Live: https://sing-jee-tao.github.io/duel-links-deck-builder/**

Enter the Yu-Gi-Oh! Duel Links cards you own; the engine assembles the strongest
**legal** deck out of them and shows what the deck becomes with a handful more.

Static site. No backend, no accounts, and **zero third-party requests at
runtime** — the card pool, the Forbidden & Limited list and the three typefaces
all ship with the build. A loaded page contacts nothing but its own origin.
Your collection lives in your browser (IndexedDB) and exports to a JSON file you
keep.

```bash
npm install
npm run dev
```

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Tests (138) | `npm test` |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |
| Refresh card pool | `npm run fetch:cards` |
| Refresh banlist | `npm run scrape:banlist` |
| Refresh banlist + golden fixture | `npm run scrape:banlist:snapshot` |
| Re-download the self-hosted fonts | `npm run fetch:fonts` |

## The rule everything is built around

Duel Links limits do **not** work like the TCG. Limited 1, 2 and 3 are each a
*shared budget across the entire tier*, not a per-card cap:

- **Forbidden** — zero copies.
- **Limited 1** — 1 card total from the whole Limited 1 pool. If A and B are both
  Limited 1, a legal deck has one A, or one B, or neither. **Never one of each.**
- **Limited 2** — 2 total from the whole pool: AA, AB, BB, A, B, or none. AAB and
  AABB are illegal.
- **Limited 3** — 3 total from the whole pool.

`validateDeck(deck, banlist, config)` in [`src/engine/validator.ts`](src/engine/validator.ts)
is a pure function returning **every** violation, not just the first. It checks
main deck size 20–30, Extra Deck ≤ the configured cap (5–9), ≤3 copies of a name,
zero Forbidden cards, and the three pooled budgets.

The UI never states the allowance as a number alone: the rail draws one slot per
copy of budget and writes the occupying card's name into it, so you read what the
allowance was spent *on*.

## Architecture

```
data/                     committed pipeline output — the app reads only this
  cards.json              8,123 Duel Links cards, sorted by name
  banlist.json            scraped Forbidden & Limited list, overrides applied
  banlist-override.json   hand-applied changes, merged on top of the scrape
  templates/*.json        four hand-authored deck templates
scripts/
  fetch-cards.ts          YGOPRODeck → data/cards.json
  scrape-banlist.ts       duellinksmeta.com → data/banlist.json (Playwright)
  lib/parse-banlist.ts    pure parser over the rendered HTML
  __fixtures__/           golden copy of the rendered page
src/
  engine/                 validator, build engine, diff — pure, no React
  data/                   static data access + freshness
  state/                  IndexedDB persistence, store, hash router
  components/             chrome, allowance rail, states
  screens/                the seven screens
  fonts/                  self-hosted woff2 (OFL) + generated fonts.css
design/                   the original handoff, unmodified, for reference
```

### Data pipeline

Both scripts run **weekly in CI**, never from the app
([`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml)).
When the data changes the job pushes a `data-refresh/<date>` branch and opens a
pull request — or, where the org disallows Actions opening PRs (as Sing-Jee-Tao
currently does), an issue carrying the compare link. To get real PRs instead,
enable **Allow GitHub Actions to create and approve pull requests** under the
org's Settings → Actions → General, then the same box in the repo's settings.

`fetch-cards.ts` pulls YGOPRODeck's `format=duel links` endpoint once and projects
each card down to the fields the app uses. That legality flag is approximate, so
the script logs the card count and the added/removed diff against the previous
run, into the PR's job summary.

`scrape-banlist.ts` renders duellinksmeta.com's Forbidden/Limited page with
Playwright (it is a Svelte app — the raw HTML has no list) and parses the rendered
HTML with a pure function. It checks `robots.txt` first, sends a descriptive
User-Agent with a contact URL, and **fails closed**:

- any tier coming back empty → abort
- parsed count disagreeing with the page's own declared `--numCards` → abort
- total entries shifting more than 25% → abort

On any of those the job exits non-zero, opens an issue, and leaves
`data/banlist.json` untouched. A bad scrape must never silently produce an empty
banlist — that would validate illegal decks as legal.

[`scripts/parse-banlist.test.ts`](scripts/parse-banlist.test.ts) is a golden-file
test against a saved copy of the rendered page, so a site redesign breaks CI
rather than production.

`data/banlist-override.json` is merged on top of the scraped result, so a Konami
announcement can be applied by hand before the scrape catches up. A list older
than 14 days renders the stale-refresh warning on the Banlist screen.

### Build engine

`buildBest` scores the collection against each template — core cards weighted 5×
flex, so a template missing one core card ranks below one missing three flex
cards — then assembles the best one: Extra Deck and core first, then flex slots
greedily in candidate order, **calling the validator after every addition and
rolling back on a violation**. Candidates are ordered by template preference *and*
budget impact, so the single Limited 1 slot is not spent on a card an unlimited
one covers equally well. A deck that cannot legally reach 20 comes back partial
with a reason attached rather than throwing.

`diffDecks(current, target)` powers the whole upgrade screen: the shopping list
and the swap list are two views of the same diff.

## Deploying

Deployed to **GitHub Pages** at
<https://sing-jee-tao.github.io/duel-links-deck-builder/> by
[`deploy-pages.yml`](.github/workflows/deploy-pages.yml) on every push to `main`.
Pages is free because this repo is public; on a private repo it needs a paid org
plan. The build uses a relative base and hash routing, so it works from a
subpath with no rewrite rules.

[`netlify.toml`](netlify.toml) is kept for an alternative Netlify deploy — note
that Netlify's Git integration gates *private* organization repos behind its Pro
plan, which is why Pages won here.

### A note on storage and the shared github.io origin

Browser storage is scoped to an **origin** (scheme + host), not a path. On
`sing-jee-tao.github.io` every project site shares one origin, so any other Pages
site under this org can read this app's IndexedDB. Nothing secret lives there —
it is a list of card names and counts — but a collection is not isolated from
other org project sites. A custom domain, or a repo-per-domain, would isolate it.

## Deviations from the design handoff

The templates in `design/` were treated as a spec and ported faithfully —
`ledger.css` is copied verbatim, with implementation-only additions appended
below a marked divider, and the `data-role` hooks are preserved throughout. Three
places differ, all for reasons the handoff could not have known:

1. **Upgrade rows carry no gem cost or set/rarity source.** Card acquisition data
   — boxes, packs, rarity, dust — is explicitly out of scope, and inventing those
   numbers would be worse than omitting them. Those two columns show the card's
   type and your owned copies against the target's. Row geometry and diff marks
   are unchanged.
2. **Account is a local profile, not sign-up/sign-in.** There is no server, so a
   password field would authenticate nothing. The screen keeps the template's
   switcher, form geometry and context column, and uses them for what actually
   persists your work: a duelist name and a JSON export/import.
3. **`.cta-row { flex-shrink: 0 }`** in the design sheet stops the closing CTA
   wrapping at 375px and pushes the page past the viewport. Overridden at the
   ≤560px breakpoint only; the handoff requires 375px.

Out of scope and deliberately absent, per the brief: Skills, card acquisition
data, and card images. There are no images, icons or SVG anywhere.

## Data sources

- Card data: [YGOPRODeck](https://ygoprodeck.com/api-guide/) — cached locally and
  refreshed weekly, as their guidance asks.
- Forbidden & Limited list: [Duel Links Meta](https://www.duellinksmeta.com/forbidden-limited-list),
  scraped weekly under a descriptive User-Agent, `robots.txt` honoured.
- Typefaces: Archivo, IBM Plex Mono and Newsreader, downloaded once by
  `npm run fetch:fonts` and committed under `src/fonts/`. All three are SIL Open
  Font License 1.1 (`src/fonts/OFL.txt`); latin and latin-ext subsets only,
  364 kB total.

Unofficial. Not affiliated with or endorsed by Konami.
