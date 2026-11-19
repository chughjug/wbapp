/**
 * Document library persistence.
 *
 * Excalidraw upstream keeps a single scene under the `excalidraw` localStorage
 * key. This module replaces that mental model with a *library* of documents.
 *
 * Storage layout (IndexedDB, via `idb-keyval`):
 *
 *   db "goodnotes"        / store "docs"   -> DocMeta, keyed by doc id
 *   db "goodnotes-scenes" / store "scenes" -> DocScene, keyed by doc id
 *
 * Two separate databases (rather than two object stores in one db) because
 * `idb-keyval`'s `createStore` opens a database without an explicit version and
 * only creates the single object store it is given; a second `createStore` on
 * the same database name would never get an `upgradeneeded` event and every
 * transaction against it would fail with `NotFoundError`.
 *
 * The split matters: the shelf lists documents by reading only the meta store,
 * so browsing never deserialises element arrays or (potentially multi-megabyte)
 * `BinaryFiles` blobs.
 */

import { randomId } from "@excalidraw/common";
import { reconcileElements } from "@excalidraw/excalidraw/data/reconcile";
import { createStore, del, entries, get, set } from "idb-keyval";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import type {
  ReconciledExcalidrawElement,
  RemoteExcalidrawElement,
} from "@excalidraw/excalidraw/data/reconcile";

import type { AppState } from "@excalidraw/excalidraw/types";

import { forgetDocText, indexSceneText } from "../search";
import { PAGE_FRAME_PREFIX } from "../types";

import {
  isInCourseTree,
  normalizeCoursePath,
  rewriteCoursePath,
} from "./coursePath";
import { addTagToList, removeTagFromList, renameTagInList } from "./tags";

import type { DocMeta, DocScene } from "../types";

/** Lightweight metadata — everything the shelf needs, and nothing heavy. */
const metaStore = createStore("goodnotes", "docs");

/** Heavy per-document scene payloads. Never touched while listing. */
const sceneStore = createStore("goodnotes-scenes", "scenes");

export const DEFAULT_DOC_TITLE = "Untitled notebook";

/** How long `saveSceneDebounced` coalesces writes for, in ms. */
export const SCENE_SAVE_DEBOUNCE_MS = 750;

// ---------------------------------------------------------------------------
// change notification
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to library mutations (create/update/delete/duplicate/save).
 * Returns an unsubscribe function. Safe to pass straight to
 * `useSyncExternalStore`.
 */
export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let batchDepth = 0;
let batchDirty = false;

const emitChange = () => {
  // A bulk action touches N rows; subscribers (and therefore the whole shelf)
  // must re-read once, not N times.
  if (batchDepth > 0) {
    batchDirty = true;
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: any) {
      console.error("goodnotes/library: listener threw", error);
    }
  }
};

/**
 * Run `fn` with change notification coalesced into a single emit at the end.
 * Nestable; the emit happens when the outermost batch resolves, and still
 * happens if `fn` throws part-way (subscribers must see partial writes).
 */
export const runBatched = async <T>(fn: () => Promise<T>): Promise<T> => {
  batchDepth++;
  try {
    return await fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && batchDirty) {
      batchDirty = false;
      emitChange();
    }
  }
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const now = () => Date.now();

/**
 * The next `updatedAt` for a document, guaranteed to be strictly greater than
 * the one it already has.
 *
 * WHY: `Date.now()` has millisecond resolution, and two writes to the same
 * document can land inside one millisecond — a stroke saved right after the
 * sync engine took its watermark, say. The sync fast path compares
 * `updatedAt` for *equality* against that watermark and checks the metadata
 * hash alongside it (`sync/engine.ts`), so an edit that changes only the
 * scene and keeps the same millisecond looks identical to a synced document
 * and is skipped — not until the next sync, but until some later edit
 * happens to bump the clock. Making the stamp strictly monotonic removes the
 * collision at the source and keeps that fast path cheap (no scene reads).
 *
 * The stamp stays an ordinary epoch-millisecond value; under a burst of
 * sub-millisecond writes it simply runs a few ms ahead of the wall clock.
 */
