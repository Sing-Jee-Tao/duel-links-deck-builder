/**
 * Screen 01 — Collection.
 *
 * The player searches the whole pool and sets owned quantity 0–3 per card. This
 * is the highest-traffic screen, so the row is optimized for repetition: one
 * click cycles the quantity, keys 0–3 set it directly, and nothing else moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllowanceRail, ALLOWANCE_NOTE } from "../components/Allowance.tsx";
import { Masthead, ScreenNav, Shell } from "../components/Chrome.tsx";
import { EmptyState, ErrorNotice, LoadingState } from "../components/States.tsx";
import { banlist } from "../data/index.ts";
import { BanlistIndex, normalizeName } from "../engine/banlist-index.ts";
import type { Card } from "../data/types.ts";
import { href } from "../state/router.ts";
import { MAX_COPIES, useStore, type Quantity } from "../state/store.tsx";

const PAGE_SIZE = 100;
const PIPS = ["○○○", "●○○", "●●○", "●●●"] as const;
const TYPES = ["All", "Monster", "Spell", "Trap"] as const;
const ATTRIBUTES = ["All", "DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"] as const;
const LEVELS = ["All", "1–4", "5–6", "7+"] as const;

type TypeFilter = (typeof TYPES)[number];
type AttributeFilter = (typeof ATTRIBUTES)[number];
type LevelFilter = (typeof LEVELS)[number];

interface Filters {
  type: TypeFilter;
  attribute: AttributeFilter;
  level: LevelFilter;
  archetype: string;
  ownedOnly: boolean;
}

const EMPTY_FILTERS: Filters = {
  type: "All",
  attribute: "All",
  level: "All",
  archetype: "",
  ownedOnly: false,
};

function broadType(card: Card): "Monster" | "Spell" | "Trap" {
  if (card.type.includes("Spell")) return "Spell";
  if (card.type.includes("Trap")) return "Trap";
  return "Monster";
}

function matchesLevel(card: Card, level: LevelFilter): boolean {
  if (level === "All") return true;
  if (card.level === undefined) return false;
  if (level === "1–4") return card.level <= 4;
  if (level === "5–6") return card.level >= 5 && card.level <= 6;
  return card.level >= 7;
}

/** Short type label for the ledger's Type column, e.g. "MONSTER/EFFECT". */
export function typeLabel(card: Card): string {
  const broad = broadType(card);
  if (broad === "Monster") {
    const kind = card.type.replace(/\s*Monster$/, "").toUpperCase() || "NORMAL";
    return `MONSTER/${kind}`;
  }
  return `${broad.toUpperCase()}/${card.race.toUpperCase()}`;
}

export function limitLabel(index: BanlistIndex, name: string): { text: string; limited: boolean } {
  if (index.isForbidden(name)) return { text: "FB", limited: true };
  const tier = index.tier(name);
  return tier === null ? { text: "—", limited: false } : { text: `L${tier}`, limited: true };
}

function QuantityControl({
  card,
  copies,
  onSet,
}: {
  card: Card;
  copies: number;
  onSet: (copies: Quantity) => void;
}): JSX.Element {
  return (
    <button
      className="qty"
      type="button"
      data-role="owned-quantity"
      data-quantity={copies}
      title="Click to cycle 0 → 3"
      aria-label={`Owned copies of ${card.name}: ${copies}`}
      onClick={() => onSet((((copies + 1) % (MAX_COPIES + 1)) as Quantity))}
      onKeyDown={(event) => {
        if (/^[0-3]$/.test(event.key)) {
          event.preventDefault();
          onSet(Number(event.key) as Quantity);
        }
      }}
    >
      <span data-role="quantity-value">{copies}</span>
      <span className="qty__track" data-role="quantity-track" aria-hidden="true">
        {PIPS[copies] ?? PIPS[0]}
      </span>
    </button>
  );
}

