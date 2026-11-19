/**
 * Page version history.
 *
 * The trash made *deleting a notebook* reversible. This module covers the
 * other way a term of notes goes missing, which is quieter and more common:
 * you erase half a page, keep working, and the debounced autosave writes the
 * damage over the only copy there was. Undo dies with the tab; by the next
 * morning there is nothing to go back to.
 *
 * So the library keeps dated snapshots of each document and offers to put
 * one back.
 *
 * Storage layout (IndexedDB, via `idb-keyval`):
 *
 *   db "goodnotes-history" / store "versions" -> Snapshot, keyed by
 *                                                `<docId>\u0000<at>`
 *
 * A separate database for the same reason the scene store is separate — see
 * the comment in `library/store.ts` — and because snapshots are by far the
 * heaviest thing the app stores. Nothing in the shelf or the editor's hot
 * path opens this database at all; it is read only when the history panel is
 * opened and written at most once per `SNAPSHOT_INTERVAL_MS` per document.
 *
 * The key carries the timestamp so the whole of one document's history can
 * be listed by key range without deserialising a single element array. That
 * matters: `listSnapshots` runs to render a panel of dates, and a notebook
 * with a term of PDF-backed pages can hold several megabytes per snapshot.
 *
 * What is NOT here: a diff format. Each snapshot is a whole scene. Storing
 * deltas would cut the size by a large factor, but a corrupt or missing
 * delta anywhere in the chain takes every later version with it, and this
 * feature exists precisely for the case where something has already gone
 * wrong. Whole copies fail independently.
 */

import { createStore, del, get, keys, set } from "idb-keyval";

import { PAGE_FRAME_PREFIX } from "../types";

import {
  HISTORY_RETENTION_MS,
  shouldSnapshot,
  snapshotsToDrop,
} from "./policy";

import type { DocScene } from "../types";

import type { SnapshotHeader } from "./policy";

const historyStore = createStore("goodnotes-history", "versions");

/** Separates document id from timestamp in a key. Not legal in an id. */
const SEP = "\u0000";

/** Why a snapshot was taken, for labelling it in the panel. */
export type SnapshotReason =
  /** The periodic automatic snapshot. */
  | "auto"
  /** The user asked for one explicitly. */
  | "manual"
  /** Taken of the *current* state just before a restore overwrote it. */
  | "before-restore";

export interface Snapshot extends SnapshotHeader {
  docId: string;
  reason: SnapshotReason;
  /** Page count at the time, so the panel can say "12 pages" without a read. */
  pageCount: number;
  scene: DocScene;
}

/** Everything but the scene — what the panel lists. */
export type SnapshotSummary = Omit<Snapshot, "scene">;

const keyFor = (docId: string, at: number): string =>
  `${docId}${SEP}${String(at).padStart(16, "0")}`;

const parseKey = (key: unknown): { docId: string; at: number } | null => {
  if (typeof key !== "string") {
    return null;
  }
  const index = key.indexOf(SEP);
  if (index <= 0) {
    return null;
  }
  const at = Number.parseInt(key.slice(index + SEP.length), 10);
  return Number.isFinite(at) ? { docId: key.slice(0, index), at } : null;
};

const countPagesIn = (scene: DocScene): number =>
  scene.elements.filter(
    (element) =>
      !element.isDeleted &&
      element.type === "frame" &&
      typeof element.name === "string" &&
      element.name.startsWith(PAGE_FRAME_PREFIX),
  ).length;

/** All snapshot keys belonging to one document, newest first. */
const keysFor = async (docId: string): Promise<string[]> => {
  const all = await keys(historyStore);
  return all
    .filter((key): key is string => {
      const parsed = parseKey(key);
      return parsed !== null && parsed.docId === docId;
    })
    .sort()
    .reverse();
};

/**
 * One document's snapshots, newest first, without their scenes.
 *
 * Reads every value, because `idb-keyval` has no "read these fields only" —
 * so this is the one genuinely expensive call in the module, and it is only
 * ever made when the user opens the history panel.
 */
export const listSnapshots = async (
  docId: string,
): Promise<SnapshotSummary[]> => {
  const ordered = await keysFor(docId);
  const out: SnapshotSummary[] = [];
  for (const key of ordered) {
    const value = (await get(key, historyStore)) as Snapshot | undefined;
    if (value) {
      const summary: SnapshotSummary = {
        id: value.id,
        docId: value.docId,
        at: value.at,
        reason: value.reason,
        pinned: value.pinned,
        pageCount: value.pageCount,
      };
      out.push(summary);
    }
  }
  return out;
};

/** A single snapshot, scene included, or null when it has been thinned away. */
export const getSnapshot = async (id: string): Promise<Snapshot | null> =>
  ((await get(id, historyStore)) as Snapshot | undefined) ?? null;