const bumpUpdatedAt = (previous: number): number =>
  Math.max(now(), previous + 1);

/**
 * Not every value that lives on `AppState` survives a structured clone (and a
 * few are pure runtime noise). Keep the write cheap and total.
 */
const sanitizeAppState = (
  appState: DocScene["appState"],
): DocScene["appState"] => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(appState ?? {})) {
    if (typeof value === "function") {
      continue;
    }
    if (
      key === "collaborators" ||
      key === "contextMenu" ||
      key === "openDialog" ||
      key === "pendingImageElementId" ||
      key === "selectedElementsAreBeingDragged" ||
      key === "snapLines" ||
      key === "suggestedBindings"
    ) {
      continue;
    }
    next[key] = value;
  }
  return next as DocScene["appState"];
};

/** Count page frames (`page:`-prefixed frames) so the shelf can show a count. */
const countPages = (scene: DocScene): number => {
  let count = 0;
  for (const element of scene.elements) {
    if (
      !element.isDeleted &&
      element.type === "frame" &&
      typeof element.name === "string" &&
      element.name.startsWith(PAGE_FRAME_PREFIX)
    ) {
      count++;
    }
  }
  return count;
};

/** Fill in any field a stored record predates, so callers get a total DocMeta. */
const normalizeMeta = (raw: Partial<DocMeta> & { id: string }): DocMeta => {
  const createdAt = raw.createdAt ?? now();
  return {
    id: raw.id,
    title: raw.title ?? DEFAULT_DOC_TITLE,
    course: raw.course ?? null,
    dueDate: raw.dueDate ?? null,
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
    createdAt,
    updatedAt: raw.updatedAt ?? createdAt,
    lastOpenedAt: raw.lastOpenedAt ?? null,
    thumbnail: raw.thumbnail ?? null,
    pageCount: typeof raw.pageCount === "number" ? raw.pageCount : 1,
    defaultTemplate: raw.defaultTemplate ?? "blank",
    defaultPageSize: raw.defaultPageSize ?? "LETTER",
    // optional contract fields: preserved verbatim so a metadata write (bulk
    // or otherwise) never silently drops a value another module wrote.
    ...(raw.defaultLandscape === undefined
      ? {}
      : { defaultLandscape: raw.defaultLandscape }),
    ...(raw.defaultImageFit === undefined
      ? {}
      : { defaultImageFit: raw.defaultImageFit }),
    ...(raw.surface === undefined ? {} : { surface: raw.surface }),
    ...(raw.thumbnailAt === undefined ? {} : { thumbnailAt: raw.thumbnailAt }),
    ...(raw.deletedAt === undefined ? {} : { deletedAt: raw.deletedAt }),
  };
};

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * Every document's metadata, newest-updated first. Reads the meta store only —
 * no scene or file data is deserialised.
 */
export const listDocs = async (): Promise<DocMeta[]> => {
  const rows = (await entries(metaStore)) as [IDBValidKey, DocMeta][];
  return rows
    .filter(([, meta]) => !!meta && typeof meta === "object" && !!meta.id)
    .map(([, meta]) => normalizeMeta(meta))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

/** One document's metadata, or `null` when the id is unknown. */
export const getDoc = async (id: string): Promise<DocMeta | null> => {
  const meta = (await get(id, metaStore)) as DocMeta | undefined;
  return meta ? normalizeMeta(meta) : null;
};

/** One document's full scene payload, or `null` when nothing was ever saved. */
export const getScene = async (id: string): Promise<DocScene | null> => {
  const scene = (await get(id, sceneStore)) as DocScene | undefined;
  if (!scene) {
    return null;
  }
  return {
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  };
};

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

/** Create a document. Any `init` field overrides the default. */
export const createDoc = async (
  init: Partial<DocMeta> = {},
): Promise<DocMeta> => {
  const timestamp = now();
  const meta = normalizeMeta({
    ...init,
    id: init.id ?? randomId(),
    createdAt: init.createdAt ?? timestamp,
    updatedAt: init.updatedAt ?? timestamp,
  });
  await set(meta.id, meta, metaStore);
  emitChange();
  return meta;
};

/**
 * Merge `patch` into a document's metadata. `id`, `createdAt` and `updatedAt`
 * are managed here and ignored from the patch (pass `touch: false` nowhere —
 * metadata edits always bump `updatedAt`).
 *
 * @throws if the document does not exist.
 */
export const updateDocMeta = async (
  id: string,
  patch: Partial<DocMeta>,
): Promise<DocMeta> => {
  const existing = await getDoc(id);
  if (!existing) {
    throw new Error(`goodnotes/library: no such document "${id}"`);
  }
  const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...rest } = patch;
  const next = normalizeMeta({
    ...existing,
    ...rest,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: patch.updatedAt ?? bumpUpdatedAt(existing.updatedAt),
  });
  await set(id, next, metaStore);
  emitChange();
  return next;
};