export function Collection(): JSX.Element {
  const { status, error, retry, pool, collection, setQuantity, distinctOwned, totalCopies, savedAt, saveState, build } =
    useStore();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [cursor, setCursor] = useState(0);
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => new BanlistIndex(banlist), []);
  const cards = pool?.cards ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const archetype = filters.archetype.trim().toLowerCase();
    return cards.filter((card) => {
      if (needle && !card.name.toLowerCase().includes(needle) && !card.desc.toLowerCase().includes(needle)) {
        return false;
      }
      if (filters.type !== "All" && broadType(card) !== filters.type) return false;
      if (filters.attribute !== "All" && card.attribute !== filters.attribute) return false;
      if (!matchesLevel(card, filters.level)) return false;
      if (archetype && !(card.archetype ?? "").toLowerCase().includes(archetype)) return false;
      if (filters.ownedOnly && !(collection.get(card.id) ?? 0)) return false;
      return true;
    });
  }, [cards, collection, filters, query]);

  // Type-ahead is name-only and short: it is a jump target, not the ledger.
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return cards.filter((card) => card.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [cards, query]);

  useEffect(() => setVisible(PAGE_SIZE), [query, filters]);
  useEffect(() => setCursor(0), [query]);

  const archetypes = useMemo(() => {
    const set = new Set<string>();
    for (const card of cards) if (card.archetype) set.add(card.archetype);
    return [...set].sort((a, b) => a.localeCompare(b)).slice(0, 400);
  }, [cards]);

  const setCardQuantity = useCallback(
    (card: Card, copies: Quantity) => setQuantity(card.id, card.name, copies),
    [setQuantity],
  );

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(suggestions.length - 1, c + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const card = suggestions[cursor];
      if (card) setCardQuantity(card, Math.min(MAX_COPIES, (collection.get(card.id) ?? 0) + 1) as Quantity);
    } else if (/^[0-3]$/.test(event.key) && event.altKey) {
      event.preventDefault();
      const card = suggestions[cursor];
      if (card) setCardQuantity(card, Number(event.key) as Quantity);
    } else if (event.key === "Escape") {
      setTypeaheadOpen(false);
    }
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.ownedOnly) chips.push({ label: "OWNED ≥ 1", clear: () => setFilters((f) => ({ ...f, ownedOnly: false })) });
  if (filters.type !== "All") chips.push({ label: filters.type.toUpperCase(), clear: () => setFilters((f) => ({ ...f, type: "All" })) });
  if (filters.attribute !== "All") chips.push({ label: filters.attribute, clear: () => setFilters((f) => ({ ...f, attribute: "All" })) });
  if (filters.level !== "All") chips.push({ label: `LV ${filters.level}`, clear: () => setFilters((f) => ({ ...f, level: "All" })) });
  if (filters.archetype) chips.push({ label: filters.archetype.toUpperCase(), clear: () => setFilters((f) => ({ ...f, archetype: "" })) });

  const shown = filtered.slice(0, visible);
  const saveLabel =
    saveState === "saving"
      ? "SAVING…"
      : saveState === "error"
        ? "SAVE FAILED"
        : savedAt
          ? `SAVED ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · LOCAL`
          : "NOT SAVED YET · LOCAL";

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="collection" />

      <div className="body">
        <main className="main">
          <section className="search" data-role="search-region">
            <label className="label" htmlFor="card-search" style={{ display: "block", marginBottom: 6 }}>
              Search pool · {pool ? pool.cards.length.toLocaleString("en-GB") : "—"} cards
            </label>
            <input
              className="field field--search"
              id="card-search"
              data-role="search-input"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder="Card name, archetype or effect text"
              ref={searchRef}
              onChange={(event) => {
                setQuery(event.target.value);
                setTypeaheadOpen(true);
              }}
              onFocus={() => setTypeaheadOpen(true)}
              onKeyDown={onSearchKeyDown}
            />
            {typeaheadOpen && suggestions.length > 0 && (
              <div className="typeahead" data-role="typeahead">
                <div className="typeahead__status" data-role="typeahead-status">
                  <span>
                    {suggestions.length}
                    {suggestions.length === 8 ? "+" : ""} MATCH{suggestions.length === 1 ? "" : "ES"}
                  </span>
                  <span>↑↓ MOVE · ALT+0–3 SET · ↵ ADD</span>
                </div>
                {suggestions.map((card, i) => {
                  const limit = limitLabel(index, card.name);
                  return (
                    <button
                      className="typeahead__result"
                      type="button"
                      key={card.id}
                      data-role="typeahead-result"
                      {...(i === cursor ? { "data-selected": "true" } : {})}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() =>
                        setCardQuantity(card, Math.min(MAX_COPIES, (collection.get(card.id) ?? 0) + 1) as Quantity)
                      }
                    >
                      <span className="row__name" data-role="card-name">
                        {card.name}
                      </span>
                      <span className="row__meta" data-role="card-meta">
                        {typeLabel(card)} · OWN {collection.get(card.id) ?? 0}
                      </span>
                      <span
                        className={limit.limited ? "row__limit row__limit--set" : "row__limit"}
                        data-role="card-limit"
                      >
                        {limit.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="filters" data-role="filter-bar">
            <div className="field-group">
              <label className="field-group__label" htmlFor="f-type">
                Type
              </label>
              <select
                className="field"
                id="f-type"
                data-role="filter-type"
                value={filters.type}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TypeFilter }))}
              >
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-group__label" htmlFor="f-attr">
                Attribute
              </label>
              <select
                className="field"
                id="f-attr"
                data-role="filter-attribute"
                value={filters.attribute}
                onChange={(e) => setFilters((f) => ({ ...f, attribute: e.target.value as AttributeFilter }))}
              >
                {ATTRIBUTES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-group__label" htmlFor="f-level">
                Level
              </label>
              <select
                className="field"
                id="f-level"
                data-role="filter-level"
                value={filters.level}
                onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as LevelFilter }))}
              >
                {LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field-group" style={{ flex: "1 1 160px" }}>
              <label className="field-group__label" htmlFor="f-arch">
                Archetype
              </label>
              <input
                className="field"
                id="f-arch"
                list="arch-list"
                data-role="filter-archetype"
                placeholder="Any"
                value={filters.archetype}
                onChange={(e) => setFilters((f) => ({ ...f, archetype: e.target.value }))}
              />
              <datalist id="arch-list">
                {archetypes.map((a) => (
                  <option value={a} key={a} />
                ))}
              </datalist>
            </div>
            <div data-role="active-filters" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {!filters.ownedOnly && (
                <button
                  className="chip"
                  type="button"
                  style={{ background: "none" }}
                  onClick={() => setFilters((f) => ({ ...f, ownedOnly: true }))}
                >
                  OWNED ≥ 1
                </button>
              )}
              {chips.map((chip) => (
                <button className="chip" type="button" data-role="filter-chip" key={chip.label} onClick={chip.clear}>
                  {chip.label} ×
                </button>
              ))}
            </div>
          </section>

          <section data-role="collection-list-region">
            {status === "loading" && <LoadingState>READING POOL…</LoadingState>}

            {status === "error" && (
              <ErrorNotice title="Card pool failed to load." onRetry={retry}>
                {error ?? "The bundled card data could not be read."} Your owned quantities are saved locally and
                untouched.
              </ErrorNotice>
            )}

            {status === "ready" && filtered.length === 0 && (
              <EmptyState title="No cards match these filters.">
                Clear the archetype field, or widen the level band.
              </EmptyState>
            )}

            {status === "ready" && filtered.length > 0 && (
              <div className="scroll" data-role="ledger-scroll">
                <div className="ledger">
                  <div className="ledger__head cols-collection" data-role="ledger-head">
                    <span>Card</span>
                    <span>Type</span>
                    <span>Attr</span>
                    <span style={{ textAlign: "right" }}>Lv</span>
                    <span style={{ textAlign: "right" }}>ATK/DEF</span>
                    <span style={{ textAlign: "center" }}>Lim</span>
                    <span style={{ textAlign: "center" }}>Owned</span>
                  </div>
                  {shown.map((card) => {
                    const limit = limitLabel(index, card.name);
                    const copies = collection.get(card.id) ?? 0;
                    return (
                      <div
                        className="row cols-collection"
                        data-role="card-row"
                        data-card-id={normalizeName(card.name)}
                        key={card.id}
                      >
                        <span className="row__name" data-role="card-name" title={card.desc}>
                          {card.name}
                        </span>
                        <span className="row__meta" data-role="card-type">
                          {typeLabel(card)}
                        </span>
                        <span className="row__meta" data-role="card-attribute">
                          {card.attribute ?? "—"}
                        </span>
                        <span className="row__num" data-role="card-level">
                          {card.level ?? "—"}
                        </span>
                        <span className="row__num" data-role="card-stats">
                          {card.atk === undefined && card.def === undefined
                            ? "—"
                            : `${card.atk ?? "?"}/${card.def ?? "?"}`}
                        </span>
                        <span
                          className={limit.limited ? "row__limit row__limit--set" : "row__limit"}
                          data-role="card-limit"
                        >
                          {limit.text}
                        </span>
                        <span style={{ padding: "0 6px" }}>
                          <QuantityControl card={card} copies={copies} onSet={(n) => setCardQuantity(card, n)} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 20px",
                background: "var(--panel)",
              }}
            >
              <span className="mono muted" style={{ fontSize: "var(--t-11)" }} data-role="pagination-status">
                SHOWING {shown.length.toLocaleString("en-GB")} OF {filtered.length.toLocaleString("en-GB")} FILTERED
              </span>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {visible < filtered.length && (
                  <button className="btn" type="button" onClick={() => setVisible((v) => v + PAGE_SIZE * 5)}>
                    Show more
                  </button>
                )}
                <a
                  className="btn btn--primary"
                  href={href("build")}
                  data-role="build-button"
                  {...(totalCopies === 0 ? { "aria-disabled": "true" as const } : {})}
                >
                  Build strongest deck →
                </a>
              </span>
            </div>
          </section>
        </main>

        <aside className="side" data-role="totals-column">
          <div className="side__sticky">
            <div className="panel">
              <div className="label">Collection totals</div>
              <div style={{ display: "flex", gap: 22, marginTop: 10 }}>
                <div>
                  <div className="stat" data-role="distinct-total">
                    {distinctOwned}
                  </div>
                  <div className="stat__label">distinct cards</div>
                </div>
                <div>
                  <div className="stat" data-role="copies-total">
                    {totalCopies}
                  </div>
                  <div className="stat__label">total copies</div>
                </div>
              </div>
              <div
                className="mono muted"
                style={{
                  fontSize: "var(--t-11)",
                  marginTop: 12,
                  borderTop: "1px solid var(--rule)",
                  paddingTop: 8,
                }}
                data-role="session-status"
              >
                {saveLabel}
              </div>
            </div>

            {build && (
              <AllowanceRail allowance={build.validation.allowance} note={ALLOWANCE_NOTE} />
            )}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
