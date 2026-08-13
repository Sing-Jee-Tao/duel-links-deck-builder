/**
 * Account — profile and backup.
 *
 * DEVIATION FROM THE DESIGN TEMPLATE: the handoff's Account screen is a
 * create-account / sign-in pair with email and password fields. This build has
 * no server — collections live in the browser via IndexedDB, with JSON export
 * and import — so a password field would authenticate nothing and a "create
 * account" button would promise sync that does not exist. The screen keeps the
 * template's two-panel switcher, form geometry and context column, and uses them
 * for what actually persists the player's work: a local profile, and a backup
 * file they own. Every `data-role` still present maps to the same element.
 */
import { useRef, useState } from "react";
import { AllowanceRail } from "../components/Allowance.tsx";
import { Masthead, Shell } from "../components/Chrome.tsx";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";

type Mode = "create" | "signin";

function download(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Account(): JSX.Element {
  const {
    profile,
    updateProfile,
    exportCollection,
    importCollection,
    distinctOwned,
    totalCopies,
    build,
    saveState,
  } = useStore();

  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState(profile.duelistName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onSaveProfile = () => {
    const trimmed = name.trim();
    if (trimmed.length > 24) {
      setNameError("Keep it to 24 characters or fewer.");
      return;
    }
    setNameError(null);
    updateProfile({ duelistName: trimmed });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const onExport = () => {
    const data = exportCollection();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`deck-ledger-collection-${stamp}.json`, JSON.stringify(data, null, 2));
  };

  const onImport = async (file: File) => {
    setImportError(null);
    setImportResult(null);
    try {
      const { imported } = importCollection(JSON.parse(await file.text()));
      setImportResult(`${imported} cards restored from ${file.name}.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "That file could not be read.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Shell>
      <Masthead variant="back" />

      <div className="auth">
        <main className="auth__main" data-role="auth-region">
          <div className="auth__form-wrap">
            <div className="auth__switch" role="tablist" data-role="auth-switcher">
              <button
                className="auth__tab"
                type="button"
                role="tab"
                data-role="auth-tab"
                data-mode="create"
                aria-selected={mode === "create"}
                onClick={() => setMode("create")}
              >
                This device
              </button>
              <button
                className="auth__tab"
                type="button"
                role="tab"
                data-role="auth-tab"
                data-mode="signin"
                aria-selected={mode === "signin"}
                onClick={() => setMode("signin")}
              >
                Restore backup
              </button>
            </div>

            {mode === "create" && (
              <div data-role="auth-panel" data-mode="create">
                <h1 className="auth__title" data-role="auth-title">
                  Your collection lives here
                </h1>
                <p className="auth__sub" data-role="auth-subtitle">
                  Deck Ledger has no accounts and no server. Your collection is stored in this browser and never
                  leaves it — so the backup file below is the thing that moves it to another device.
                </p>

                <form className="form" data-role="auth-form" onSubmit={(e) => e.preventDefault()}>
                  <label className="form__field" data-role="field">
                    <span className="form__label">Duelist name</span>
                    <input
                      className="form__input"
                      data-role="input-display-name"
                      name="displayName"
                      autoComplete="nickname"
                      placeholder="kaiba_main"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    {nameError ? (
                      <span className="form__error" data-role="field-error">
                        {nameError}
                      </span>
                    ) : (
                      <span className="form__hint" data-role="field-hint">
                        Shown in the masthead and written into your export. Changeable any time.
                      </span>
                    )}
                  </label>

                  <label className="form__check" data-role="field-checkbox">
                    <input
                      data-role="input-banlist-alerts"
                      name="banlistAlerts"
                      type="checkbox"
                      checked={profile.banlistAlerts}
                      onChange={(e) => updateProfile({ banlistAlerts: e.target.checked })}
                    />
                    <span>
                      Warn me on the Banlist screen when the bundled Forbidden &amp; Limited list is more than two
                      weeks old.
                    </span>
                  </label>

                  <button
                    className="btn btn--primary"
                    type="button"
                    data-role="submit-button"
                    style={{ padding: "13px 18px" }}
                    onClick={onSaveProfile}
                  >
                    Save profile
                  </button>
                  {saveState === "saving" && (
                    <div className="state--loading mono" data-role="submit-loading">
                      WORKING…
                    </div>
                  )}
                  {saved && saveState !== "saving" && (
                    <div className="state--loading mono" style={{ color: "var(--ochre)" }}>
                      SAVED TO THIS BROWSER
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--s-4)" }}>
                    <div className="label">Backup</div>
                    <p className="form__legal" style={{ margin: "6px 0 10px" }}>
                      {distinctOwned} distinct cards, {totalCopies} copies. Export writes a JSON file you keep;
                      importing it on another device restores the collection exactly.
                    </p>
                    <div className="file-row">
                      <button className="btn" type="button" onClick={onExport}>
                        Export JSON
                      </button>
                      <a className="btn" href={href("collection")}>
                        Back to collection
                      </a>
                    </div>
                  </div>

                  <p className="form__legal" data-role="auth-legal">
                    Deck Ledger is unofficial and not affiliated with Konami. No card data leaves your browser.
                  </p>
                </form>

                <div className="auth__alt" data-role="auth-alt">
                  Moving from another device?{" "}
                  <button
                    className="link-btn"
                    type="button"
                    data-role="auth-alt-button"
                    data-mode="signin"
                    onClick={() => setMode("signin")}
                  >
                    Restore a backup
                  </button>
                </div>
              </div>
            )}

            {mode === "signin" && (
              <div data-role="auth-panel" data-mode="signin">
                <h1 className="auth__title" data-role="auth-title">
                  Restore from a file
                </h1>
                <p className="auth__sub" data-role="auth-subtitle">
                  Pick a Deck Ledger export. This replaces the collection currently stored in this browser.
                </p>

                {importError && (
                  <div
                    className="notice notice--error"
                    style={{ borderBottom: 0, marginBottom: 18 }}
                    data-role="auth-error"
                  >
                    <div className="notice__title">That file could not be restored.</div>
                    <div className="notice__body">{importError}</div>
                  </div>
                )}

                <form className="form" data-role="auth-form" onSubmit={(e) => e.preventDefault()}>
                  <label className="form__field" data-role="field">
                    <span className="form__label">Backup file</span>
                    <input
                      className="form__input"
                      type="file"
                      accept="application/json,.json"
                      ref={fileRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void onImport(file);
                      }}
                    />
                    <span className="form__hint" data-role="field-hint">
                      A file exported by Deck Ledger, named deck-ledger-collection-YYYY-MM-DD.json.
                    </span>
                  </label>

                  {importResult && (
                    <div className="state--loading mono" style={{ color: "var(--ochre)" }}>
                      {importResult.toUpperCase()}
                    </div>
                  )}

                  <p className="form__legal" data-role="auth-legal">
                    Importing overwrites the collection in this browser. Export first if you want to keep it.
                  </p>
                </form>

                <div className="auth__alt" data-role="auth-alt">
                  Nothing to restore?{" "}
                  <button
                    className="link-btn"
                    type="button"
                    data-role="auth-alt-button"
                    data-mode="create"
                    onClick={() => setMode("create")}
                  >
                    Set up this device
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        <aside className="auth__side" data-role="auth-context">
          <div className="label">What this device holds</div>

          <div className="benefit" data-role="benefit-row">
            <span className="benefit__num">01</span>
            <span>
              <strong style={{ fontSize: 14 }}>Your collection, in this browser</strong>
              <span className="benefit__body">
                {distinctOwned} distinct cards and {totalCopies} copies, stored in IndexedDB. An evening of typing
                that survives a reload — but not a cleared browser, which is what the export is for.
              </span>
            </span>
          </div>
          <div className="benefit" data-role="benefit-row">
            <span className="benefit__num">02</span>
            <span>
              <strong style={{ fontSize: 14 }}>Your build settings</strong>
              <span className="benefit__body">
                The Extra Deck cap you set on the Build screen, kept between sessions.
              </span>
            </span>
          </div>
          <div className="benefit" data-role="benefit-row">
            <span className="benefit__num">03</span>
            <span>
              <strong style={{ fontSize: 14 }}>Nothing else</strong>
              <span className="benefit__body">
                No account, no email, no analytics, no third-party requests at runtime. The card pool and banlist
                ship with the site.
              </span>
            </span>
          </div>

          {build && (
            <div style={{ marginTop: 28 }}>
              <AllowanceRail allowance={build.validation.allowance} title="Last build" />
            </div>
          )}

          <p className="mono" style={{ margin: "22px 0 0", fontSize: "var(--t-10)", lineHeight: 1.7, color: "#6E7D73" }}>
            UNOFFICIAL · NOT AFFILIATED WITH KONAMI
            <br />
            NO CARD DATA LEAVES THIS BROWSER
          </p>
        </aside>
      </div>
    </Shell>
  );
}