/* -------------------------------------------------------------------------- */
/* concurrent writers (the same notebook open twice)                           */
/* -------------------------------------------------------------------------- */

/**
 * The `updatedAt` each document was at when this tab last read or wrote it.
 *
 * Saving is last-write-wins over the whole scene, so with the same notebook
 * open in two tabs each save overwrote the other tab's strokes outright and
 * said nothing. Opening your own notes in a second tab — from history, from
 * a link, by accident — quietly destroyed whichever side saved first.
 *
 * A watermark is enough to *notice*: if the stored `updatedAt` is not the one
 * we last saw, somebody else wrote in between.
 */
const sceneBaselines = new Map<string, number>();

/**
 * Record the version this tab is editing from. Call it when a document is
 * opened in the editor — NOT from every read, since thumbnails and backups
 * read scenes too and must not claim to be writers.
 */
export const noteSceneBaseline = async (id: string): Promise<void> => {
  const meta = await getDoc(id);
  sceneBaselines.set(id, meta?.updatedAt ?? 0);
};

/** Forget a document's watermark (it was closed, or deleted). */
export const forgetSceneBaseline = (id: string): void => {
  sceneBaselines.delete(id);
};

type SceneMergedListener = (id: string, scene: DocScene) => void;

const sceneMergedListeners = new Set<SceneMergedListener>();

/**
 * Notified when a save had to merge in another tab's work. The host should
 * put the merged elements on screen: this tab's canvas does not contain them,
 * so without this it keeps showing a scene narrower than the one on disk.
 */
export const subscribeSceneMerged = (
  listener: SceneMergedListener,
): (() => void) => {
  sceneMergedListeners.add(listener);
  return () => {
    sceneMergedListeners.delete(listener);
  };
};

/**
 * If another tab wrote since our baseline, fold its elements into `payload`
 * (mutating `payload.elements`) and return `true`.
 *
 * The merge is Excalidraw's own `reconcileElements`, the same function the
 * collaboration path uses: union by element id, per-element `version` with a
 * deterministic `versionNonce` tiebreak, then fractional-index ordering. Ours
 * is the local side, so our edit to a shared element wins; elements only the
 * other tab has are carried over intact.
 *
 * KNOWN LIMIT — a concurrent *delete* can come back. We strip `isDeleted`
 * elements when saving, so there are no tombstones, and an element the other
 * tab still has looks to the merge like one we never had. Re-adding a stroke
 * somebody erased is a far smaller harm than throwing away everything they
 * wrote, which is what happened before, so this is the deliberate trade.
 */
