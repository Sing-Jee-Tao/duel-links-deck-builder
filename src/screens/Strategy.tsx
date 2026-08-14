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
import type { Card, DeckStrategy, DeckTemplate, TemplateProvenance } from "../data/types.ts";
import { BanlistIndex, normalizeName } from "../engine/banlist-index.ts";
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
  const index = useMemo(() => new BanlistIndex(banlist), []);

  const template: DeckTemplate | null =
    templates.find((t) => t.id === selected) ?? build?.template ?? templates[0] ?? null;
  const strategy: DeckStrategy | null = template?.strategy ?? null;

  const cards = pool?.index ?? EMPTY_CARDS;
  const close = useCallback(() => setRuling(null), []);

  // Scanning the pool for a mentioned card is O(pool) per line, so resolve every
  // line once per template rather than on each render.
  const mentions = useMemo(() => {
    const map = new Map<string, Card | null>();
    if (!strategy) return map;
    for (const line of [...strategy.openingPriorities, ...strategy.keyInteractions]) {
      map.set(line, mentionedCard(line, cards));
    }
    return map;
  }, [cards, strategy]);

  const readTime = strategy
    ? Math.max(
        1,
        Math.round(
          [
            strategy.gamePlan,
            ...strategy.openingPriorities,
            ...strategy.keyInteractions,
            ...strategy.matchups.map((m) => m.notes),
          ]
            .join(" ")
            .split(/\s+/).length / 200,
        ),
      )
    : 0;

  const allowanceSpent = build?.validation.allowance;

  /** Hand-authored guides first — they are the ones with prose to read. */
  const otherGuides = useMemo(
    () =>
      templates
        .filter((t) => t.id !== template?.id)
        .sort(
          (a, b) =>
            Number(b.source === "authored") - Number(a.source === "authored") ||
            b.tierScore - a.tierScore ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 10),
    [template, templates],
  );

  // Identical in both kinds of guide, so it is built once and handed to either.
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
              <EmptyState title="No guide has been written for this deck yet." />
            </div>
          )}

          {status !== "loading" && template && !strategy && template.meta && (
            <DataGuide
              template={template}
              meta={template.meta}
              cards={cards}
              onRuling={setRuling}
              glance={glance}
            />
          )}

          {status !== "loading" && template && !strategy && !template.meta && (
            <div style={{ padding: 26 }}>
              <EmptyState title="No guide has been written for this deck yet." />
            </div>
          )}

          {status !== "loading" && template && strategy && (
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
                    <p style={{ marginBottom: 0 }}>{strategy.gamePlan}</p>
                  </section>

                  <section className="section" data-role="strategy-section" data-section="opening-priorities">
                    <h2 className="section__head">Opening priorities</h2>
                    {strategy.openingPriorities.map((line, i) => {
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
                    {strategy.keyInteractions.map((line) => {
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
                    {strategy.matchups.map((matchup) => (
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
                  {glance}
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
            {/*
              There are ~75 guides now. Listing them all here would bury the
              page; the Upgrade screen is where every deck is searchable, so
              this strip carries the strongest few and points at it.
            */}
            <span className="label">Other guides</span>
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
