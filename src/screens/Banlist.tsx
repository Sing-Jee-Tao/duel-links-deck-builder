/**
 * Screen 05 — Banlist status.
 *
 * The stale warning is the point of this screen: when the weekly refresh has not
 * run, the tool says so rather than quietly checking decks against an old list.
 */
import { useMemo, useState } from "react";
import { Masthead, ScreenNav, Shell } from "../components/Chrome.tsx";
import { EmptyState, ErrorNotice, LoadingState } from "../components/States.tsx";
import { banlist, banlistAgeDays, isBanlistStale, STALE_AFTER_DAYS } from "../data/index.ts";
import { normalizeName } from "../engine/banlist-index.ts";
import { useStore } from "../state/store.tsx";

type TierKey = "forbidden" | "limited1" | "limited2" | "limited3";

const TIERS: { key: TierKey; label: string; tier: string; budget: number }[] = [
  { key: "forbidden", label: "Forbidden", tier: "forbidden", budget: 0 },
  { key: "limited1", label: "Limited 1", tier: "1", budget: 1 },
  { key: "limited2", label: "Limited 2", tier: "2", budget: 2 },
  { key: "limited3", label: "Limited 3", tier: "3", budget: 3 },
];

const ROWS_PER_TIER = 25;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "UNKNOWN"
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

