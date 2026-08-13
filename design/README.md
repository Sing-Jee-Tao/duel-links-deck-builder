# Handoff: Duel Links Deck Builder ("Deck Ledger")

## Overview

Front end for a Yu-Gi-Oh! Duel Links deck builder. A player enters the cards they
own; an engine assembles the strongest legal deck from that collection and shows
what the deck becomes with a handful of additional cards. Seven screens: Welcome (landing), Account (create / sign in), Collection, Build
result, Upgrade path, Strategy, Banlist status.

Audience is competitive-leaning Duel Links players. The UI assumes full game
fluency and explains nothing about the rules — it is a tool, not an onboarding.

## About the design files

The HTML/CSS/JS in this bundle are **design references**, not production code.
They are static templates showing intended structure, typography, spacing, and
interaction states. Recreate them in the target codebase using its existing
framework, component library, and conventions. If there is no codebase yet, pick
the framework that fits the project and implement the designs there.

The markup is deliberately structured as an API (see *Markup contract* below).
Preserve the `data-role` attributes when porting — they are the intended binding
points for real data and behavior, and they survive any CSS or component
refactor.

## Fidelity

**High fidelity.** Colors, type, spacing, and row geometry are final. Recreate
pixel-accurately. Sample content is realistic and sized to real density; do not
substitute lorem text when checking layouts.

## Hard constraints carried in the design

- **No card images anywhere.** Deliberate product decision. Do not add card art,
  icon sets, emoji, or placeholder imagery in implementation. Typography,
  banding, and alignment carry the whole design.
- Every repeating structure appears exactly **twice** in these templates. That
  establishes the pattern; real lists render N.
- Empty, loading, and error states exist for every dynamically populated region
  and ship `hidden`. The two states that are visible by default are intentional:
  `[data-role="legality-warning"]` on Build, `[data-role="stale-warning"]` on
  Banlist.
- Responsive down to 375px, visible keyboard focus, `prefers-reduced-motion`
  respected.

## Theme

**Dark.** The design is a dark counterpart of greenbar continuous-form paper:
deep green-black stock, rows banded in two dark tones, one warm accent. `html`
carries `color-scheme: dark` so form controls and scrollbars follow. There is no
light theme — the tokens are the theme; swapping the `:root` values is the
supported way to add one.

## Layout concept

Greenbar continuous-form paper — the banded stock line printers used for long
numeric tables. Concretely:

- A fixed **perforation rail** (`.rail`, 28px, 16px under 560px) runs down the
  left edge of every screen, drawn as a CSS radial-gradient sprocket pattern. No
  images.
- One continuous **banded ledger** per screen, edge to edge. Rows alternate
  `--paper` / `--bar` via `:nth-child(even)`. No card containers, no rounded
  corners (`--radius: 0`), no shadows except the Strategy insert's flat offset
  block.
- A **right column** (`.side`, 250–340px) holds running totals, legality, and the
  allowance rail; sticky, never scrolls away. It folds full-width below 900px.
- Screen nav is a horizontal strip of numbered links under the masthead.

## Signature element — the allowance rail

The most distinctive rule in Duel Links deckbuilding: Limited 1 / 2 / 3 are
**shared pools, not per-card limits**. A player may run one card total from the
Limited 1 pool, two from Limited 2, three from Limited 3.

The rail draws each tier as a fixed number of slots, and a spent slot has the
occupying **card name written into it** — so the player reads what the allowance
was spent *on*, not merely how much is left. Empty slots are dashed outlines
labelled "open".

```
[data-role="allowance-rail"]
  [data-role="allowance-tier"][data-tier="1|2|3"]
    [data-role="tier-count"]        → "1/1", "2/2", "2/3"
    [data-role="allowance-slot"]    → occupied, card name inside
    [data-role="allowance-slot-empty"] → unspent slot
  [data-role="allowance-summary"]   → "5/6 SPENT"
```

It appears identically on Collection, Build, and Upgrade (as an "allowance after"
projection), and the Banlist screen states the rule in prose above the tiers.

## Screens

### 1. Collection — `collection.html`

Player searches a ~4,000-card pool and sets owned quantity 0–3 per card. Highest
traffic screen; the row is optimized for repetition.