/** When the newest snapshot of `docId` was taken, or null for no history. */
export const latestSnapshotAt = async (
  docId: string,
): Promise<number | null> => {
  const [newest] = await keysFor(docId);
  return newest ? parseKey(newest)?.at ?? null : null;
};

/**
 * Write a snapshot unconditionally, then thin the document's history.
 *
 * Callers that want the rate limit applied should use `maybeSnapshot`.
 */
export const takeSnapshot = async (
  docId: string,
  scene: DocScene,
  at: number,
  reason: SnapshotReason = "auto",
): Promise<Snapshot> => {
  const id = keyFor(docId, at);
  const snapshot: Snapshot = {
    id,
    docId,
    at,
    reason,
    pinned: reason !== "auto",
    pageCount: countPagesIn(scene),
    scene: {
      elements: scene.elements.filter((element) => !element.isDeleted),
      appState: scene.appState,
      files: scene.files ?? {},
    },
  };
  await set(id, snapshot, historyStore);
  await thinHistory(docId, at);
  return snapshot;
};

/**
 * Take a snapshot only if the rate limit allows one.
 *
 * Returns the snapshot taken, or null when the document already has a recent
 * enough one. This is what the save path calls, so it must be cheap in the
 * common case: a key listing and no value reads.
 */
export const maybeSnapshot = async (
  docId: string,
  scene: DocScene,
  at: number,
): Promise<Snapshot | null> => {
  const latest = await latestSnapshotAt(docId);
  if (!shouldSnapshot(latest, at)) {
    return null;
  }
  return takeSnapshot(docId, scene, at, "auto");
};

/** Apply the thinning policy to one document, dropping what it discards. */
export const thinHistory = async (
  docId: string,
  now: number,
): Promise<number> => {
  const ordered = await keysFor(docId);
  const headers: SnapshotHeader[] = [];
  for (const key of ordered) {
    const parsed = parseKey(key);
    if (!parsed) {
      continue;
    }
    const value = (await get(key, historyStore)) as Snapshot | undefined;
    headers.push({ id: key, at: parsed.at, pinned: value?.pinned });
  }
  const drop = snapshotsToDrop(headers, now);
  for (const id of drop) {
    await del(id, historyStore);
  }
  return drop.length;
};

/**
 * Pin or unpin a snapshot, exempting it from thinning.
 *
 * Returns false when the snapshot is already gone, which is not an error —
 * thinning may have taken it between the panel rendering and the tap.
 */
export const setSnapshotPinned = async (
  id: string,
  pinned: boolean,
): Promise<boolean> => {
  const snapshot = await getSnapshot(id);
  if (!snapshot) {
    return false;
  }
  await set(id, { ...snapshot, pinned }, historyStore);
  return true;
};

/** Forget one document's entire history. Called when it is deleted for real. */
export const forgetHistory = async (docId: string): Promise<number> => {
  const ordered = await keysFor(docId);
  for (const key of ordered) {
    await del(key, historyStore);
  }
  return ordered.length;
};

/**
 * Drop snapshots of every document that are past the retention window.
 *
 * Called on library load, like the trash purge. Documents that are never
 * opened again would otherwise keep their history for ever.
 */
export const purgeExpiredHistory = async (
  now: number,
  retention: number = HISTORY_RETENTION_MS,
): Promise<number> => {
  const all = await keys(historyStore);
  const newestOf = new Map<string, number>();
  const parsed: { key: string; docId: string; at: number }[] = [];

  for (const key of all) {
    const entry = parseKey(key);
    if (!entry) {
      continue;
    }
    parsed.push({ key: String(key), ...entry });
    const seen = newestOf.get(entry.docId) ?? 0;
    if (entry.at > seen) {
      newestOf.set(entry.docId, entry.at);
    }
  }

  let dropped = 0;
  for (const entry of parsed) {
    // never strand a document with no history at all
    if (newestOf.get(entry.docId) === entry.at) {
      continue;
    }
    if (now - entry.at > retention) {
      const value = (await get(entry.key, historyStore)) as
        | Snapshot
        | undefined;
      if (value?.pinned) {
        continue;
      }
      await del(entry.key, historyStore);
      dropped += 1;
    }
  }
  return dropped;
};

/** Total bytes-ish of stored history, for the settings screen. */
export const historySize = async (): Promise<{
  count: number;
  documents: number;
}> => {
  const all = await keys(historyStore);
  const docs = new Set<string>();
  for (const key of all) {
    const parsed = parseKey(key);
    if (parsed) {
      docs.add(parsed.docId);
    }
  }
  return { count: all.length, documents: docs.size };
};