export function Banlist(): JSX.Element {
  const { status, retry, pool, collection, build } = useStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const ownedByName = useMemo(() => {
    const map = new Map<string, number>();
    if (!pool) return map;
    for (const [id, copies] of collection) {
      const card = pool.byId.get(id);
      if (card) map.set(normalizeName(card.name), copies);
    }
    return map;
  }, [collection, pool]);

  const inDeck = useMemo(() => {
    const set = new Set<string>();
    for (const entry of [...(build?.deck.main ?? []), ...(build?.deck.extra ?? [])]) {
      set.add(normalizeName(entry.name));
    }
    return set;
  }, [build]);

  const spentByTier = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const tier of build?.validation.allowance.tiers ?? []) {
      map.set(String(tier.tier), tier.slots.map((s) => s.name));
    }
    return map;
  }, [build]);

  const stale = isBanlistStale();
  const ageDays = Math.floor(banlistAgeDays());

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="banlist" />

      <div
        className="panel"
        style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-end", padding: "16px 20px" }}
        data-role="banlist-header"
      >
        <div>
          <h1 className="h1">Forbidden &amp; Limited</h1>
          <div
            className="mono muted"
            style={{ fontSize: "var(--t-11)", letterSpacing: ".06em", marginTop: 6 }}
            data-role="banlist-effective"
          >
            SOURCE: {banlist.source.toUpperCase()} · DUELLINKSMETA
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: "var(--t-12)", fontWeight: 600 }} data-role="last-updated">
            CHECKED {formatDate(banlist.scrapedAt)}
          </div>
          <div className="stat__label">automatic refresh, weekly in CI</div>
        </div>
      </div>

      {stale && (
        <div
          className="notice notice--error"
          style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", alignItems: "center", padding: "12px 20px" }}
          data-role="stale-warning"
        >
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div className="notice__title">Refresh is {ageDays} days stale.</div>
            <div className="notice__body" style={{ fontSize: "var(--t-13)" }}>
              The list bundled with this build was scraped on {formatDate(banlist.scrapedAt)}, more than{" "}
              {STALE_AFTER_DAYS} days ago. Legality checks on Build and Upgrade are still running against it —
              treat any result as provisional until a newer build ships.
            </div>
          </div>
        </div>
      )}

      <div
        style={{ borderBottom: "1px solid var(--ink)", background: "var(--panel)", padding: "14px 20px" }}
        data-role="allowance-explainer"
      >
        <p style={{ margin: 0, maxWidth: "74ch", fontSize: 14, lineHeight: 1.5, textWrap: "pretty" }}>
          A tier is an allowance, not a per-card rule. <strong>You may run one card total from the Limited 1 pool</strong>,
          two from Limited 2, three from Limited 3 — a single copy each, drawn from the whole pool. Picking one card
          in a tier spends the slot for every other card in it.
        </p>
      </div>

      {status === "loading" && <LoadingState data-role="banlist-loading">FETCHING LIST…</LoadingState>}

      {status === "error" && (
        <ErrorNotice title="Could not read the card pool." onRetry={retry} data-role="banlist-error">
          The banlist below is the copy committed with this build; owned counts are unavailable until the pool
          loads.
        </ErrorNotice>
      )}

      <div className="tiers" data-role="banlist-region">
        {TIERS.map(({ key, label, tier, budget }) => {
          const names = banlist[key];
          const isOpen = expanded[key] ?? false;
          const shown = isOpen ? names : names.slice(0, ROWS_PER_TIER);
          const spent = spentByTier.get(tier) ?? [];

          return (
            <section className="tier" data-role="banlist-tier" data-tier={tier} key={key}>
              <div className={key === "forbidden" ? "strip strip--redline" : "strip"}>
                <span>{label}</span>
                <span data-role="tier-count">{names.length} cards</span>
              </div>

              <div className={key === "forbidden" ? "tier__note tier__note--forbidden" : "tier__note"}>
                {key === "forbidden" ? (
                  "Not playable in any quantity."
                ) : (
                  <>
                    <strong>
                      {budget} slot{budget === 1 ? "" : "s"}
                    </strong>{" "}
                    shared by all {names.length}. Yours:{" "}
                    <span className="num" style={{ fontWeight: 600 }} data-role="tier-spent">
                      {spent.length === 0 ? "none spent" : spent.join(", ")}
                    </span>
                  </>
                )}
              </div>

              {names.length === 0 ? (
                <EmptyState title="No cards in this tier.">Konami has emptied the pool in this revision.</EmptyState>
              ) : (
                <>
                  {shown.map((name) => {
                    const key2 = normalizeName(name);
                    const owned = ownedByName.get(key2) ?? 0;
                    const used = inDeck.has(key2);
                    return (
                      <div
                        className={used ? "row cols-banlist row--in-deck" : "row cols-banlist"}
                        data-role="banlist-row"
                        {...(used ? { "data-in-deck": "true" } : {})}
                        key={name}
                      >
                        <span className="row__name" data-role="card-name">
                          {name}
                        </span>
                        <span
                          className="row__meta"
                          data-role="card-owned"
                          {...(used ? { style: { color: "var(--ochre)", fontWeight: 600 } } : {})}
                        >
                          {used ? "IN DECK" : `OWN ${owned}`}
                        </span>
                      </div>
                    );
                  })}
                  {names.length > ROWS_PER_TIER && (
                    <div style={{ padding: "10px 12px" }}>
                      <button
                        className="btn--link"
                        type="button"
                        style={{ borderBottomColor: "var(--ochre)", color: "var(--ochre)" }}
                        onClick={() => setExpanded((e) => ({ ...e, [key]: !isOpen }))}
                      >
                        {isOpen ? "Show fewer" : `Show all ${names.length}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>

      <div
        style={{ padding: "14px 20px 40px", display: "flex", flexWrap: "wrap", gap: "8px 20px", alignItems: "baseline" }}
        data-role="banlist-history"
      >
        <span className="label">Data provenance</span>
        <span className="mono muted" style={{ fontSize: "var(--t-12)" }} data-role="revision-link">
          SCRAPED {formatDate(banlist.scrapedAt)} · {banlist.forbidden.length + banlist.limited1.length + banlist.limited2.length + banlist.limited3.length} ENTRIES
        </span>
        <span className="mono muted" style={{ fontSize: "var(--t-12)" }}>
          OVERRIDES: {banlist.source === "override" ? "APPLIED" : "NONE"}
        </span>
      </div>
    </Shell>
  );
}