- **Search region** (`[data-role="search-region"]`): full-width input, type-ahead
  results directly below it (`[data-role="typeahead"]`), each result 34px with
  name / type / limit tier. `[data-selected="true"]` marks the keyboard cursor.
- **Filter bar** (`[data-role="filter-bar"]`): type, attribute, level selects,
  archetype combobox, plus removable active-filter chips.
- **Ledger**: 7 columns — Card / Type / Attr / Lv / ATK-DEF / Lim / Owned. Row
  height 34px. Sticky dark header. Horizontal scroll below ~700px (deliberate:
  the ledger does not reflow into stacked cards).
- **Quantity control** (`[data-role="owned-quantity"]`): 64×26px button showing
  the count plus a three-pip track. **Click cycles 0 → 1 → 2 → 3 → 0**; keys 0–3
  set directly while focused. State lives in `data-quantity`.
- **Totals column**: distinct cards, total copies, save status, allowance rail.

### 2. Build result — `build.html`

The assembled deck plus its legality reading.

- Header: deck name, power score, main deck size, Rebuild.
- **Main deck** grouped Monster / Spell / Trap, each group headed by a dark strip
  with a count. Columns: name / type / ATK-DEF / limit / copies.
- **Extra deck** with a user-adjustable cap, 5–9
  (`[data-role="extra-cap-increase"|"extra-cap-decrease"|"extra-cap-value"]`).
- **Legality panel**: status line, deck-size meter against the 20–30 band,
  allowance rail, copy-count summary, warning and error notices.

### 3. Upgrade path — `upgrade.html`

A target deck shown as a diff against the current build.

- **Candidate switcher** (`[data-role="candidate-switcher"]`): tabs, one per
  candidate deck, each with completion % and acquisition count. Selected tab gets
  an ochre underline via `aria-selected="true"`. Panels are
  `[data-role="candidate-panel"][data-candidate]`; non-selected panels are
  `hidden`.
- **Completion**: large tabular percentage plus a meter whose unfilled remainder
  is a hatched pattern, not a flat track.
- **Acquire** rows: `+` mark, card name, source (rarity + set), gem cost, copies.
- **Cut** rows: `−` mark, struck-through name, one-line reason, copies.
- Right column: total gem cost and the projected allowance after the upgrade,
  including freed slots.

### 4. Strategy — `strategy.html`

Long-form editorial inside a data tool. Resolved by **changing the substrate**:
the prose sits on a separate printed insert (`.insert` — narrower measure,
`--paper-2` stock, flat offset shadow) laid on the desk background, with the tool
voice confined to a mono margin column beside it.

Sections: Game plan (Newsreader 18px prose), Opening priorities (ranked rows),
Key interactions (each with a RULING button opening a modal), Common matchups
(name / win rate / note). Modal: `[data-role="ruling-modal"]`, closes on
backdrop click, close button, or Escape; focus returns to the trigger.

### 5. Banlist status — `banlist.html`

Four tier columns — Forbidden, Limited 1, Limited 2, Limited 3 — each with a card
count, a plain-language note about how many slots the tier grants, and rows
marked `[data-in-deck="true"]` when the player's current deck occupies a slot.

Above them: effective date, last-checked timestamp, the shared-pool explainer,
and a **visible stale-refresh warning** (`[data-role="stale-warning"]`) for when
the automated refresh has not run.

## Markup contract

Behavioral hooks are `data-role` attributes; classes are presentational only and
can be replaced wholesale by the codebase's styling approach.

