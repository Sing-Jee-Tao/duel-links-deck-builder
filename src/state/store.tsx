/**
 * Application state.
 *
 * `collection` is the only user-authored data: a Map from card id to 0–3 copies.
 * Writes are optimistic (state first, so the quantity control never lags a
 * click) and persisted to IndexedDB on a debounce.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { banlist, loadCardPool, resetCardPool, templates, type CardPool } from "../data/index.ts";
import { normalizeName } from "../engine/banlist-index.ts";
import { buildBest } from "../engine/build.ts";
import { DEFAULT_CONFIG, type BuildConfig, type BuildResult, type OwnedCounts } from "../engine/types.ts";
import {
  DEFAULT_PROFILE,
  readCollection,
  readProfile,
  writeCollection,
  writeProfile,
  type Profile,
  type StoredCard,
} from "./db.ts";

export type LoadStatus = "loading" | "ready" | "error";
export const MAX_COPIES = 3;
export type Quantity = 0 | 1 | 2 | 3;

const SAVE_DEBOUNCE_MS = 600;
export const EXPORT_FORMAT = "deck-ledger-collection";

export interface CollectionExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  profile: Pick<Profile, "duelistName" | "banlistAlerts" | "extraDeckSize">;
  cards: StoredCard[];
}

interface StoreValue {
  status: LoadStatus;
  error: string | null;
  retry: () => void;
  pool: CardPool | null;

  /** card id → copies owned (1–3; absent means 0). */
  collection: ReadonlyMap<number, number>;
  ownedByName: OwnedCounts;
  distinctOwned: number;
  totalCopies: number;
  setQuantity: (id: number, name: string, copies: Quantity) => void;
  clearCollection: () => void;

  profile: Profile;
  updateProfile: (patch: Partial<Profile>) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;

  config: BuildConfig;
  setExtraDeckSize: (size: number) => void;

  build: BuildResult | null;
  buildStatus: LoadStatus;
  rebuild: () => void;

  exportCollection: () => CollectionExport;
  importCollection: (raw: unknown) => { imported: number };
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside <StoreProvider>");
  return value;
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<CardPool | null>(null);
  const [collection, setCollection] = useState<ReadonlyMap<number, number>>(new Map());
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [saveState, setSaveState] = useState<StoreValue["saveState"]>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildResult | null>(null);
  const [buildStatus, setBuildStatus] = useState<LoadStatus>("loading");
  const [buildNonce, setBuildNonce] = useState(0);
  const [loadNonce, setLoadNonce] = useState(0);

  const names = useRef(new Map<number, string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // --- load the card pool and whatever is stored locally -------------------
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    Promise.all([
      loadCardPool(),
      readCollection().catch(() => [] as StoredCard[]),
      readProfile().catch(() => DEFAULT_PROFILE),
    ])
      .then(([loadedPool, storedCards, storedProfile]) => {
        if (cancelled) return;
        const map = new Map<number, number>();
        for (const row of storedCards) {
          // Drop rows whose card left the pool upstream, but keep the name so an
          // export still round-trips what the player typed in.
          map.set(row.id, Math.min(MAX_COPIES, Math.max(0, row.copies)));
          names.current.set(row.id, row.name);
        }
        setPool(loadedPool);
        setCollection(map);
        setProfile(storedProfile);
        setSavedAt(storedProfile.savedAt || null);
        hydrated.current = true;
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Card pool failed to load.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  const retry = useCallback(() => {
    resetCardPool();
    setLoadNonce((n) => n + 1);
  }, []);

  // --- debounced persist ---------------------------------------------------
  const flush = useCallback(
    (next: ReadonlyMap<number, number>, nextProfile: Profile) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(() => {
        const rows: StoredCard[] = [...next.entries()]
          .filter(([, copies]) => copies > 0)
          .map(([id, copies]) => ({ id, name: names.current.get(id) ?? String(id), copies }));
        const stamped = { ...nextProfile, savedAt: new Date().toISOString() };
        Promise.all([writeCollection(rows), writeProfile(stamped)])
          .then(() => {
            setSaveState("saved");
            setSavedAt(stamped.savedAt);
          })
          .catch(() => setSaveState("error"));
      }, SAVE_DEBOUNCE_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const setQuantity = useCallback(
    (id: number, name: string, copies: Quantity) => {
      names.current.set(id, name);
      setCollection((previous) => {
        const next = new Map(previous);
        if (copies <= 0) next.delete(id);
        else next.set(id, copies);
        flush(next, profile);
        return next;
      });
    },
    [flush, profile],
  );

  const clearCollection = useCallback(() => {
    setCollection(() => {
      const next = new Map<number, number>();
      flush(next, profile);
      return next;
    });
  }, [flush, profile]);

  const updateProfile = useCallback(
    (patch: Partial<Profile>) => {
      setProfile((previous) => {
        const next = { ...previous, ...patch };
        flush(collection, next);
        return next;
      });
    },
    [collection, flush],
  );

  // --- derived -------------------------------------------------------------
  const ownedByName: OwnedCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!pool) return map;
    for (const [id, copies] of collection) {
      const card = pool.byId.get(id);
      if (card && copies > 0) map.set(normalizeName(card.name), copies);
    }
    return map;
  }, [collection, pool]);

  const totalCopies = useMemo(() => [...collection.values()].reduce((sum, n) => sum + n, 0), [collection]);

  const config: BuildConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, extraDeckSize: profile.extraDeckSize }),
    [profile.extraDeckSize],
  );

  const setExtraDeckSize = useCallback(
    (size: number) => updateProfile({ extraDeckSize: Math.min(9, Math.max(5, size)) }),
    [updateProfile],
  );

  // --- the solver ----------------------------------------------------------
  // Kept off the click that triggers it: the loading state in the Build screen
  // is real, not decorative, on a large collection.
  useEffect(() => {
    if (!pool) {
      setBuildStatus("loading");
      return;
    }
    setBuildStatus("loading");
    let cancelled = false;
    const handle = setTimeout(() => {
      try {
        const result = buildBest({ owned: ownedByName, templates, banlist, cards: pool.index, config });
        if (!cancelled) {
          setBuild(result);
          setBuildStatus("ready");
        }
      } catch {
        if (!cancelled) setBuildStatus("error");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [ownedByName, pool, config, buildNonce]);

  const rebuild = useCallback(() => setBuildNonce((n) => n + 1), []);

  // --- export / import -----------------------------------------------------
  const exportCollection = useCallback((): CollectionExport => {
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {
        duelistName: profile.duelistName,
        banlistAlerts: profile.banlistAlerts,
        extraDeckSize: profile.extraDeckSize,
      },
      cards: [...collection.entries()]
        .filter(([, copies]) => copies > 0)
        .map(([id, copies]) => ({ id, name: names.current.get(id) ?? String(id), copies })),
    };
  }, [collection, profile]);

  const importCollection = useCallback(
    (raw: unknown) => {
      const file = raw as Partial<CollectionExport>;
      if (!file || file.format !== EXPORT_FORMAT || !Array.isArray(file.cards)) {
        throw new Error("That file is not a Deck Ledger collection export.");
      }
      const next = new Map<number, number>();
      for (const row of file.cards) {
        const id = Number(row?.id);
        const copies = Math.min(MAX_COPIES, Math.max(0, Number(row?.copies) || 0));
        if (!Number.isFinite(id) || copies <= 0) continue;
        // Resolve the name from the current pool where possible, so a stale
        // export still shows today's card names.
        const known = pool?.byId.get(id);
        names.current.set(id, known?.name ?? String(row?.name ?? id));
        next.set(id, copies);
      }
      const nextProfile = { ...profile, ...(file.profile ?? {}) };
      setCollection(next);
      setProfile(nextProfile);
      flush(next, nextProfile);
      return { imported: next.size };
    },
    [flush, pool, profile],
  );

  const value = useMemo<StoreValue>(
    () => ({
      status,
      error,
      retry,
      pool,
      collection,
      ownedByName,
      distinctOwned: collection.size,
      totalCopies,
      setQuantity,
      clearCollection,
      profile,
      updateProfile,
      saveState,
      savedAt,
      config,
      setExtraDeckSize,
      build,
      buildStatus,
      rebuild,
      exportCollection,
      importCollection,
    }),
    [
      status, error, retry, pool, collection, ownedByName, totalCopies, setQuantity, clearCollection,
      profile, updateProfile, saveState, savedAt, config, setExtraDeckSize, build, buildStatus, rebuild,
      exportCollection, importCollection,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