const mergeConcurrentWrite = async (
  id: string,
  payload: DocScene,
  meta: DocMeta | null,
): Promise<boolean> => {
  const baseline = sceneBaselines.get(id);
  // No baseline means this tab never opened the document for editing (an
  // import, a restore); there is nothing to compare against.
  if (baseline === undefined || !meta || meta.updatedAt === baseline) {
    return false;
  }

  let stored: DocScene | null = null;
  try {
    stored = await getScene(id);
  } catch {
    // a scene we cannot read is one we cannot merge; the write below still
    // happens, which is the old behaviour rather than a new failure
    return false;
  }
  if (!stored || stored.elements.length === 0) {
    return false;
  }

  payload.elements = reconcileElements(
    payload.elements as readonly OrderedExcalidrawElement[],
    stored.elements as readonly RemoteExcalidrawElement[],
    payload.appState as AppState,
  ) as readonly ReconciledExcalidrawElement[] as DocScene["elements"];

  // the other tab's files too, or its images merge in as broken placeholders
  payload.files = { ...stored.files, ...payload.files };

  for (const listener of sceneMergedListeners) {
    try {
      listener(id, payload);
    } catch {
      // a listener must not be able to fail the save
    }
  }
  return true;
};

/**
 * Persist a scene and bump the owning document's `updatedAt` (and `pageCount`,
 * derived from `page:`-prefixed frames).
 *
 * Cheap enough to call from a debounced change handler; see also
 * `saveSceneDebounced`.
 */
export const saveScene = async (id: string, scene: DocScene): Promise<void> => {
  const payload: DocScene = {
    elements: scene.elements.filter((element) => !element.isDeleted),
    appState: sanitizeAppState(scene.appState),
    files: scene.files ?? {},
  };

  // Read the metadata BEFORE writing: its `updatedAt` is how we notice that
  // another tab has written to this document since we last did.
  let meta = await getDoc(id);
  const merged = await mergeConcurrentWrite(id, payload, meta);

  await set(id, payload, sceneStore);

  if (merged) {
    // re-read: the merge did not write, but the other tab's write means the
    // metadata we read a moment ago may already be stale for pageCount
    meta = await getDoc(id);
  }
  if (meta) {
    const pageCount = countPages(payload);
    await set(
      id,
      normalizeMeta({
        ...meta,
        updatedAt: bumpUpdatedAt(meta.updatedAt),
        pageCount: pageCount > 0 ? pageCount : meta.pageCount,
      }),
      metaStore,
    );
    // this tab is now the last writer; anything newer than this is somebody
    // else and must be merged, not overwritten
    const written = (await getDoc(id))?.updatedAt ?? 0;
    if (sceneBaselines.has(id)) {
      sceneBaselines.set(id, written);
    }
    // keep the search text current. Strings only, so this is cheap next to
    // the scene write above; a failure must not fail the save, since a
    // stale search index is a far smaller problem than lost strokes.
    try {
      await indexSceneText(id, payload, written);
    } catch {
      // ignored on purpose — see above
    }
  }
  emitChange();
};

/**
 * Scene writes that fail after the caller has stopped waiting.
 *
 * `saveSceneDebounced` fires from a timer and `flushSceneSaves` is called
 * for its side effect, so neither has a caller left to return an error to.
 * Both used to drop the rejection on the floor (`void saveScene(...)`),
 * which meant a write that failed — the quota exhausted by a term of
 * PDF-backed notebooks, or Safari evicting the database — lost the strokes
 * in silence while the app went on looking like it was saving. Losing work
 * is bad; losing it without saying so is worse, because the user keeps
 * writing. Failures are announced here instead, and the host turns them
 * into something the user can see.
 */
type SaveErrorListener = (docId: string, error: unknown) => void;

const saveErrorListeners = new Set<SaveErrorListener>();

/** Subscribe to scene writes that failed with nobody waiting on them. */
export const subscribeSaveError = (
  listener: SaveErrorListener,
): (() => void) => {
  saveErrorListeners.add(listener);
  return () => {
    saveErrorListeners.delete(listener);
  };
};

const reportSaveError = (docId: string, error: unknown): void => {
  // eslint-disable-next-line no-console
  console.error(`goodnotes/library: could not save "${docId}"`, error);
  saveErrorListeners.forEach((listener) => {
    try {
      listener(docId, error);
    } catch {
      // a broken listener must not swallow the next one
    }
  });
};

const pendingSaves = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; scene: DocScene }
>();

/**
 * Debounced `saveScene`, coalescing per document id. The latest scene wins.
 * Returns immediately; use `flushSceneSaves()` before unmount/navigation.
 */