| `data-role` | Where | Purpose |
| --- | --- | --- |
| `perf-rail`, `masthead`, `screen-nav`, `nav-item` | all | Chrome |
| `search-input`, `typeahead`, `typeahead-result`, `typeahead-status` | 1 | Type-ahead |
| `filter-type`, `filter-attribute`, `filter-level`, `filter-archetype`, `filter-chip`, `active-filters` | 1 | Filtering |
| `card-row`, `card-name`, `card-type`, `card-attribute`, `card-level`, `card-stats`, `card-limit`, `card-copies` | 1,2,3 | Row cells |
| `owned-quantity`, `quantity-value`, `quantity-track` | 1 | 0–3 quantity control (`data-quantity`) |
| `distinct-total`, `copies-total`, `session-status`, `pagination-status` | 1 | Running totals |
| `build-button`, `rebuild-button` | 1,2 | Trigger the solver |
| `deck-list` (`data-deck="main|extra"`), `deck-group` (`data-group`), `group-head`, `group-count` | 2 | Deck structure |
| `extra-cap-increase`, `extra-cap-decrease`, `extra-cap-value`, `extra-count` | 2 | Extra deck cap 5–9 |
| `legality-panel`, `legality-status`, `legality-warning`, `legality-error`, `deck-size-meter`, `deck-size-value`, `copy-count-panel`, `copy-count-row` | 2 | Legality |
| `allowance-rail`, `allowance-tier` (`data-tier`), `tier-count`, `allowance-slot`, `allowance-slot-empty`, `allowance-summary`, `allowance-delta` | 1,2,3 | Signature element |
| `candidate-switcher`, `candidate-tab`, `candidate-panel` (`data-candidate`) | 3 | Move between target decks |
| `completion-percent`, `completion-meter`, `completion-fill`, `completion-gap`, `owned-count`, `gap-count`, `gem-cost` | 3 | Diff summary |
| `card-source`, `card-cost`, `cut-reason` (`data-diff="add|cut"` on the row) | 3 | Acquire / cut |
| `strategy-document`, `strategy-section` (`data-section`), `priority-row`, `interaction-row`, `matchup-row`, `matchup-winrate`, `strategy-margin`, `ruling-button`, `ruling-modal`, `modal-close` | 4 | Editorial |
| `banlist-region`, `banlist-tier` (`data-tier`), `banlist-row` (`data-in-deck`), `tier-count`, `tier-spent`, `last-updated`, `banlist-effective`, `stale-warning`, `refresh-button`, `revision-link` | 5 | Banlist |
| `account-menu`, `account-trigger`, `account-avatar`, `account-name`, `account-dropdown`, `account-link`, `signout-button` | all app screens | Account nav in the masthead (`<details>`; swap for the codebase's menu primitive) |
| `signin-link`, `signup-link`, `primary-cta`, `secondary-cta`, `hero`, `hero-stats`, `feature-list`, `feature`, `allowance-peek`, `closing-cta`, `footer` | Welcome | Landing |
| `auth-switcher`, `auth-tab` (`data-mode`), `auth-panel` (`data-mode`), `auth-form`, `auth-title`, `auth-subtitle`, `auth-error`, `input-display-name`, `input-email`, `input-password`, `input-banlist-alerts`, `field-hint`, `field-error`, `submit-button`, `submit-loading`, `auth-alt-button`, `forgot-link`, `back-link` | Account | Create account / sign in |
| `list-loading`/`empty`/`error`, `deck-loading`/`empty`/`error`, `diff-loading`/`empty`/`error`, `strategy-loading`/`empty`/`error`, `banlist-loading`/`empty`/`error`, `retry-button` | all | Async states |

## Interactions & behavior

All JS in `ledger.js` is demo-only — it shows states, it implements nothing.

1. **Quantity cycle** — click `[data-role="owned-quantity"]` to advance
   0→1→2→3→0; keys 0–3 set directly. Updates `data-quantity`, the numeral, and
   the pip track. Real implementation: optimistic local write, debounced persist.
2. **Extra deck cap** — ± clamps 5–9.
3. **Candidate tabs** — toggles `aria-selected` and shows the matching
   `[data-role="candidate-panel"]`. Real implementation fetches each diff.
4. **Ruling modal** — opens from any `[data-role="ruling-button"]`; closes on
   backdrop, close button, or Escape; restores focus to the trigger. Needs a
   proper focus trap in production.
5. **No animation anywhere.** No transitions, no easing. If any are added, gate
   them behind `prefers-reduced-motion`.

Hover/focus: `:focus-visible` draws a 2px `--redline` outline offset 1px on every
interactive element. Buttons have no hover fill by design; keep the hit target at
or above 26px height in dense rows, 44px on touch layouts.

## State management

- `collection: Map<cardId, 0|1|2|3>` — the only user-authored data; persist
  locally and sync.
- `filters: {type, attribute, level, archetype, ownedOnly}` and `query`.
- `build: {cards[], size, powerScore, legality}` — solver output; needs loading,
  success, timeout states.
- `allowance: {tier1: string[], tier2: string[], tier3: string[]}` derived from
  the build and the active banlist; drives the rail and the legality warnings.
- `candidates: [{id, name, completion, acquire[], cut[], gemCost, allowanceAfter}]`
  with `selectedCandidateId`.
- `banlist: {listId, effectiveDate, checkedAt, tiers, stale: boolean}` — `stale`
  is a UI-visible condition, not a silent failure.

## Design tokens

All tokens live in a single `:root` block at the top of `ledger.css`.

**Core palette (dark)**

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#E6EAE4` | Primary type |
| `--paper` | `#141C18` | Odd bands, primary surface |
| `--bar` | `#19231E` | Even bands, perforation rail, nav |
| `--strip` | `#0A100D` | Masthead, table heads, group strips |
| `--line` | `#2A3A31` | Every border and hairline |
| `--redline` | `#E2604A` | Rule violation, forbidden, stale |
| `--ochre` | `#D9A441` | Allowance consumed, warnings, primary CTA, focus ring |

Derived tints: `--ink-2 #C3CDC4`, `--ink-3 #92A197`, `--rule #3A4C42`,
`--paper-2 #1A241F`, `--panel #121A16`, `--desk #0E1512`, `--rule-2/-3 #202B25`,
`--redline-bg #2A1714`, `--ochre-bg #2A2113`, `--ochre-ink #E8C078`.
Account-menu chrome uses `#34463C` (border) and `#111A15` (fill).

Color is never decorative: red means a rule violation, ochre means an allowance
being consumed. Nothing else is tinted.

**Typefaces**

| Role | Family | Applied to |
| --- | --- | --- |
| `--font-ui` | Archivo 400/500/600/700 | Interface, card names, labels, buttons |
| `--font-num` | IBM Plex Mono 400/500/600 | Every numeral: ATK/DEF, levels, copy counts, meters, timestamps, all uppercase micro-labels |
| `--font-read` | Newsreader 400/500 | Strategy prose only |

Numerals are always mono for column alignment; apply
`font-variant-numeric: tabular-nums` (already on `.num`, `.row__num`,
`.row__copies`).

**Type scale** 10, 11, 12, 13, 15, 17, 18, 26, 28, 34, 40 px.
Micro-labels: 10–11px, `.14em` tracking, uppercase. Body 13px. Prose 17–18px.

**Spacing** 4px base — 4, 8, 12, 16, 20, 24, 32.

**Geometry** `--radius: 0` everywhere. `--row-h: 34px` (compact ledger row),
`--head-h: 28px`, `--rail-w: 28px` (16px under 560px), `--side-w: 300px`.

**Shadows** only two, both flat offsets, no blur: `5px 5px 0 rgba(23,37,30,.14)`
on the strategy insert, `6px 6px 0 rgba(23,37,30,.3)` on the modal.

## Responsive

- **≤900px** — right column unsticks and goes full width below the main column.
- **≤560px** — rail narrows to 16px, masthead meta hides, nav items stretch to
  fill, strategy margin column moves below the prose, headings step down.
- **Ledgers scroll horizontally** rather than reflowing; name / limit / owned stay
  leftmost so the two columns a player touches most stay visible. This is
  intentional — verify before "fixing" it.

## Assets

None. No images, icons, or SVG. Fonts load from Google Fonts (Archivo, IBM Plex
Mono, Newsreader); self-host them in production.

## Files

```
design_handoff_duel_links_deck_builder/
  welcome.html      Landing / feature overview
  account.html      Create account + sign in
  collection.html   Screen 1
  build.html        Screen 2
  upgrade.html      Screen 3
  strategy.html     Screen 4
  banlist.html      Screen 5
  ledger.css        Single stylesheet, :root tokens at the top
  ledger.js         Demo interaction only (quantity cycle, tabs, modal)
```

Source design components (streaming versions used to author the design) live in
the project root as `Welcome.dc.html`, `Account.dc.html`, `Collection.dc.html`, `Build.dc.html`, `Upgrade.dc.html`,
`Strategy.dc.html`, `Banlist.dc.html`, with the token/typography spec in
`Design Spec.dc.html`. The flat files above are the canonical handoff.
