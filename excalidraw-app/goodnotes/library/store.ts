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

const emitChange = () => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: any) {
      console.error("goodnotes/library: listener threw", error);
    }
  }
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const now = () => Date.now();

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
    updatedAt: patch.updatedAt ?? now(),
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
        updatedAt: now(),
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