export const saveSceneDebounced = (
  id: string,
  scene: DocScene,
  wait: number = SCENE_SAVE_DEBOUNCE_MS,
): void => {
  const pending = pendingSaves.get(id);
  if (pending) {
    clearTimeout(pending.timer);
  }
  const timer = setTimeout(() => {
    const entry = pendingSaves.get(id);
    pendingSaves.delete(id);
    if (entry) {
      void saveScene(id, entry.scene).catch((error) =>
        reportSaveError(id, error),
      );
    }
  }, wait);
  pendingSaves.set(id, { timer, scene });
};

/** Immediately write out anything `saveSceneDebounced` is still holding. */
export const flushSceneSaves = async (): Promise<void> => {
  const queued = [...pendingSaves.entries()];
  pendingSaves.clear();
  await Promise.all(
    queued.map(([id, entry]) => {
      clearTimeout(entry.timer);
      // Resolve even when one document fails: every call site either ignores
      // the result (`void flushSceneSaves()`, including the `pagehide`
      // handler) or is mid-navigation, so a rejection here would be an
      // unhandled one and would also abandon the OTHER documents in the
      // batch. The failure is announced instead.
      return saveScene(id, entry.scene).catch((error) =>
        reportSaveError(id, error),
      );
    }),
  );
};

/** Store a page-1 preview. `dataUrl` should be a `data:image/png;base64,…`. */
export const setThumbnail = async (
  id: string,
  dataUrl: string,
): Promise<DocMeta | null> => {
  const meta = await getDoc(id);
  if (!meta) {
    return null;
  }
  // deliberately does NOT bump updatedAt: a thumbnail refresh is not an edit.
  const next = normalizeMeta({ ...meta, thumbnail: dataUrl });
  await set(id, next, metaStore);
  emitChange();
  return next;
};

/** Record that a document was opened (drives "recently opened" affordances). */
export const touchDoc = async (id: string): Promise<DocMeta | null> => {
  const meta = await getDoc(id);
  if (!meta) {
    return null;
  }
  const next = normalizeMeta({ ...meta, lastOpenedAt: now() });
  await set(id, next, metaStore);
  emitChange();
  return next;
};

/** Deep-copy a document (metadata + scene) under a fresh id. */
export const duplicateDoc = async (id: string): Promise<DocMeta> => {
  const source = await getDoc(id);
  if (!source) {
    throw new Error(`goodnotes/library: no such document "${id}"`);
  }
  const timestamp = now();
  const copy = normalizeMeta({
    ...source,
    id: randomId(),
    title: `${source.title} (copy)`,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  });
  const scene = await getScene(id);
  if (scene) {
    await set(copy.id, scene, sceneStore);
  }
  await set(copy.id, copy, metaStore);
  emitChange();
  return copy;
};

/* -------------------------------------------------------------------------- */
/* the trash                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Move a document to the trash: nothing is destroyed, it is only stamped
 * and hidden (see `DocMeta.deletedAt` and `./filters`).
 *
 * The text index is dropped at the same time, so a deleted notebook stops
 * turning up in search immediately; {@link restoreDoc} puts it back.
 */
export const trashDoc = async (
  id: string,
  at: number = now(),
): Promise<DocMeta | null> => {
  const existing = await getDoc(id);
  if (!existing || typeof existing.deletedAt === "number") {
    return existing;
  }
  // flush first: a debounced save landing after the stamp would rewrite the
  // scene of a document the user believes they have just deleted
  const pending = pendingSaves.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSaves.delete(id);
  }
  const next = await updateDocMeta(id, {
    deletedAt: at,
    // the shelf sorts the trash by when it was deleted, and an untouched
    // `updatedAt` is also what tells a restore where the document belongs
    updatedAt: existing.updatedAt,
  });
  try {
    await forgetDocText(id);
  } catch {
    // search is an enhancement; a stale entry is filtered out by the shelf
  }
  return next;
};

