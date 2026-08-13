/**
 * Shared chrome: perforation rail, masthead, account menu, screen nav, footer.
 * Ported from the design templates — `data-role` attributes preserved as the
 * binding points they were authored to be.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { href, type Screen } from "../state/router.ts";
import { useStore } from "../state/store.tsx";

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="shell">
      <div className="rail" data-role="perf-rail" aria-hidden="true" />
      <div className="page">{children}</div>
    </div>
  );
}

export const FORMAT_SUMMARY = "MAIN 20–30 · EXTRA 5 · LP 4000";

function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "DL";
  const parts = cleaned.split(/[\s_\-.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

/** The masthead account menu. `<details>` as in the design; closes on outside click. */
function AccountMenu(): JSX.Element {
  const { profile, distinctOwned, savedAt, clearCollection } = useStore();
  const ref = useRef<HTMLDetailsElement>(null);
  const name = profile.duelistName.trim() || "this device";

  useEffect(() => {
    const onDocument = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current) ref.current.open = false;
    };
    document.addEventListener("click", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const saved = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "NOT YET";

  return (
    <details className="acct" data-role="account-menu" ref={ref}>
      <summary className="acct__trigger" data-role="account-trigger">
        <span className="acct__avatar" data-role="account-avatar">
          {initials(profile.duelistName)}
        </span>
        <span className="acct__name" data-role="account-name">
          {name}
        </span>
        <span className="acct__caret" aria-hidden="true">
          ▼
        </span>
      </summary>
      <div className="acct__menu" data-role="account-dropdown">
        <div className="acct__head">
          <div className="acct__name">{name}</div>
          <div className="mono muted" style={{ fontSize: "var(--t-10)", marginTop: 2 }}>
            {distinctOwned} CARDS · SAVED {saved}
          </div>
        </div>
        <a className="acct__item" href={href("account")} data-role="account-link">
          Profile &amp; backup
        </a>
        <a className="acct__item" href={href("collection")} data-role="account-link">
          Collection
        </a>
        <button
          className="acct__item acct__item--danger"
          type="button"
          data-role="signout-button"
          style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer" }}
          onClick={() => {
            if (window.confirm("Clear the collection stored on this device? This cannot be undone.")) {
              clearCollection();
            }
          }}
        >
          Clear local collection
        </button>
      </div>
    </details>
  );
}

export function Masthead({ variant = "app" }: { variant?: "app" | "landing" | "back" }): JSX.Element {
  return (
    <header className="masthead" data-role="masthead">
      <a className="masthead__mark" href={href("welcome")}>
        DECK LEDGER
      </a>
      <span className="masthead__meta">DUEL LINKS · SPEED DUEL</span>
      <span className="masthead__spacer" />
      {variant === "app" && (
        <>
          <span className="masthead__meta" data-role="format-summary">
            {FORMAT_SUMMARY}
          </span>
          <AccountMenu />
        </>
      )}
      {variant === "landing" && (
        <>
          <a
            className="btn"
            href={href("collection")}
            data-role="signin-link"
            style={{ padding: "8px 14px", fontSize: "var(--t-12)" }}
          >
            Open collection
          </a>
          <a
            className="btn btn--primary"
            href={href("account")}
            data-role="signup-link"
            style={{ padding: "8px 14px", fontSize: "var(--t-12)" }}
          >
            Set up profile
          </a>
        </>
      )}
      {variant === "back" && (
        <a
          className="masthead__meta"
          href={href("welcome")}
          data-role="back-link"
          style={{ textDecoration: "none" }}
        >
          ← BACK
        </a>
      )}
    </header>
  );
}

const NAV: { screen: Screen; num: string; label: string }[] = [
  { screen: "collection", num: "01", label: "Collection" },
  { screen: "build", num: "02", label: "Build" },
  { screen: "upgrade", num: "03", label: "Upgrade" },
  { screen: "strategy", num: "04", label: "Strategy" },
  { screen: "banlist", num: "05", label: "Banlist" },
];

export function ScreenNav({ current }: { current: Screen }): JSX.Element {
  return (
    <nav className="nav" data-role="screen-nav">
      {NAV.map((item) => (
        <a
          key={item.screen}
          className="nav__item"
          href={href(item.screen)}
          data-role="nav-item"
          {...(item.screen === current ? { "aria-current": "page" as const } : {})}
        >
          <span className="nav__num">{item.num}</span>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer className="footer" data-role="footer">
      <span>DECK LEDGER · UNOFFICIAL · NOT AFFILIATED WITH KONAMI</span>
      <span style={{ flex: 1 }} />
      {NAV.map((item) => (
        <a key={item.screen} href={href(item.screen)}>
          {item.label.toUpperCase()}
        </a>
      ))}
    </footer>
  );
}
