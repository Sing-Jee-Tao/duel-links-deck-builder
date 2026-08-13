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
import { banlist, templates } from "../data/index.ts";
import type { Card, DeckTemplate } from "../data/types.ts";
import { BanlistIndex } from "../engine/banlist-index.ts";
import { countCopies } from "../engine/validator.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";

/** Stable identity so the mention memo does not invalidate on every render. */
const EMPTY_CARDS: ReadonlyMap<string, Card> = new Map();

/** Finds the longest card name mentioned in a line of prose. */
function mentionedCard(text: string, cards: ReadonlyMap<string, Card>): Card | null {
  let best: Card | null = null;
  for (const card of cards.values()) {
    if (card.name.length < 5) continue;
    if (!text.includes(card.name)) continue;
    if (!best || card.name.length > best.name.length) best = card;
  }
  return best;
}

/** Bolds the mentioned card name, as the design does with <strong>. */
function withEmphasis(text: string, card: Card | null): JSX.Element {
  if (!card) return <>{text}</>;
  const at = text.indexOf(card.name);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong>{card.name}</strong>
      {text.slice(at + card.name.length)}
    </>
  );
}

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

export function Strategy({ selected }: { selected: string | null }): JSX.Element {
  const { status, pool, build } = useStore();
  const [ruling, setRuling] = useState<Card | null>(null);
  const index = useMemo(() => new BanlistIndex(banlist), []);

  const template: DeckTemplate | null =
    templates.find((t) => t.id === selected) ?? build?.template ?? templates[0] ?? null;

  const cards = pool?.index ?? EMPTY_CARDS;
  const close = useCallback(() => setRuling(null), []);

  // Scanning the pool for a mentioned card is O(pool) per line, so resolve every
  // line once per template rather than on each render.
  const mentions = useMemo(() => {
    const map = new Map<string, Card | null>();
    if (!template) return map;
    for (const line of [...template.strategy.openingPriorities, ...template.strategy.keyInteractions]) {
      map.set(line, mentionedCard(line, cards));
    }
    return map;
  }, [cards, template]);

  const readTime = template
    ? Math.max(
        1,
        Math.round(
          [
            template.strategy.gamePlan,
            ...template.strategy.openingPriorities,
            ...template.strategy.keyInteractions,
            ...template.strategy.matchups.map((m) => m.notes),
          ]
            .join(" ")
            .split(/\s+/).length / 200,
        ),
      )
    : 0;

  const allowanceSpent = build?.validation.allowance;

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
              <EmptyState title="No guide has been written for this deck yet." />
            </div>
          )}

          {status !== "loading" && template && (
            <>
              <div className="insert__head">
                <div>
                  <div className="label">
                    Strategy insert · list of{" "}
                    {new Date(banlist.scrapedAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
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
                  READ TIME {readTime} MIN
                </div>
              </div>

              <div className="insert__body" data-role="strategy-body">
                <div className="prose">
                  <section className="section" data-role="strategy-section" data-section="game-plan">
                    <h2 className="section__head">Game plan</h2>
                    <p style={{ marginBottom: 0 }}>{template.strategy.gamePlan}</p>
                  </section>

                  <section className="section" data-role="strategy-section" data-section="opening-priorities">
                    <h2 className="section__head">Opening priorities</h2>
                    {template.strategy.openingPriorities.map((line, i) => {
                      const card = mentions.get(line) ?? null;
                      return (
                        <div className="listrow" data-role="priority-row" key={line}>
                          <span className="listrow__rank" data-role="priority-rank">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>{withEmphasis(line, card)}</span>
                        </div>
                      );
                    })}
                  </section>

                  <section className="section" data-role="strategy-section" data-section="key-interactions">
                    <h2 className="section__head">Key interactions</h2>
                    {template.strategy.keyInteractions.map((line) => {
                      const card = mentions.get(line) ?? null;
                      return (
                        <div className="listrow listrow--interaction" data-role="interaction-row" key={line}>
                          <span>{withEmphasis(line, card)}</span>
                          {card && (
                            <button
                              className="btn btn--mini"
                              type="button"
                              data-role="ruling-button"
                              onClick={() => setRuling(card)}
                            >
                              RULING
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </section>

                  <section
                    className="section"
                    style={{ marginBottom: 0 }}
                    data-role="strategy-section"
                    data-section="matchups"
                  >
                    <h2 className="section__head">Common matchups</h2>
                    {template.strategy.matchups.map((matchup) => (
                      <div className="listrow listrow--matchup" data-role="matchup-row" key={matchup.against}>
                        <span className="listrow__name" data-role="matchup-name">
                          {matchup.against}
                        </span>
                        <span
                          className={
                            matchup.winRate !== undefined && matchup.winRate < 50 ? "winrate winrate--bad" : "winrate"
                          }
                          data-role="matchup-winrate"
                        >
                          {matchup.winRate !== undefined ? `${matchup.winRate}%` : "—"}
                        </span>
                        <span className="listrow__note">{matchup.notes}</span>
                      </div>
                    ))}
                  </section>
                </div>

                <aside className="margin-col" data-role="strategy-margin">
                  <div className="label" style={{ fontSize: "var(--t-10)", letterSpacing: ".12em" }}>
                    This deck at a glance
                  </div>
                  <div className="margin-col__row" data-role="margin-stat">
                    <span>Main deck</span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {build?.template?.id === template.id
                        ? build.mainCount
                        : countCopies(template.coreCards) +
                          template.flexSlots.reduce((sum, s) => sum + s.count, 0)}
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
                  <div
                    className="label"
                    style={{ fontSize: "var(--t-10)", letterSpacing: ".12em", marginTop: 16 }}
                  >
                    Author
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: "var(--t-12)", lineHeight: 1.5, color: "var(--ink-2)" }}>
                    Hand-authored guidance, checked against the Forbidden &amp; Limited list scraped{" "}
                    {new Date(banlist.scrapedAt).toLocaleDateString("en-GB")}. Win rates are the author's
                    estimates, not measured play data.
                  </p>
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
            <span className="label">Other guides</span>
            {templates
              .filter((t) => t.id !== template?.id)
              .map((t) => (
                <a key={t.id} href={href("strategy", t.id)} style={{ fontSize: "var(--t-12)" }}>
                  {t.name.toUpperCase()}
                </a>
              ))}
          </div>
        )}
      </div>

      {ruling && <RulingModal card={ruling} index={index} onClose={close} />}
    </Shell>
  );
}
