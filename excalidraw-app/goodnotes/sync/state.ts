/**
 * Per-document sync bookkeeping, persisted next to (but not inside) the
 * library's own stores.
 *
 * ```
 *   db "goodnotes-sync" / store "state" -> DocSyncState, keyed by doc id
 * ```
 *
 * A THIRD database, deliberately. `idb-keyval`'s `createStore` opens a
 * database with no explicit version, so it only ever creates the one object
 * store it is handed; a second `createStore` naming the same database never
 * receives `upgradeneeded` and every transaction against it fails with
 * `NotFoundError`. `library/store.ts` documents the same trap. So: one
 * database per store, always.
 *
 * Nothing here is secret. The watermark is a version number and a hash; the
 * access token lives in `supabase-js`'s own storage and never passes through
 * this module.
 */

import { clear, createStore, del, entries, get, set } from "idb-keyval";

import type { DocSyncState } from "./types";

const stateStore = createStore("goodnotes-sync", "state");

/**
 * Ids of binary files this device has already uploaded.
 *
 * Its own database, for the `createStore` reason above. It exists because
 * file objects are content-addressed and therefore immutable: without a
 * memo, every push of a notebook containing a 20 MB imported PDF would send
 * those 20 MB again, since `upload(..., { upsert: false })` still transmits
 * the body before the server rejects it as a duplicate.
 */
const fileStore = createStore("goodnotes-sync-files", "files");

/**
 * Key holding the account the watermarks belong to. A document id is a
 * `randomId()` and never begins with a NUL, so this cannot collide.
 */
const ACCOUNT_KEY = "\u0000account";

/** Every watermark, keyed by document id. */
export const loadStates = async (): Promise<Map<string, DocSyncState>> => {
  const rows = (await entries(stateStore)) as [IDBValidKey, unknown][];
  const map = new Map<string, DocSyncState>();
  for (const [key, value] of rows) {
    if (typeof key !== "string" || key === ACCOUNT_KEY) {
      continue;
    }
    const state = value as Partial<DocSyncState> | undefined;
    if (!state || typeof state.baseVersion !== "number") {
      continue;
    }
    map.set(key, {
      docId: key,
      baseVersion: state.baseVersion,
      baseContentHash: state.baseContentHash ?? "",
      baseMetaHash: state.baseMetaHash ?? "",
      lastSyncedAt: state.lastSyncedAt ?? 0,
      lastLocalUpdatedAt: state.lastLocalUpdatedAt ?? 0,
    });
  }
  return map;
};

/** One document's watermark, or null. */
export const getState = async (docId: string): Promise<DocSyncState | null> => {
  const value = (await get(docId, stateStore)) as DocSyncState | undefined;
  return value && typeof value.baseVersion === "number" ? value : null;
};

/** Write one document's watermark. */
export const putState = async (state: DocSyncState): Promise<void> => {
  await set(state.docId, state, stateStore);
};

/** Forget one document's watermark (after a delete settles, say). */
export const dropState = async (docId: string): Promise<void> => {
  await del(docId, stateStore);
};

/** Forget everything. Used on sign-out and on an account change. */
export const clearStates = async (): Promise<void> => {
  await clear(stateStore);
  await clear(fileStore);
};

/** Has this device already uploaded the (content-addressed) file? */
export const hasUploadedFile = async (fileId: string): Promise<boolean> =>
  (await get(fileId, fileStore)) === 1;

/** Record that a file's bytes are on the server. */
export const markFileUploaded = async (fileId: string): Promise<void> => {
  await set(fileId, 1, fileStore);
};

/**
 * Bind the watermarks to an account.
 *
 * Signing in as somebody else on a shared laptop must not make this device
 * claim to be "already in sync at version 7" for documents that belong to a
 * different user — that would push one student's notes into another's
 * account on the first pass. So a changed account wipes the watermarks and
 * the next pass treats every local document as never-synced.
 *
 * Returns true when the watermarks were discarded.
 */
export const bindAccount = async (userId: string): Promise<boolean> => {
  const previous = (await get(ACCOUNT_KEY, stateStore)) as string | undefined;
  if (previous === userId) {
    return false;
  }
  if (previous) {
    await clear(stateStore);
    await clear(fileStore);
  }
  await set(ACCOUNT_KEY, userId, stateStore);
  return Boolean(previous);
};
