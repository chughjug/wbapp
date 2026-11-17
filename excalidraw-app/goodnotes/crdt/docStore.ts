/**
 * Yjs + IndexedDB persistence for a notebook (or classroom room).
 *
 * This does **not** replace Excalidraw's E2EE socket collab. It adds a
 * local-first CRDT buffer so:
 *  - scene snapshots survive reloads offline (`y-indexeddb`)
 *  - classroom rooms can share a Y.Doc identity for presence/history
 *  - Freero-style version history can append snapshots into a Y.Array
 *
 * Keep the Excalidraw engine as source of truth while editing; push snapshots
 * into the Y.Doc on a debounce (see {@link useCrdtDoc}).
 */

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

export type CrdtRole = "owner" | "editor" | "viewer";

export interface CrdtSnapshot {
  id: string;
  createdAt: number;
  label: string;
  /** JSON string of { elements, appState? } — kept small on purpose. */
  payload: string;
  author?: string;
}

export interface CrdtDocHandle {
  docId: string;
  ydoc: Y.Doc;
  persistence: IndexeddbPersistence;
  snapshots: Y.Array<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
  whenSynced: Promise<void>;
  destroy: () => void;
}

const PREFIX = "gn-crdt:";

export const crdtStorageKey = (docId: string): string => `${PREFIX}${docId}`;

export const openCrdtDoc = (docId: string): CrdtDocHandle => {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(crdtStorageKey(docId), ydoc);
  const snapshots = ydoc.getArray<Y.Map<unknown>>("snapshots");
  const meta = ydoc.getMap("meta");

  if (!meta.has("role")) {
    const defaultRole: CrdtRole = "owner";
    meta.set("role", defaultRole);
  }

  const whenSynced = new Promise<void>((resolve) => {
    if (persistence.synced) {
      resolve();
      return;
    }
    persistence.once("synced", () => resolve());
  });

  return {
    docId,
    ydoc,
    persistence,
    snapshots,
    meta,
    whenSynced,
    destroy: () => {
      persistence.destroy();
      ydoc.destroy();
    },
  };
};

export const readRole = (handle: CrdtDocHandle): CrdtRole => {
  const role = handle.meta.get("role");
  return role === "editor" || role === "viewer" || role === "owner"
    ? role
    : "owner";
};

export const setRole = (handle: CrdtDocHandle, role: CrdtRole) => {
  handle.meta.set("role", role);
};

export const listSnapshots = (handle: CrdtDocHandle): CrdtSnapshot[] => {
  const out: CrdtSnapshot[] = [];
  handle.snapshots.forEach((entry) => {
    const id = entry.get("id");
    const createdAt = entry.get("createdAt");
    const label = entry.get("label");
    const payload = entry.get("payload");
    if (
      typeof id === "string" &&
      typeof createdAt === "number" &&
      typeof label === "string" &&
      typeof payload === "string"
    ) {
      const author = entry.get("author");
      out.push({
        id,
        createdAt,
        label,
        payload,
        author: typeof author === "string" ? author : undefined,
      });
    }
  });
  // newest first; `id` breaks ties when two snaps share a millisecond
  return out.sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  );
};

/** Strictly increasing clock so rapid appends still sort newest-first. */
const nextCreatedAt = (handle: CrdtDocHandle): number => {
  let latest = 0;
  handle.snapshots.forEach((entry) => {
    const createdAt = entry.get("createdAt");
    if (typeof createdAt === "number" && createdAt > latest) {
      latest = createdAt;
    }
  });
  return Math.max(Date.now(), latest + 1);
};

export const appendSnapshot = (
  handle: CrdtDocHandle,
  input: {
    label: string;
    payload: string;
    author?: string;
    /** Cap retained history (Freero-style). Default 30. */
    keep?: number;
  },
): CrdtSnapshot => {
  const snap: CrdtSnapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nextCreatedAt(handle),
    label: input.label,
    payload: input.payload,
    author: input.author,
  };

  const map = new Y.Map<unknown>();
  map.set("id", snap.id);
  map.set("createdAt", snap.createdAt);
  map.set("label", snap.label);
  map.set("payload", snap.payload);
  if (snap.author) {
    map.set("author", snap.author);
  }

  handle.ydoc.transact(() => {
    handle.snapshots.push([map]);
    const keep = input.keep ?? 30;
    while (handle.snapshots.length > keep) {
      handle.snapshots.delete(0, 1);
    }
  });

  return snap;
};
