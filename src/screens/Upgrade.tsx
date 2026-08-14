/**
 * Screen 03 — Upgrade path: a target deck shown as a diff against the build.
 *
 * DEVIATION FROM THE DESIGN TEMPLATE: the acquire rows in the handoff carry a
 * gem cost and a set/rarity source ("SR · STRUCTURE DECK EX", "3,600"). Card
 * acquisition data — boxes, packs, rarity, dust costs — is explicitly out of
 * scope for this build, and inventing numbers there would be worse than not
 * showing them. Those two columns carry what we actually know instead: the
 * card's type, and how many copies you own against how many the target wants.
 * The row geometry and diff marks are unchanged.
 */
import { useMemo, useState } from "react";
import { AllowanceRail } from "../components/Allowance.tsx";
import { Masthead, ScreenNav, Shell } from "../components/Chrome.tsx";
import { EmptyState, ErrorNotice, LoadingState, Meter } from "../components/States.tsx";
import { banlist } from "../data/index.ts";
import { BanlistIndex, normalizeName } from "../engine/banlist-index.ts";
import { diffDecks, idealDeck, shortfallOf } from "../engine/build.ts";
import { RARITY_ORDER } from "../data/types.ts";
import { foldForSearch, tokenize } from "../engine/search.ts";
import { computeAllowance } from "../engine/validator.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";
import type { Card } from "../data/types.ts";
import type { TemplateScore } from "../engine/types.ts";

function copyLabel(entries: { copies: number }[]): string {
  const total = entries.reduce((sum, e) => sum + e.copies, 0);
  return `${total} ${total === 1 ? "copy" : "copies"}`;
}

/** Compact enough for a tab: 31500 → "32k gems". */
function shortGems(gems: number): string {
  return `${Math.round(gems / 1000)}k gems`;
}

/** Rarity and where the card comes from — the two facts that decide the chase. */
function sourceLabel(card: Card | undefined): string {
  if (!card) return "NOT IN POOL";
  const rarity = card.rarity ?? "—";
  return card.obtainedFrom ? `${rarity} · ${card.obtainedFrom.name.toUpperCase()}` : rarity;
}

/** How many candidates the strip shows before the filter has to narrow them. */
const VISIBLE_CANDIDATES = 12;

/**
 * The three questions a player actually arrives with. Ordering by strength alone
 * is what duellinksmeta already does; "what can I nearly build" and "what is
 * cheapest to finish" are the ones only this app can answer.
 */
const SORTS = {
  closest: { label: "Closest to done", of: (c: TemplateScore) => -c.completion },
  strongest: { label: "Strongest", of: (c: TemplateScore) => -c.rank },
  // Named for what it measures. There are no per-card gem prices upstream, so
  // this is the cost of the whole list, not the cost of your remaining gap —
  // calling it "cheapest to finish" would promise a number we cannot compute.
  cheapest: { label: "Cheapest list", of: (c: TemplateScore) => c.template.meta?.gemsPrice ?? Infinity },
} as const;

type SortKey = keyof typeof SORTS;

