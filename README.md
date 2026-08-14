# Deck Ledger — Duel Links deck builder

**Live: https://sing-jee-tao.github.io/duel-links-deck-builder/**

**The deck builder that knows what you own.**

Duel Links Meta already has tier lists, top decks and guides, and it does all of
that better than this ever will. It has one blind spot: every list on it assumes
you already have the cards. Enter what you actually own, and this answers the
question nothing else does — *what can I field tonight, and what is the cheapest
step up from here?*

- **Paste a card list** to fill your collection, instead of searching one at a time
- Every **legal** deck your collection can assemble, playable ones first
- Each deck's **Skill**, because a Duel Links deck without it is a different deck
- What each one is short by, **in URs and SRs** rather than a copy count
- What the whole list costs in gems, from real tournament decks

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
| Tests (880) | `npm test` |
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
  cards.json                10,644 Duel Links cards, with rarity and where to get them
  banlist.json              scraped Forbidden & Limited list, overrides applied
  banlist-override.json     hand-applied changes, merged on top of the scrape
  decks.json                69 deck targets derived from the tournament corpus
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

### Where the deck targets come from

This shipped with four hand-authored templates against a 10,644-card pool. They
were retired: four decks cannot cover that pool, no source of strategy prose
exists that we can lawfully reuse, and hand-maintained content rots. Every deck
target is now derived, so they all speak in one voice and none of them go stale.

`fetch-decks.ts` builds them from duellinksmeta's `/api/v1/top-decks` — a few
thousand real King-of-Games and tournament lists, each tagged with its deck type.
Grouping them and counting cards turns opinion into measurement:

- a card in **≥75%** of a deck type's lists is **core**, at the copy count those
  lists average
- one in **20–75%** is a **flex candidate**, ordered by how often it is played
- slots are sized so core + flex lands on the list size the corpus actually runs

Each also carries the **Skill** its lists ran and their **median gem price** —
median, not mean, so one list packed with alternate-art staples cannot move it.

A deck type needs **≥5 lists in the last 180 days** to become a target, and at
least one card that **every** list agrees on. That second rule drops
duellinksmeta's `Other` bucket and strategies like Burn whose lists share
nothing: a group with no core has no identity, cannot anchor a build, and can
never be "ready". Rush Duel deck types are dropped by their `rush` flag, not by
name — the "Rush!" convention is not applied consistently upstream. `tierScore`
takes duellinksmeta's stated tier where it has one (only 9 deck types do) and
otherwise ranks the deck type by its share of recent lists, on a 1–10 axis.

The join is exact: both `cards.json` and the corpus use duellinksmeta's in-game
names, and all 1,981 card names in the corpus resolve against the pool. The run
**fails closed** below a 95% join rate, on an empty result, or on a template
count that drifts more than 25% — an unresolved name silently drops a core card,
and a template missing its core ranks a collection against a deck that does not
exist.

### Getting a collection in

Duel Links keeps your collection on Konami's servers, so there is no file to
read — the 6.7 GB Steam install is 97% asset cache and has no save data at all.
The only local route would be intercepting the game's authenticated traffic,
which breaks Konami's terms and risks the player's account, so it is not on the
table. Import therefore starts from something a player can produce by hand: a
pasted list.

[`src/engine/import.ts`](src/engine/import.ts) reads `3x Name`, `Name x3`,
`Name (3)` or a bare name per line, skipping blanks and `#`/`//` comments. It
resolves in strict order, and the order is the whole point:

1. an **exact** folded-name match is applied silently — the pool has no duplicate
   names, so this is certain
2. anything else is **offered for confirmation**, never applied. 143 pool names
   are a word-prefix of another (`Alligator's Sword` / `Alligator's Sword
   Dragon`), and a confident wrong guess produces a deck that cannot be fielded
   with nothing on screen to explain why
3. a query that only hits effect text is **unmatched**, not a near-miss —
   `NAME_MATCH_FLOOR` in [`search.ts`](src/engine/search.ts) already draws that
   line for the typeahead

A line with no quantity counts as **1** by default, adjustable to 2 or 3.
Overstating a collection is the dangerous direction, so the safe value is the
default. Imports **merge, keeping the higher count**, so running the same paste
twice changes nothing and importing a second decklist adds to the first.

