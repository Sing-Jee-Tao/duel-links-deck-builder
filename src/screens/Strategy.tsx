/**
 * Screen 04 — Strategy: long-form editorial inside a data tool, resolved by
 * changing the substrate. The prose sits on a printed insert laid on the desk
 * background, with the tool voice confined to the mono margin column.
 *
 * The RULING modal shows the card's own effect text from `data/cards.json`
 * together with its current limit tier — real data rather than invented rulings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Masthead, ScreenNav, Shell } from "../components/Chrome.tsx";
import { EmptyState, LoadingState } from "../components/States.tsx";
import { banlist } from "../data/index.ts";
import type { Card, DeckTemplate, TemplateProvenance } from "../data/types.ts";
import { BanlistIndex, normalizeName } from "../engine/banlist-index.ts";
import { countCopies } from "../engine/validator.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";

/** Stable identity so a null-pool render does not invalidate consumers. */
const EMPTY_CARDS: ReadonlyMap<string, Card> = new Map();

function RulingModal({ card, index, onClose }: { card: Card; index: BanlistIndex; onClose: () => void }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);

  // Focus trap: the design's modal needs one in production.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    box?.querySelector<HTMLElement>("[data-role='modal-close']")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !box) return;
      const focusable = box.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  const tier = index.tier(card.name);
  const status = index.isForbidden(card.name)
    ? "FORBIDDEN · NOT PLAYABLE"
    : tier === null
      ? "UNLIMITED · 3 COPIES ALLOWED"
      : `LIMITED ${tier} · SHARED POOL · SPENDS 1 OF ${tier} SLOT${tier === 1 ? "" : "S"}`;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Card text · ${card.name}`}
      data-role="ruling-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__box" ref={boxRef}>
        <div className="modal__head">
          <span>Card text · {card.name}</span>
          <button className="modal__close" type="button" data-role="modal-close" aria-label="Close" onClick={onClose}>
            ESC
          </button>
        </div>
        <div className="modal__body">
          <p
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-read)",
              fontSize: "var(--t-17)",
              lineHeight: 1.5,
            }}
          >
            {card.desc}
          </p>
          <p className="mono muted" style={{ margin: 0, fontSize: "var(--t-11)" }}>
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The guide for a template nobody wrote a guide for.
 *
 * A derived template comes from counting tournament lists, and duellinksmeta
 * publishes no prose to lift for it — every `overview` field on the deck-type
 * endpoint is empty. Rather than inventing a game plan the data cannot support,
 * this shows what the corpus actually measured: which cards the lists run and
 * how often, which Skills they picked, and where to read a real list. The
 * margin column says where all of it came from.
 */
function DataGuide({
  template,
  meta,
  cards,
  onRuling,
  glance,
}: {
  template: DeckTemplate;
  meta: TemplateProvenance;
  cards: ReadonlyMap<string, Card>;
  onRuling: (card: Card) => void;
  glance: JSX.Element;
}): JSX.Element {
  const pct = (name: string): string => {
    const rate = meta.inclusion[name];
    return rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
  };

  const cardFor = (name: string): Card | undefined => cards.get(normalizeName(name));

  return (
    <>
      <div className="insert__head">
        <div>
          <div className="label">
            Data guide · {meta.deckCount} tournament list{meta.deckCount === 1 ? "" : "s"} · last{" "}
            {meta.windowDays} days
          </div>
          <h1 className="insert__title" data-role="strategy-deck-name">
            {template.name}
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <div
          className="mono muted"
          style={{ fontSize: "var(--t-11)", lineHeight: 1.6, textAlign: "right" }}
          data-role="strategy-meta"
        >
          TIER SCORE {template.tierScore}/10
          <br />
          NO WRITTEN GUIDE
        </div>
      </div>

      <div className="insert__body" data-role="strategy-body">
        <div className="prose">
          <section className="section" data-role="strategy-section" data-section="core">
            <h2 className="section__head">What every list runs</h2>
            {template.coreCards.map((entry) => {
              const card = cardFor(entry.name);
              return (
                <div className="listrow listrow--interaction" data-role="core-row" key={entry.name}>
                  <span>
                    <strong>{entry.name}</strong> ×{entry.copies} — in {pct(entry.name)} of lists
                  </span>
                  {card && (
                    <button
                      className="btn btn--mini"
                      type="button"
                      data-role="ruling-button"
                      onClick={() => onRuling(card)}
                    >
                      RULING
                    </button>
                  )}
                </div>
              );
            })}
          </section>

          <section className="section" data-role="strategy-section" data-section="flex">
            <h2 className="section__head">Where the lists disagree</h2>
            {template.flexSlots.length === 0 ? (
              <p style={{ marginBottom: 0 }}>
                Every list runs the same {template.coreCards.length} cards — there is nothing left to choose.
              </p>
            ) : (
              template.flexSlots.map((slot) => (
                <div className="listrow" data-role="flex-row" key={slot.role}>
                  <span className="listrow__rank" data-role="flex-count">
                    ×{slot.count}
                  </span>
                  <span>
                    <strong>{slot.role}</strong> —{" "}
                    {slot.candidates
                      .slice(0, 6)
                      .map((name) => `${name} (${pct(name)})`)
                      .join(", ")}
                    {slot.candidates.length > 6 ? `, +${slot.candidates.length - 6} more` : ""}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="section" style={{ marginBottom: 0 }} data-role="strategy-section" data-section="skills">
            <h2 className="section__head">Skills these lists ran</h2>
            {meta.skills.length === 0 ? (
              <p style={{ marginBottom: 0 }}>No Skill was recorded on these lists.</p>
            ) : (
              meta.skills.map((skill) => (
                <div className="listrow listrow--matchup" data-role="skill-row" key={skill.name}>
                  <span className="listrow__name" data-role="skill-name">
                    {skill.name}
                  </span>
                  <span className="winrate">
                    {Math.round((skill.count / meta.deckCount) * 100)}%
                  </span>
                  <span className="listrow__note">
                    {skill.count} of {meta.deckCount} list{meta.deckCount === 1 ? "" : "s"}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>

        <aside className="margin-col" data-role="strategy-margin">
          {glance}
          <div className="label" style={{ fontSize: "var(--t-10)", letterSpacing: ".12em", marginTop: 16 }}>
            Source
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "var(--t-12)", lineHeight: 1.5, color: "var(--ink-2)" }}>
            Derived by counting {meta.deckCount} tournament list{meta.deckCount === 1 ? "" : "s"} from the last{" "}
            {meta.windowDays} days. Nobody wrote a game plan for this deck — the percentages are measured, and
            everything else on this page is left out rather than invented.
          </p>
          {meta.sampleUrl && (
            <p style={{ margin: "8px 0 0", fontSize: "var(--t-12)", lineHeight: 1.5, color: "var(--ink-2)" }}>
              One of the lists:{" "}
              <a href={`https://www.duellinksmeta.com${meta.sampleUrl}`} rel="noreferrer noopener" target="_blank">
                duellinksmeta.com
              </a>
            </p>
          )}
          <a
            href={href("build")}
            style={{
              display: "inline-block",
              marginTop: 14,
              fontSize: "var(--t-12)",
              fontWeight: 600,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              textDecoration: "none",
              borderBottom: "1px solid var(--ink)",
            }}
          >
            Back to build
          </a>
        </aside>
      </div>
    </>
  );
}

