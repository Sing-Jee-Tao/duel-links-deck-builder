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
import { diffDecks, idealDeck } from "../engine/build.ts";
import { computeAllowance } from "../engine/validator.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";
import { typeLabel } from "./Collection.tsx";

function copyLabel(entries: { copies: number }[]): string {
  const total = entries.reduce((sum, e) => sum + e.copies, 0);
  return `${total} ${total === 1 ? "copy" : "copies"}`;
}

export function Upgrade({ selected }: { selected: string | null }): JSX.Element {
  const { status, retry, pool, build, buildStatus, collection, config } = useStore();
  const index = useMemo(() => new BanlistIndex(banlist), []);
  const candidates = build?.candidates ?? [];
  const [chosen, setChosen] = useState<string | null>(selected);
  const activeId = chosen ?? candidates[0]?.template.id ?? null;
  const active = candidates.find((c) => c.template.id === activeId) ?? candidates[0] ?? null;

  const loading = status === "loading" || buildStatus === "loading";

  const view = useMemo(() => {
    if (!pool || !build || !active) return null;
    const target = idealDeck(active.template, index, pool.index, config);
    const diff = diffDecks(build.deck, target);
    return { target, diff, allowance: computeAllowance(target, index) };
  }, [active, build, config, index, pool]);

  // Which allowance slots the upgrade keeps, and which are new.
  const annotations = useMemo(() => {
    const map: Record<string, "KEPT" | "NEW"> = {};
    if (!build || !view) return map;
    const current = new Set(
      build.validation.allowance.tiers.flatMap((t) => t.slots.map((s) => s.name.toLowerCase())),
    );
    for (const tier of view.allowance.tiers) {
      for (const slot of tier.slots) {
        map[slot.name.toLowerCase()] = current.has(slot.name.toLowerCase()) ? "KEPT" : "NEW";
      }
    }
    return map;
  }, [build, view]);

  const ownedCopies = (name: string): number => {
    const card = pool?.index.get(normalizeName(name));
    return card ? (collection.get(card.id) ?? 0) : 0;
  };

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="upgrade" />

      <div className="tabs" role="tablist" data-role="candidate-switcher">
        {candidates.map((candidate) => (
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
          {candidates.length} CANDIDATES SCORED
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
              <div className="label">Target · diff against your current build</div>
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
                            {card ? typeLabel(card) : "NOT IN POOL"}
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
