/**
 * IndexedDB persistence. The collection is the only user-authored data in the
 * app, so it is written optimistically to memory and flushed here on a debounce.
 *
 * Hand-rolled rather than pulling in a wrapper: two stores, four operations.
 */

const DB_NAME = "deck-ledger";
const DB_VERSION = 1;
const COLLECTION_STORE = "collection";
const PROFILE_STORE = "profile";

export interface StoredCard {
  /** Card id from data/cards.json. */
  id: number;
  name: string;
  copies: number;
}

export interface Profile {
  duelistName: string;
  banlistAlerts: boolean;
  extraDeckSize: number;
  savedAt: string;
}

export const DEFAULT_PROFILE: Profile = {
  duelistName: "",
  banlistAlerts: true,
  extraDeckSize: 5,
  savedAt: "",
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COLLECTION_STORE)) {
        db.createObjectStore(COLLECTION_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local database."));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Local write failed."));
      }),
  );
}

export async function readCollection(): Promise<StoredCard[]> {
  const rows = await tx<StoredCard[]>(COLLECTION_STORE, "readonly", (s) => s.getAll() as IDBRequest<StoredCard[]>);
  return rows.filter((row) => row.copies > 0);
}

/** Replaces the whole collection in one transaction. */
export async function writeCollection(rows: StoredCard[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(COLLECTION_STORE, "readwrite");
    const store = transaction.objectStore(COLLECTION_STORE);
    store.clear();
    for (const row of rows) if (row.copies > 0) store.put(row);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local write aborted."));
  });
}

export async function readProfile(): Promise<Profile> {
  const stored = await tx<Profile | undefined>(PROFILE_STORE, "readonly", (s) => s.get("profile") as IDBRequest<Profile | undefined>);
  return { ...DEFAULT_PROFILE, ...(stored ?? {}) };
}

export async function writeProfile(profile: Profile): Promise<void> {
  await tx(PROFILE_STORE, "readwrite", (s) => s.put(profile, "profile"));
}
