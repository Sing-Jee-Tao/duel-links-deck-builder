/**
 * Screen 02 — Build result: the assembled deck plus its legality reading.
 */
import { useMemo } from "react";
import { AllowanceRail, ALLOWANCE_NOTE } from "../components/Allowance.tsx";
import { Masthead, ScreenNav, Shell } from "../components/Chrome.tsx";
import { EmptyState, ErrorNotice, LoadingState } from "../components/States.tsx";
import { banlist } from "../data/index.ts";
import type { Card } from "../data/types.ts";
import { BanlistIndex, normalizeName } from "../engine/banlist-index.ts";
import { countCopies } from "../engine/validator.ts";
import type { DeckEntry } from "../engine/types.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";
import { limitLabel, typeLabel } from "./Collection.tsx";

type Group = "monster" | "spell" | "trap";

function groupOf(card: Card | undefined): Group {
  if (!card) return "monster";
  if (card.type.includes("Spell")) return "spell";
  if (card.type.includes("Trap")) return "trap";
  return "monster";
}

function DeckRow({ entry, card, index }: { entry: DeckEntry; card: Card | undefined; index: BanlistIndex }): JSX.Element {
  const limit = limitLabel(index, entry.name);
  const stats =
    card && (card.atk !== undefined || card.def !== undefined) ? `${card.atk ?? "?"}/${card.def ?? "?"}` : "—";
  return (
    <div className="row cols-deck" data-role="card-row">
      <span className="row__name" data-role="card-name" title={card?.desc}>
        {entry.name}
      </span>
      <span className="row__meta" data-role="card-type">
        {card ? typeLabel(card) : "UNKNOWN"}
      </span>
      <span className={stats === "—" ? "row__num muted" : "row__num"} data-role="card-stats">
        {stats}
      </span>
      <span className={limit.limited ? "row__limit row__limit--set" : "row__limit"} data-role="card-limit">
        {limit.text}
      </span>
      <span className="row__copies" data-role="card-copies">
        ×{entry.copies}
      </span>
    </div>
  );
}