/** Take a document back out of the trash. */
export const restoreDoc = async (id: string): Promise<DocMeta | null> => {
  const existing = await getDoc(id);
  if (!existing || typeof existing.deletedAt !== "number") {
    return existing;
  }
  const { deletedAt: _dropped, ...rest } = existing;
  const next = normalizeMeta({ ...rest, updatedAt: existing.updatedAt });
  await set(id, next, metaStore);
  emitChange();
  // re-index in the background: a restored notebook should be findable
  // again, but search must never hold up the restore itself
  void getScene(id)
    .then((scene) =>
      scene ? indexSceneText(id, scene, next.updatedAt) : undefined,
    )
    .catch(() => undefined);
  return next;
};

/**
 * Hard-delete everything trashed before `cutoff`. Returns the ids purged.
 *
 * Called once when the library loads rather than on a timer: a notes app
 * is not running in the background, and "30 days since you deleted it"
 * does not need to be enforced to the minute.
 */
export const purgeExpiredTrash = async (cutoff: number): Promise<string[]> => {
  const docs = await listDocs();
  const expired = docs.filter(
    (doc) => typeof doc.deletedAt === "number" && doc.deletedAt <= cutoff,
  );
  if (expired.length === 0) {
    return [];
  }
  return runBatched(async () => {
    for (const doc of expired) {
      await deleteDoc(doc.id);
    }
    return expired.map((doc) => doc.id);
  });
};

/**
 * Remove a document's metadata and its scene payload, for good.
 *
 * This is the irreversible one. The shelf's delete action calls
 * {@link trashDoc}; this runs when the user empties the trash, deletes
 * from inside it, or the retention window expires.
 */
export const deleteDoc = async (id: string): Promise<void> => {
  const pending = pendingSaves.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSaves.delete(id);
  }
  sceneBaselines.delete(id);
  await Promise.all([del(id, metaStore), del(id, sceneStore)]);
  // a deleted notebook must stop turning up in search
  try {
    await forgetDocText(id);
  } catch {
    // a stale index entry is harmless; the shelf filters to live documents
  }
  emitChange();
};

// ---------------------------------------------------------------------------
// bulk writes
//
// Every one of these is a single batched notification (see `runBatched`), so
// a 40-document move repaints the shelf once. They are deliberately
// sequential rather than Promise.all: idb-keyval shares one connection per
// store and a read-modify-write per row must not interleave with its sibling.
// ---------------------------------------------------------------------------

/** Patch, or a function of the current metadata returning a patch. */
export type DocPatch =
  | Partial<DocMeta>
  | ((meta: DocMeta) => Partial<DocMeta> | null);

/**
 * Apply a patch to many documents. Unknown ids are skipped (a concurrent
 * delete must not fail the whole bulk action). Resolves with the documents
 * that were actually written.
 */
export const updateManyDocs = async (
  ids: readonly string[],
  patch: DocPatch,
): Promise<DocMeta[]> =>
  runBatched(async () => {
    const written: DocMeta[] = [];
    for (const id of ids) {
      const current = await getDoc(id);
      if (!current) {
        continue;
      }
      const resolved = typeof patch === "function" ? patch(current) : patch;
      if (!resolved) {
        continue;
      }
      written.push(await updateDocMeta(id, resolved));
    }
    return written;
  });

/** Move many documents to the trash. Resolves with the count moved. */
export const trashManyDocs = async (ids: readonly string[]): Promise<number> =>
  runBatched(async () => {
    const at = now();
    let moved = 0;
    for (const id of ids) {
      const existing = await getDoc(id);
      if (existing && typeof existing.deletedAt !== "number") {
        await trashDoc(id, at);
        moved++;
      }
    }
    return moved;
  });

/** Take many documents back out of the trash. */
export const restoreManyDocs = async (
  ids: readonly string[],
): Promise<number> =>
  runBatched(async () => {
    let restored = 0;
    for (const id of ids) {
      const existing = await getDoc(id);
      if (existing && typeof existing.deletedAt === "number") {
        await restoreDoc(id);
        restored++;
      }
    }
    return restored;
  });