export function Upgrade({ selected }: { selected: string | null }): JSX.Element {
  const { status, retry, pool, builds, build, buildStatus, collection, config } = useStore();
  const index = useMemo(() => new BanlistIndex(banlist), []);
  const candidates = build?.candidates ?? [];
  const [chosen, setChosen] = useState<string | null>(selected);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("closest");
  const activeId = chosen ?? candidates[0]?.template.id ?? null;
  const active = candidates.find((c) => c.template.id === activeId) ?? candidates[0] ?? null;

  // Every template is a scored upgrade target now, not just three, so the strip
  // needs narrowing rather than a tab per deck. The active candidate stays in
  // the list whatever the filter says — losing the panel you are reading to a
  // keystroke would be worse than an off-filter row.
  const visible = useMemo(() => {
    const tokens = tokenize(query);
    const matches = candidates.filter((candidate) => {
      if (candidate.template.id === activeId) return true;
      if (tokens.length === 0) return true;
      const name = foldForSearch(candidate.template.name);
      return tokens.every((token) => name.includes(token));
    });
    const key = SORTS[sort].of;
    return [...matches]
      .sort((a, b) => key(a) - key(b) || a.template.name.localeCompare(b.template.name))
      .slice(0, VISIBLE_CANDIDATES);
  }, [activeId, candidates, query, sort]);

  const loading = status === "loading" || buildStatus === "loading";

  /**
   * The deck the target is measured against.
   *
   * If the engine already built this archetype out of the collection, that is
   * the honest starting point — "what is still missing from my Traptrix deck"
   * is the question the screen answers. Only when the target is an archetype the
   * player cannot build at all does the diff fall back to the deck they are
   * currently looking at.
   */
  const from = useMemo(
    () => builds.find((result) => result.template?.id === active?.template.id) ?? build,
    [active, build, builds],
  );

  const view = useMemo(() => {
    if (!pool || !from || !active) return null;
    const target = idealDeck(active.template, index, pool.index, config);
    const diff = diffDecks(from.deck, target);
    return {
      target,
      diff,
      shortfall: shortfallOf(diff.toAcquire, pool.index),
      allowance: computeAllowance(target, index),
    };
  }, [active, from, config, index, pool]);

  // Which allowance slots the upgrade keeps, and which are new.
  const annotations = useMemo(() => {
    const map: Record<string, "KEPT" | "NEW"> = {};
    if (!from || !view) return map;
    const current = new Set(
      from.validation.allowance.tiers.flatMap((t) => t.slots.map((s) => s.name.toLowerCase())),
    );
    for (const tier of view.allowance.tiers) {
      for (const slot of tier.slots) {
        map[slot.name.toLowerCase()] = current.has(slot.name.toLowerCase()) ? "KEPT" : "NEW";
      }
    }
    return map;
  }, [from, view]);

  const ownedCopies = (name: string): number => {
    const card = pool?.index.get(normalizeName(name));
    return card ? (collection.get(card.id) ?? 0) : 0;
  };

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="upgrade" />

      {candidates.length > VISIBLE_CANDIDATES && (
        <div className="search" style={{ paddingBottom: "var(--s-3)" }}>
          <div className="field-group">
            <label className="field-group__label" htmlFor="candidate-filter">
              Browse {candidates.length} decks
            </label>
            <input
              id="candidate-filter"
              className="field field--search"
              type="search"
              data-role="candidate-filter"
              placeholder="Traptrix, Branded, Vaalmonica…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {/*
            Without this the decks are reachable only by typing a name you
            already know. Sorting by what you can nearly build, or by what costs
            least to finish, is the whole reason to browse at all.
          */}
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "var(--s-2)" }}
            data-role="candidate-sort"
          >
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <button
                className="chip"
                type="button"
                key={key}
                data-role="sort-option"
                data-sort={key}
                aria-pressed={sort === key}
                style={sort === key ? { fontWeight: 600, borderWidth: 2 } : undefined}
                onClick={() => setSort(key)}
              >
                {SORTS[key].label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist" data-role="candidate-switcher">
        {visible.map((candidate) => (
          <button
            className="tab"
            type="button"
            role="tab"
            key={candidate.template.id}
            data-role="candidate-tab"
            data-candidate={candidate.template.id}
            aria-selected={candidate.template.id === activeId}
            onClick={() => setChosen(candidate.template.id)}
          >
            <span className="tab__name">{candidate.template.name}</span>
            <span className="tab__meta">
              {Math.round(candidate.completion * 100)}% · tier {candidate.template.tierScore}
              {candidate.template.meta?.gemsPrice ? ` · ${shortGems(candidate.template.meta.gemsPrice)}` : ""}
            </span>
          </button>
        ))}
        <div
          className="mono muted"
          style={{
            flex: 1,
            minWidth: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 16px",
            fontSize: "var(--t-11)",
          }}
        >
          {visible.length} OF {candidates.length} SCORED
        </div>
      </div>

      {loading && <LoadingState data-role="diff-loading">DIFFING AGAINST CURRENT BUILD…</LoadingState>}

      {status === "error" && (
        <ErrorNotice title="Target list unavailable." onRetry={retry} data-role="diff-error">
          The card pool failed to load, so no target deck can be assembled.
        </ErrorNotice>
      )}

      {!loading && (!active || !view) && status === "ready" && (
        <EmptyState title="No upgrade candidates yet.">
          Enter some of your collection first — <a href={href("collection")}>start here</a>.
        </EmptyState>
      )}

      {!loading && active && view && (
        <div className="body" data-role="candidate-panel" data-candidate={active.template.id}>
          <main className="main">
            <section className="panel" data-role="completion-region" style={{ padding: "18px 20px" }}>
              <div className="label" data-role="diff-source">
                Target · diff against your {from?.template?.name ?? "current"} build
              </div>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "20px 32px", alignItems: "flex-end", marginTop: 10 }}
              >
                <h1 className="h1" data-role="target-deck-name">
                  {active.template.name}
                </h1>
                <span style={{ flex: 1 }} />
                <div style={{ textAlign: "right" }}>
                  <div
                    className="num"
                    style={{ fontSize: "var(--t-40)", fontWeight: 600, lineHeight: 0.9 }}
                    data-role="completion-percent"
                  >
                    {view.diff.completionPct}%
                  </div>
                  <div className="stat__label">complete</div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <Meter fillPct={view.diff.completionPct} tall />
              </div>
              <div
                className="mono muted"
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-11)", marginTop: 6 }}
              >
                <span data-role="owned-count">
                  {view.diff.sharedCopies} OF {view.diff.targetCopies} SLOTS ALREADY IN YOUR BUILD
                </span>
                <span data-role="gap-count">
                  {view.diff.targetCopies - view.diff.sharedCopies} MISSING
                </span>
              </div>
            </section>

            <section data-role="acquire-region">
              <div className="strip" data-role="group-head">
                <span>Acquire</span>
                <span data-role="group-count">{copyLabel(view.diff.toAcquire)}</span>
              </div>
              {view.diff.toAcquire.length === 0 ? (
                <EmptyState title="You already own every card in this list.">
                  Nothing to acquire. <a href={href("build")}>Build it now.</a>
                </EmptyState>
              ) : (
                <div className="scroll" data-role="diff-scroll">
                  <div className="ledger ledger--deck">
                    {view.diff.toAcquire.map((entry) => {
                      const card = pool?.index.get(normalizeName(entry.name));
                      return (
                        <div className="row cols-acquire" data-role="card-row" data-diff="add" key={entry.name}>
                          <span className="diff-mark diff-mark--add" aria-hidden="true">
                            +
                          </span>
                          <span className="row__name" data-role="card-name">
                            {entry.name}
                          </span>
                          <span className="row__meta" data-role="card-source">
                            {sourceLabel(card)}
                          </span>
                          <span className="row__num" data-role="card-cost">
                            OWN {ownedCopies(entry.name)}/{entry.inTarget}
                          </span>
                          <span className="row__copies" data-role="card-copies">
                            ×{entry.copies}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="strip" data-role="group-head">
                <span>Cut</span>
                <span data-role="group-count">{copyLabel(view.diff.toCut)}</span>
              </div>
              {view.diff.toCut.length === 0 ? (
                <EmptyState title="Nothing comes out.">
                  Every card in your current build has a place in this list.
                </EmptyState>
              ) : (
                <div className="scroll" data-role="diff-scroll">
                  <div className="ledger ledger--deck">
                    {view.diff.toCut.map((entry) => (
                      <div className="row cols-cut" data-role="card-row" data-diff="cut" key={entry.name}>
                        <span className="diff-mark diff-mark--cut" aria-hidden="true">
                          −
                        </span>
                        <span className="row__name row__name--cut" data-role="card-name">
                          {entry.name}
                        </span>
                        <span data-role="cut-reason" style={{ fontSize: "var(--t-12)", color: "var(--ink-2)" }}>
                          {entry.inTarget > 0
                            ? `Target runs ${entry.inTarget}, not ${entry.inCurrent}`
                            : "Off-plan for this list"}
                        </span>
                        <span className="row__copies" data-role="card-copies">
                          ×{entry.copies}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </main>

          <aside className="side" data-role="upgrade-summary">
            <div className="side__sticky">
              <div className="panel">
                <div className="label">Cards to finish</div>
                <div className="stat" style={{ marginTop: 8 }} data-role="gem-cost">
                  {view.diff.toAcquire.reduce((sum, e) => sum + e.copies, 0)}
                </div>
                <div className="stat__label">
                  copies still missing, across {view.diff.toAcquire.length} card
                  {view.diff.toAcquire.length === 1 ? "" : "s"}
                </div>
                {/*
                  Bucketed by rarity, because that is what a box actually rations.
                  The gem figure is the whole list's median cost from the corpus,
                  not an apportioned share — per-card gem prices do not exist.
                */}
                {view.shortfall.copies > 0 && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {RARITY_ORDER.filter((rarity) => view.shortfall.byRarity[rarity]).map((rarity) => (
                      <span className="chip" key={rarity} data-role="shortfall-rarity" data-rarity={rarity}>
                        {view.shortfall.byRarity[rarity]} {rarity}
                      </span>
                    ))}
                  </div>
                )}
                {(active.template.meta?.gemsPrice ?? 0) > 0 && (
                  <div className="stat__label" style={{ marginTop: 10 }} data-role="deck-gem-price">
                    Whole list ≈ {(active.template.meta?.gemsPrice ?? 0).toLocaleString("en-GB")} gems from nothing
                  </div>
                )}
                {active.template.meta?.skill && (
                  <div className="stat__label" style={{ marginTop: 6 }} data-role="target-skill">
                    Skill · {active.template.meta.skill.name}
                  </div>
                )}
              </div>

              <AllowanceRail
                allowance={view.allowance}
                title="Allowance after"
                annotations={annotations}
                role="allowance-delta"
              />

              <div style={{ padding: "14px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a className="btn btn--primary" href={href("strategy", active.template.id)}>
                  Read the guide
                </a>
                <a className="btn" href={href("collection")} data-role="strategy-link">
                  Collection
                </a>
              </div>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
