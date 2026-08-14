/**
 * Paste-a-list import, on the Collection screen because that is where a
 * collection gets built.
 *
 * The design rule this UI serves: an exact name match is applied without asking,
 * and anything less is put in front of the player to resolve. The pool has no
 * duplicate names, so exact is certain — but 143 names are a word-prefix of
 * another, so a confident-looking guess would hand someone the wrong card and
 * nothing on screen would ever explain the deck they could not field.
 */
import { useMemo, useState } from "react";
import type { Card } from "../data/types.ts";
import {
  copiesFor,
  matchCardList,
  parseCardList,
  summarize,
  type MatchedLine,
} from "../engine/import.ts";
import { buildSearchIndex } from "../engine/search.ts";
import { MAX_COPIES, useStore } from "../state/store.tsx";

const BARE_COPY_CHOICES = [1, 2, 3] as const;

export function ImportPanel({ cards }: { cards: readonly Card[] }): JSX.Element {
  const { mergeCollection } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [bareCopies, setBareCopies] = useState<number>(1);
  /** Line index → the card the player picked for an uncertain line. */
  const [resolved, setResolved] = useState<Record<number, Card>>({});
  const [applied, setApplied] = useState<string | null>(null);

  const searchable = useMemo(() => buildSearchIndex(cards), [cards]);
  const matches = useMemo(
    () => (text.trim() ? matchCardList(parseCardList(text), searchable) : []),
    [searchable, text],
  );
  const summary = useMemo(() => summarize(matches), [matches]);

  /** Everything that will actually be written: exact hits plus resolved picks. */
  const pending = useMemo(() => {
    const rows = new Map<number, { id: number; name: string; copies: number }>();
    matches.forEach((match, i) => {
      const card = match.kind === "exact" ? match.card : resolved[i];
      if (!card) return;
      const copies = copiesFor(match.line, bareCopies);
      const existing = rows.get(card.id);
      // The same card can appear twice in a pasted list; take the larger claim.
      if (!existing || copies > existing.copies) rows.set(card.id, { id: card.id, name: card.name, copies });
    });
    return [...rows.values()];
  }, [bareCopies, matches, resolved]);

  const onApply = () => {
    const changed = mergeCollection(pending);
    setApplied(
      changed === 0
        ? `Nothing new — you already own everything in that list at those counts.`
        : `${changed} card${changed === 1 ? "" : "s"} added or increased.`,
    );
    setText("");
    setResolved({});
  };

  const reset = () => {
    setText("");
    setResolved({});
    setApplied(null);
  };

  const uncertain = matches
    .map((match, i) => ({ match, i }))
    .filter((row): row is { match: MatchedLine; i: number } => row.match.kind === "uncertain");
  const unmatched = matches.filter((match) => match.kind === "unmatched");

  return (
    <section className="search" data-role="import-region" style={{ paddingBottom: "var(--s-3)" }}>
      <button
        className="chip"
        type="button"
        data-role="import-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? "− Paste a list" : "+ Paste a list"}
      </button>

      {applied && !open && (
        <div className="stat__label" style={{ marginTop: 8 }} data-role="import-applied">
          {applied}
        </div>
      )}

      {open && (
        <div style={{ marginTop: "var(--s-3)" }}>
          <label className="field-group__label" htmlFor="import-text">
            One card per line — <code>3x Name</code>, <code>Name x3</code> or just the name
          </label>
          <textarea
            className="field"
            id="import-text"
            data-role="import-textarea"
            rows={6}
            spellCheck={false}
            style={{ fontFamily: "var(--font-num)", fontSize: "var(--t-12)", marginTop: 6, resize: "vertical" }}
            placeholder={"3x Traptrix Pudica\nTraptrix Myrmeleo x3\nForbidden Droplet"}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResolved({});
              setApplied(null);
            }}
          />

          <div
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: "var(--s-2)" }}
            data-role="import-default-copies"
          >
            <span className="field-group__label">Lines with no number count as</span>
            {BARE_COPY_CHOICES.map((n) => (
              <button
                className="chip"
                type="button"
                key={n}
                data-role="import-copies-option"
                data-copies={n}
                aria-pressed={bareCopies === n}
                style={bareCopies === n ? { fontWeight: 600, borderWidth: 2 } : undefined}
                onClick={() => setBareCopies(n)}
              >
                {n}
              </button>
            ))}
          </div>

          {matches.length > 0 && (
            <>
              <div
                className="mono muted"
                style={{ fontSize: "var(--t-11)", marginTop: "var(--s-3)" }}
                data-role="import-summary"
              >
                {summary.exact} MATCHED · {summary.uncertain} NEED{summary.uncertain === 1 ? "S" : ""} CONFIRMING ·{" "}
                {summary.unmatched} NOT FOUND
              </div>

              {uncertain.length > 0 && (
                <div className="typeahead" style={{ marginTop: "var(--s-2)" }}>
                  <div className="typeahead__status">
                    <span>NOT SURE WHICH CARD</span>
                    <span>PICK ONE OR LEAVE IT OUT</span>
                  </div>
                  {uncertain.map(({ match, i }) => (
                    <div
                      style={{ padding: "8px 10px", borderBottom: "1px solid var(--rule-2)" }}
                      data-role="import-uncertain-row"
                      key={`${match.line.raw}-${i}`}
                    >
                      <div style={{ fontSize: "var(--t-12)", marginBottom: 6 }}>
                        <strong>{match.line.raw}</strong>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {match.options?.map((option) => (
                          <button
                            className="chip"
                            type="button"
                            key={option.id}
                            data-role="import-option"
                            aria-pressed={resolved[i]?.id === option.id}
                            style={resolved[i]?.id === option.id ? { fontWeight: 600, borderWidth: 2 } : undefined}
                            onClick={() =>
                              setResolved((was) =>
                                was[i]?.id === option.id
                                  ? Object.fromEntries(Object.entries(was).filter(([key]) => key !== String(i)))
                                  : { ...was, [i]: option },
                              )
                            }
                          >
                            {option.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {unmatched.length > 0 && (
                <div className="notice" style={{ marginTop: "var(--s-2)" }} data-role="import-unmatched">
                  <div className="notice__title">
                    {unmatched.length} line{unmatched.length === 1 ? "" : "s"} matched no card
                  </div>
                  <div className="notice__body">
                    {unmatched.map((match) => (
                      <div data-role="import-unmatched-row" key={match.line.raw}>
                        {match.line.raw}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "var(--s-3)" }}>
                <button
                  className="btn btn--primary"
                  type="button"
                  data-role="import-apply"
                  disabled={pending.length === 0}
                  onClick={onApply}
                >
                  Add {pending.length} card{pending.length === 1 ? "" : "s"}
                </button>
                <button className="btn" type="button" data-role="import-clear" onClick={reset}>
                  Clear
                </button>
                <span className="stat__label">
                  Counts never go down — importing twice is safe. Max {MAX_COPIES} copies.
                </span>
              </div>
            </>
          )}

          {applied && (
            <div className="stat__label" style={{ marginTop: "var(--s-2)" }} data-role="import-applied">
              {applied}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
