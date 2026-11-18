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
import { createStore, del, entries, get, set } from "idb-keyval";

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
  await set(id, payload, sceneStore);

  const meta = await getDoc(id);
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
  }
  emitChange();
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
      void saveScene(id, entry.scene);
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
      return saveScene(id, entry.scene);
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

/** Remove a document's metadata and its scene payload. */
export const deleteDoc = async (id: string): Promise<void> => {
  const pending = pendingSaves.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSaves.delete(id);
  }
  await Promise.all([del(id, metaStore), del(id, sceneStore)]);
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

/** Delete many documents (metadata + scenes). Resolves with the count. */
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