/**
 * Delete many documents for good (metadata + scenes). Resolves with the
 * count. The shelf only reaches this from inside "Recently deleted".
 */
export const deleteManyDocs = async (ids: readonly string[]): Promise<number> =>
  runBatched(async () => {
    let removed = 0;
    for (const id of ids) {
      const existing = await getDoc(id);
      await deleteDoc(id);
      if (existing) {
        removed++;
      }
    }
    return removed;
  });

/** Duplicate many documents, in the order given. */
export const duplicateManyDocs = async (
  ids: readonly string[],
): Promise<DocMeta[]> =>
  runBatched(async () => {
    const copies: DocMeta[] = [];
    for (const id of ids) {
      const existing = await getDoc(id);
      if (!existing) {
        continue;
      }
      copies.push(await duplicateDoc(id));
    }
    return copies;
  });

/**
 * Add or remove one tag across many documents. Used for every flag
 * (favourite / archived / pinned) as well as user tags, so there is exactly
 * one code path.
 */
export const setTagOnMany = async (
  ids: readonly string[],
  tag: string,
  present: boolean,
): Promise<DocMeta[]> =>
  updateManyDocs(ids, (meta) => {
    const next = present
      ? addTagToList(meta.tags, tag)
      : removeTagFromList(meta.tags, tag);
    return next.length === meta.tags.length &&
      next.every((it, index) => it === meta.tags[index])
      ? null
      : { tags: next };
  });

/**
 * Rename a tag across the *whole* library (not just a selection). Resolves
 * with the number of documents rewritten. Renaming onto an existing tag
 * merges the two.
 */
export const renameTagEverywhere = async (
  from: string,
  to: string,
): Promise<number> =>
  runBatched(async () => {
    const docs = await listDocs();
    let changed = 0;
    for (const doc of docs) {
      const next = renameTagInList(doc.tags, from, to);
      if (
        next.length !== doc.tags.length ||
        next.some((it, index) => it !== doc.tags[index])
      ) {
        await updateDocMeta(doc.id, { tags: next });
        changed++;
      }
    }
    return changed;
  });

/** Remove a tag from every document. Resolves with the number rewritten. */
export const deleteTagEverywhere = async (tag: string): Promise<number> =>
  runBatched(async () => {
    const docs = await listDocs();
    let changed = 0;
    for (const doc of docs) {
      const next = removeTagFromList(doc.tags, tag);
      if (next.length !== doc.tags.length) {
        await updateDocMeta(doc.id, { tags: next });
        changed++;
      }
    }
    return changed;
  });

/**
 * Rename a course node and, crucially, every course nested below it:
 * renaming "MATH 221" to "MATH 230" also moves "MATH 221/Problem sets" to
 * "MATH 230/Problem sets". Resolves with the number of documents rewritten.
 *
 * This is the price of the path-string model (see coursePath.ts); it is paid
 * here, once, in one batched write.
 */
export const renameCourseTree = async (
  from: string,
  to: string,
): Promise<number> =>
  runBatched(async () => {
    const source = normalizeCoursePath(from);
    const target = normalizeCoursePath(to);
    if (!source || !target || source === target) {
      return 0;
    }
    const docs = await listDocs();
    let changed = 0;
    for (const doc of docs) {
      if (!doc.course || !isInCourseTree(doc.course, source)) {
        continue;
      }
      const next = rewriteCoursePath(doc.course, source, target);
      if (next !== doc.course) {
        await updateDocMeta(doc.id, { course: next });
        changed++;
      }
    }
    return changed;
  });

/**
 * Detach a course sub-tree from the library: every document in it loses its
 * course (the documents themselves are never deleted by a folder action).
 */
export const clearCourseTree = async (course: string): Promise<number> =>
  runBatched(async () => {
    const root = normalizeCoursePath(course);
    if (!root) {
      return 0;
    }
    const docs = await listDocs();
    let changed = 0;
    for (const doc of docs) {
      if (doc.course && isInCourseTree(doc.course, root)) {
        await updateDocMeta(doc.id, { course: null });
        changed++;
      }
    }
    return changed;
  });