export function Build(): JSX.Element {
  const { status, retry, pool, build, buildStatus, rebuild, config, setExtraDeckSize, totalCopies } = useStore();
  const index = useMemo(() => new BanlistIndex(banlist), []);

  const grouped = useMemo(() => {
    const groups: Record<Group, DeckEntry[]> = { monster: [], spell: [], trap: [] };
    for (const entry of build?.deck.main ?? []) {
      groups[groupOf(pool?.index.get(normalizeName(entry.name)))].push(entry);
    }
    for (const list of Object.values(groups)) list.sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name));
    return groups;
  }, [build, pool]);

  const copyCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of build?.deck.main ?? []) counts.set(entry.copies, (counts.get(entry.copies) ?? 0) + 1);
    return counts;
  }, [build]);

  const validation = build?.validation;
  const mainCount = build?.mainCount ?? 0;
  const sizePct = Math.min(100, (mainCount / config.maxMain) * 100);
  const tierWarning = validation?.allowance.tiers.find((t) => t.used === t.budget && t.budget > 0);
  const extraCount = countCopies(build?.deck.extra ?? []);

  const loading = status === "loading" || buildStatus === "loading";

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="build" />

      <div
        className="panel"
        style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-end", padding: "16px 20px" }}
        data-role="build-header"
      >
        <div>
          <div className="label">Assembled from your collection</div>
          <h1 className="h1" style={{ marginTop: 6 }} data-role="deck-name">
            {build?.template?.name ?? "No deck yet"}
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 22, alignItems: "flex-end" }}>
          <div>
            <div className="stat" style={{ fontSize: "var(--t-26)" }} data-role="deck-power-score">
              {build ? build.powerScore.toFixed(1) : "—"}
            </div>
            <div className="stat__label">power score</div>
          </div>
          <div>
            <div className="stat" style={{ fontSize: "var(--t-26)" }} data-role="deck-size">
              {mainCount}
            </div>
            <div className="stat__label">main deck</div>
          </div>
          <button className="btn" type="button" data-role="rebuild-button" onClick={rebuild}>
            Rebuild
          </button>
        </div>
      </div>

      <div className="body">
        <main className="main" data-role="deck-region">
          {loading && (
            <LoadingState data-role="deck-loading">
              SOLVING · {totalCopies} COPIES · 4 TIER CONSTRAINTS…
            </LoadingState>
          )}

          {!loading && buildStatus === "error" && (
            <ErrorNotice title="The solver failed." onRetry={rebuild} retryLabel="Run again">
              Nothing was written to your collection.
            </ErrorNotice>
          )}

          {status === "error" && (
            <ErrorNotice title="Card pool failed to load." onRetry={retry}>
              The deck below cannot be assembled until the pool loads.
            </ErrorNotice>
          )}

          {!loading && build && build.mainCount === 0 && (
            <EmptyState title="Nothing to build with yet.">
              The engine needs at least {config.minMain} owned copies.{" "}
              <a href={href("collection")}>Enter your collection.</a>
            </EmptyState>
          )}

          {!loading && build?.partial && build.mainCount > 0 && (
            <div className="notice notice--error" data-role="deck-error">
              <div className="notice__title">Partial deck — {build.mainCount} of {config.minMain}.</div>
              <div className="notice__body">{build.reason}</div>
            </div>
          )}

          {!loading && build && build.mainCount > 0 && (
            <div data-role="deck-list" data-deck="main">
              <div className="scroll" data-role="deck-scroll">
                <div className="ledger ledger--deck">
                  {(["monster", "spell", "trap"] as Group[]).map((group) =>
                    grouped[group].length === 0 ? null : (
                      <div data-role="deck-group" data-group={group} key={group}>
                        <div className="strip" data-role="group-head">
                          <span>{group[0]!.toUpperCase() + group.slice(1)}</span>
                          <span data-role="group-count">{countCopies(grouped[group])}</span>
                        </div>
                        {grouped[group].map((entry) => (
                          <DeckRow
                            entry={entry}
                            card={pool?.index.get(normalizeName(entry.name))}
                            index={index}
                            key={entry.name}
                          />
                        ))}
                      </div>
                    ),
                  )}

                  <div data-role="deck-list" data-deck="extra">
                    <div className="strip" data-role="group-head">
                      <span>Extra Deck</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span data-role="extra-count">
                          {extraCount}/<span data-role="extra-cap-value">{config.extraDeckSize}</span>
                        </span>
                        <button
                          className="btn btn--step"
                          type="button"
                          data-role="extra-cap-decrease"
                          aria-label="Decrease Extra Deck cap"
                          onClick={() => setExtraDeckSize(config.extraDeckSize - 1)}
                        >
                          −
                        </button>
                        <button
                          className="btn btn--step"
                          type="button"
                          data-role="extra-cap-increase"
                          aria-label="Increase Extra Deck cap"
                          onClick={() => setExtraDeckSize(config.extraDeckSize + 1)}
                        >
                          +
                        </button>
                      </span>
                    </div>
                    {build.deck.extra.length === 0 ? (
                      <div className="state state--loading" style={{ borderBottom: 0 }}>
                        NO EXTRA DECK CARDS OWNED FOR THIS BUILD
                      </div>
                    ) : (
                      build.deck.extra.map((entry) => (
                        <DeckRow
                          entry={entry}
                          card={pool?.index.get(normalizeName(entry.name))}
                          index={index}
                          key={entry.name}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className="side" data-role="legality-panel">
          <div className="side__sticky">
            <div className="panel">
              <div className="label">Legality</div>
              <div
                style={{ marginTop: 8, fontSize: "var(--t-15)", fontWeight: 600 }}
                data-role="legality-status"
                data-state={validation?.legal ? "legal" : "illegal"}
              >
                {!build
                  ? "Waiting for a build"
                  : validation?.legal
                    ? "Legal · ranked play"
                    : `Illegal · ${validation?.violations.length} issue${validation?.violations.length === 1 ? "" : "s"}`}
              </div>
              <div style={{ marginTop: 12 }} data-role="deck-size-meter">
                <div
                  className="mono muted"
                  style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-11)" }}
                >
                  <span>MAIN DECK</span>
                  <span data-role="deck-size-value">
                    {mainCount} / {config.minMain}–{config.maxMain}
                  </span>
                </div>
                <div className="meter">
                  <div className="meter__fill" style={{ width: `${sizePct}%` }} />
                  <div className="meter__gap" />
                </div>
                <div className="stat__label">
                  {mainCount === config.minMain
                    ? "At minimum size. Every extra card dilutes the opening four."
                    : mainCount > config.maxMain
                      ? "Over the legal maximum."
                      : `${config.maxMain - mainCount} cards below the maximum.`}
                </div>
              </div>
            </div>

            {tierWarning && validation?.legal && (
              <div className="notice" data-role="legality-warning">
                <div className="notice__title">Limited {tierWarning.tier} allowance fully spent</div>
                <div className="notice__body">
                  Adding any other Limited {tierWarning.tier} card means cutting{" "}
                  {tierWarning.slots.map((s) => s.name).join(" or ")}.
                </div>
              </div>
            )}

            {validation?.violations.map((violation) => (
              <div className="notice notice--error" data-role="legality-error" key={violation.code + violation.message}>
                <div className="notice__title">
                  {violation.code === "tier-budget"
                    ? `Illegal: Limited ${violation.tier} over budget`
                    : violation.code === "forbidden"
                      ? "Illegal: Forbidden card"
                      : violation.code === "copy-limit"
                        ? "Illegal: too many copies"
                        : "Deck size"}
                </div>
                <div className="notice__body">{violation.message}</div>
              </div>
            ))}

            {validation && <AllowanceRail allowance={validation.allowance} note={ALLOWANCE_NOTE} />}

            {build && build.mainCount > 0 && (
              <div data-role="copy-count-panel" style={{ borderBottom: "1px solid var(--ink)" }}>
                <div className="strip strip--bar">Copy counts</div>
                {[3, 2, 1].map((n) => (
                  <div
                    className="row"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      height: "auto",
                      padding: "6px 16px",
                      fontSize: "var(--t-12)",
                    }}
                    data-role="copy-count-row"
                    key={n}
                  >
                    <span>Cards at {n} cop{n === 1 ? "y" : "ies"}</span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {copyCounts.get(n) ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: "14px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn--primary" href={href("upgrade")} data-role="upgrade-link">
                Upgrade path →
              </a>
              <a
                className="btn"
                href={build?.template ? href("strategy", build.template.id) : href("strategy")}
                data-role="strategy-link"
              >
                Strategy
              </a>
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