### Rarity and what a deck costs

`/api/v1/cards`, which the card-pool build already calls, carries a rarity and an
acquisition source per card. Both are copied onto `Card` — **98.1% of the pool
has a rarity**, and the same share names where it comes from ("Main Box · Rainbow
Overdrive"). Only the *first* source is kept: cards list several, and the rest
would add megabytes to a 6.5 MB asset without changing any decision.

This is why the shortfall reads "**6 UR · 2 SR SHORT**" rather than "11 cards
short". A box rations URs and gives Ns away; the rarity split is the difference
between a deck you finish this week and one you finish next month.

The gem figure is the corpus's median price for the **whole list**, and is
labelled that way everywhere it appears. There are no per-card gem prices
upstream, so apportioning it across the cards you happen to be missing would be
an invented number.

### Build engine

`rankTemplates` scores the collection against every template — core cards
weighted 5× flex, so a template missing one core card ranks below one missing
three flex cards. `buildDecks` then assembles the **top five**: Extra Deck and
core first, then flex slots greedily in candidate order, **calling the validator
after every addition and rolling back on a violation**. Candidates are ordered by
template preference *and* budget impact, so the single Limited 1 slot is not
spent on a card an unlimited one covers equally well. A deck that cannot legally
reach 20 comes back partial with a reason attached rather than throwing.

`powerScore` is `tierScore × completion × 10`, on a 0–100 scale — but it is **not
the ordering**. A 40%-complete tier-10 deck and a finished tier-6 deck both score
60, and presenting them the same way hid the only distinction that matters. Each
build also carries:

- **`ready`** — no core card missing, so it is playable as built rather than a
  legal twenty cards standing in for a deck. Comes from `missingCore`, which
  `scoreTemplate` had been computing and nobody was reading.
- **`shortfall`** — what is still missing, bucketed by rarity.

Decks sort **ready first, then by power score**. That is the change that makes
the Build screen answer "what can I play tonight" instead of "what scores
highest", which is the question Duel Links Meta already answers better.

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

1. **Upgrade rows carry rarity and a box, as the handoff drew them.** This was
   the one deviation for a while: acquisition data was out of scope because
   inventing gem costs would be worse than omitting them. It turned out not to
   need inventing — duellinksmeta states a rarity and a source per card, and a
   gem price per list, so those columns now say what the handoff wanted them to
   say. Dust is still absent; nothing publishes it.
2. **Account is a local profile, not sign-up/sign-in.** There is no server, so a
   password field would authenticate nothing. The screen keeps the template's
   switcher, form geometry and context column, and uses them for what actually
   persists your work: a duelist name and a JSON export/import.
3. **`.cta-row { flex-shrink: 0 }`** in the design sheet stops the closing CTA
   wrapping at 375px and pushes the page past the viewport. Overridden at the
   ≤560px breakpoint only; the handoff requires 375px.
4. **Build has a deck switcher; Upgrade has a filter and a sort.** The handoff
   drew one deck on Build and a short tab strip on Upgrade, which fits four decks
   and not sixty-nine. Build reuses Upgrade's own `.tabs` markup for its deck
   tabs; Upgrade adds a filter and a `closest / strongest / cheapest` sort above
   the same strip, which is also the app's only way to browse every deck. No new
   CSS either way.
5. **Strategy is a data guide, not prose.** The insert keeps its layout and its
   RULING modal, but a deck derived from tournament lists has no author, and
   duellinksmeta publishes no overview text to lift — every `overview` field on
   the deck-type endpoint is empty. The page shows measured inclusion rates, the
   Skill those lists ran, what the list costs and a link to a real one, with the
   margin column stating plainly that nobody wrote it.

Out of scope and deliberately absent: **card images**. There are no images, icons
or SVG anywhere. Skills and acquisition data were also excluded by the brief and
have since been reinstated — the objection to both was that the data would have
to be invented, and it turned out duellinksmeta states it outright.

## Data sources

- Card data: [YGOPRODeck](https://ygoprodeck.com/api-guide/) — cached locally and
  refreshed weekly, as their guidance asks.
- Rarity and acquisition sources: Duel Links Meta's `/api/v1/cards`, read in the
  same request that decides pool membership.
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