export function Strategy({ selected }: { selected: string | null }): JSX.Element {
  const { status, pool, build, templates } = useStore();
  const [ruling, setRuling] = useState<Card | null>(null);

  const template: DeckTemplate | null =
    templates.find((t) => t.id === selected) ?? build?.template ?? templates[0] ?? null;

  const cards = pool?.index ?? EMPTY_CARDS;
  const close = useCallback(() => setRuling(null), []);
  const index = useMemo(() => new BanlistIndex(banlist), []);

  // `templates` arrives ranked, so the strongest few are simply the first few.
  const otherGuides = useMemo(
    () => templates.filter((t) => t.id !== template?.id).slice(0, 10),
    [template, templates],
  );

  const allowanceSpent = build?.validation.allowance;

  const glance = template ? (
    <>
      <div className="label" style={{ fontSize: "var(--t-10)", letterSpacing: ".12em" }}>
        This deck at a glance
      </div>
      <div className="margin-col__row" data-role="margin-stat">
        <span>Main deck</span>
        <span className="num" style={{ fontWeight: 600 }}>
          {build?.template?.id === template.id
            ? build.mainCount
            : countCopies(template.coreCards) + template.flexSlots.reduce((sum, s) => sum + s.count, 0)}
        </span>
      </div>
      <div className="margin-col__row" data-role="margin-stat">
        <span>Allowance spent</span>
        <span className="num" style={{ fontWeight: 600 }}>
          {allowanceSpent && build?.template?.id === template.id
            ? `${allowanceSpent.spent}/${allowanceSpent.total}`
            : "—"}
        </span>
      </div>
      <div className="margin-col__row" data-role="margin-stat">
        <span>Whole list</span>
        <span className="num" style={{ fontWeight: 600 }} data-role="margin-gems">
          {template.meta.gemsPrice > 0 ? `${template.meta.gemsPrice.toLocaleString("en-GB")}g` : "—"}
        </span>
      </div>
    </>
  ) : (
    <></>
  );

  return (
    <Shell>
      <Masthead />
      <ScreenNav current="strategy" />

      <div className="insert-desk">
        <article className="insert" data-role="strategy-document">
          {status === "loading" && (
            <div style={{ padding: 26 }}>
              <LoadingState style={{ border: 0, padding: 0 }} data-role="strategy-loading">
                LOADING GUIDE…
              </LoadingState>
            </div>
          )}

          {status !== "loading" && !template && (
            <div style={{ padding: 26 }}>
              <EmptyState title="No deck selected.">
                Pick a target on the <a href={href("upgrade")}>upgrade path</a>.
              </EmptyState>
            </div>
          )}

          {status !== "loading" && template && (
            <DataGuide
              template={template}
              meta={template.meta}
              cards={cards}
              onRuling={setRuling}
              glance={glance}
            />
          )}
        </article>

        {templates.length > 1 && (
          <div
            className="mono muted"
            style={{
              maxWidth: 820,
              margin: "18px auto 0",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 18px",
              fontSize: "var(--t-11)",
            }}
          >
            {/*
              There are ~71 decks. Listing them all would bury the page; Upgrade
              is where every deck is searchable and sortable, so this strip
              carries the strongest few and points at it.
            */}
            <span className="label">Other decks</span>
            {otherGuides.map((t) => (
              <a key={t.id} href={href("strategy", t.id)} style={{ fontSize: "var(--t-12)" }}>
                {t.name.toUpperCase()}
              </a>
            ))}
            {templates.length - 1 > otherGuides.length && (
              <a href={href("upgrade")} style={{ fontSize: "var(--t-12)" }}>
                +{templates.length - 1 - otherGuides.length} MORE →
              </a>
            )}
          </div>
        )}
      </div>

      {ruling && <RulingModal card={ruling} index={index} onClose={close} />}
    </Shell>
  );
}
