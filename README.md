# Deck Ledger — Duel Links deck builder

**Live: https://sing-jee-tao.github.io/duel-links-deck-builder/**

Enter the Yu-Gi-Oh! Duel Links cards you own; the engine assembles every
**legal** deck it can out of them and shows what each becomes with a handful
more cards.

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
| Tests (248) | `npm test` |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |
| Refresh card pool | `npm run fetch:cards` |
| Re-derive deck templates | `npm run fetch:decks` |
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
data/                       committed pipeline output — the app reads only this
  cards.json                10,644 Duel Links cards, sorted by name
  banlist.json              scraped Forbidden & Limited list, overrides applied
  banlist-override.json     hand-applied changes, merged on top of the scrape
  templates/*.json          four hand-authored deck templates, with prose
  decks.json                ~71 templates derived from the tournament corpus
  synergy.json              play rate + co-occurrence per card, from the same corpus
scripts/
  fetch-cards.ts            duellinksmeta + YGOPRODeck → data/cards.json
  fetch-decks.ts            duellinksmeta top-decks → decks.json + synergy.json
  scrape-banlist.ts         duellinksmeta.com → data/banlist.json (Playwright)
  lib/duel-links-pool.ts    pure merge of the two card sources
  lib/derive-templates.ts   pure derivation of templates from tournament lists
  lib/parse-banlist.ts      pure parser over the rendered HTML
  __fixtures__/             golden copies of the page and the corpus
src/
  engine/                   validator, build engine, solver, diff — pure, no React
    deck-builder.ts         the only path a card takes into a deck
    build.ts                template ranking and assembly
    synthesize.ts           the template-free solver
  data/                     static data access + freshness
  state/                    IndexedDB persistence, store, hash router
  components/               chrome, allowance rail, states
  screens/                  the seven screens
  fonts/                    self-hosted woff2 (OFL) + generated fonts.css
design/                     the original handoff, unmodified, for reference
```

### Data pipeline

All three scripts run **weekly in CI**, never from the app
([`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml)).
When the data changes the job pushes a `data-refresh/<date>` branch and opens a
pull request — or, where the org disallows Actions opening PRs (as Sing-Jee-Tao
currently does), an issue carrying the compare link. To get real PRs instead,
enable **Allow GitHub Actions to create and approve pull requests** under the
org's Settings → Actions → General, then the same box in the repo's settings.

`fetch-cards.ts` builds the pool from **two** sources. duellinksmeta's
`/api/v1/cards` decides membership — it carries a real per-card Duel Links release
date — and YGOPRODeck supplies the printed detail, because its `type` strings are
the vocabulary the app parses. YGOPRODeck's own `format=duel links` flag is not
enough on its own: in August 2026 it was missing ~2,500 released cards, including
everything from that year's boxes, and 78 names on the scraped Forbidden/Limited
list did not exist in the pool at all.

The two sets are **unioned**, not swapped. duellinksmeta's release field has false
negatives, and dropping a card a player owns is worse than showing one that is not
out yet, so cards YGOPRODeck flags but duellinksmeta has no release for are kept
and listed in the job summary for review. The script also **fails closed**: an
empty result from either source, or a pool that shrank more than 25%, aborts and
leaves `data/cards.json` untouched.

Where the two disagree on a name for the same card, the pool takes the name Duel
Links shows in game (TCG "Synchronized Realm" ships as "Synch Realm", rebalanced
to 250 damage). That is the name the scraped banlist joins on, and an unmatched
forbidden card would validate as legal. Duel Links–exclusive cards have no Konami
passcode, so they get a stable synthetic id at or above 100000000 — saved
collections key on that id, so it must not drift between runs.

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

### Where the deck templates come from

Four hand-authored templates cannot cover a 10,644-card pool: most collections
matched none of them, and "top candidates" was really an enumeration. So
`fetch-decks.ts` derives the rest from duellinksmeta's `/api/v1/top-decks` — a
few thousand real King-of-Games and tournament lists, each tagged with its deck
type. Grouping them and counting cards turns opinion into measurement:

- a card in **≥75%** of a deck type's lists is **core**, at the copy count those
  lists average
- one in **20–75%** is a **flex candidate**, ordered by how often it is played
- slots are sized so core + flex lands on the list size the corpus actually runs

A deck type needs **≥5 lists in the last 180 days** to become a template. Rush
Duel deck types are dropped by their `rush` flag, not by name — the "Rush!"
convention is not applied consistently upstream. `tierScore` takes
duellinksmeta's stated tier where it has one (only 9 deck types do) and
otherwise ranks the deck type by its share of recent lists, so authored and
derived templates sit on one 1–10 axis.

The join is exact: both `cards.json` and the corpus use duellinksmeta's in-game
names, and all 1,982 card names in the corpus resolve against the pool. The run
**fails closed** below a 95% join rate, on an empty result, or on a template
count that drifts more than 25% — an unresolved name silently drops a core card,
and a template missing its core ranks a collection against a deck that does not
exist. The four authored templates are untouched by any of this and keep their
prose.

### Build engine

`rankTemplates` scores the collection against every template — core cards
weighted 5× flex, so a template missing one core card ranks below one missing
three flex cards. `buildDecks` then assembles the **top five**: Extra Deck and
core first, then flex slots greedily in candidate order, **calling the validator
after every addition and rolling back on a violation**. Candidates are ordered by
template preference *and* budget impact, so the single Limited 1 slot is not
spent on a card an unlimited one covers equally well. A deck that cannot legally
reach 20 comes back partial with a reason attached rather than throwing.

`powerScore` is `tierScore × completion × 10`, on a 0–100 scale.

Every card enters a deck through `DeckBuilder` in
[`src/engine/deck-builder.ts`](src/engine/deck-builder.ts), which validates and
rolls back each copy. That is the single reason no part of the engine can return
a deck the legality panel would reject.

`diffDecks(current, target)` powers the whole upgrade screen: the shopping list
and the swap list are two views of the same diff. The screen diffs a target
against **that target's own build** when the collection supports one — "what is
still missing from my Traptrix deck" — and only falls back to the deck on screen
when the target is an archetype the player cannot build at all.

### The template-free solver

[`src/engine/synthesize.ts`](src/engine/synthesize.ts) builds a deck for a
collection that matches nothing, and is offered alongside the templated builds
rather than only as a fallback.

**It is not a rules engine, and does not pretend to be.** `cards.json` carries
effect text only as unstructured prose — no triggers, costs or timings — so
nothing here reads a card and reasons about it. What it uses instead is
`synergy.json`: across the same few thousand lists, how often each card is
played and which cards are played *with* it. Two cards that keep appearing in
the same list belong together whatever their text says. In falling order of
reliability, the solver reads:

1. **co-occurrence** — the partners a card is actually played alongside
2. **archetype** — the `archetype` field, plus cards naming it in their own name
3. **play rate and deck-type spread** — a card in 70 different deck types is a
   generic staple that fits anywhere

It seeds from the archetype the collection is deepest in, grows greedily by
co-occurrence with what is already in the deck, and falls back to card kind and
ATK only for cards the corpus has never seen. Assembly runs through the same
`DeckBuilder`, so the result is as legal as any templated build.

Its `powerScore` is **synergy density** — the share of its card pairs that real
lists play together. That is a different measurement from a template's, on the
same 0–100 axis, and the Build screen says so on the deck itself rather than
letting the number imply more than it means.

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
below a marked divider, and the `data-role` hooks are preserved throughout. Five
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
4. **Build has a deck switcher; Upgrade's has a filter.** The handoff drew one
   deck on Build and a short tab strip on Upgrade, which fits four templates and
   not seventy-five. Build reuses Upgrade's own `.tabs` markup for its deck tabs,
   and Upgrade adds a filter above the same strip. No new CSS either way.
5. **Derived decks get a data guide, not prose.** The Strategy insert keeps its
   layout and its RULING modal, but a template derived from tournament lists has
   no author, and duellinksmeta publishes no overview text to lift — every
   `overview` field on the deck-type endpoint is empty. Those pages show measured
   inclusion rates, the Skills the lists ran, and a link to a real list, with the
   margin column stating plainly that nobody wrote it.

Out of scope and deliberately absent, per the brief: Skills, card acquisition
data, and card images. There are no images, icons or SVG anywhere.

## Data sources

- Card data: [YGOPRODeck](https://ygoprodeck.com/api-guide/) — cached locally and
  refreshed weekly, as their guidance asks.
- Forbidden & Limited list: [Duel Links Meta](https://www.duellinksmeta.com/forbidden-limited-list),
  scraped weekly under a descriptive User-Agent, `robots.txt` honoured.
- Deck templates and synergy statistics: Duel Links Meta's `/api/v1/top-decks`
  and `/api/v1/deck-types`, read weekly under the same User-Agent with
  `robots.txt` checked first. Only aggregate counts are stored; the derived
  templates link back to a real list on duellinksmeta rather than reproducing
  anyone's deck as our own.
- Typefaces: Archivo, IBM Plex Mono and Newsreader, downloaded once by
  `npm run fetch:fonts` and committed under `src/fonts/`. All three are SIL Open
  Font License 1.1 (`src/fonts/OFL.txt`); latin and latin-ext subsets only,
  364 kB total.

Unofficial. Not affiliated with or endorsed by Konami.
