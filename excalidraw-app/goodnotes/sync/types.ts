/**
 * Types local to `goodnotes/sync`.
 *
 * `goodnotes/types.ts` is the shared contract and is owned by the integrator,
 * so nothing here widens `DocMeta` or `DocScene`. Everything sync needs *in
 * addition* to a document (its remote version, the hash it was last in sync
 * at) lives in this module's own IndexedDB database — see `state.ts`.
 */

import type { DocMeta, DocScene } from "../types";

// ---------------------------------------------------------------------------
// per-document sync bookkeeping
// ---------------------------------------------------------------------------

/**
 * What this device knows about one document's relationship to the server.
 *
 * `baseVersion` / `baseContentHash` are a two-sided watermark: together they
 * answer "has the server moved since I last agreed with it?" and "have I
 * moved?". Conflict detection is exactly the case where both answers are yes.
 */
export interface DocSyncState {
  docId: string;
  /** Remote `version` this device last agreed with. 0 = never pushed. */
  baseVersion: number;
  /** Content hash of the local document at that moment. */
  baseContentHash: string;
  /**
   * Hash of the metadata half alone. Cheap to recompute (no scene read), so
   * the fast path below can be wrong-but-safe rather than wrong-and-quiet:
   * a rename that lands in the same millisecond as the last sync is still
   * noticed.
   */
  baseMetaHash: string;
  /** Epoch ms of the last successful push or pull for this document. */
  lastSyncedAt: number;
  /**
   * The local `DocMeta.updatedAt` at that moment.
   *
   * A fast path, and a load-bearing one: every local write bumps
   * `updatedAt`, so `local.updatedAt === lastLocalUpdatedAt` means nothing
   * has been written here since the last sync and the (potentially
   * multi-megabyte) scene does not need to be read to find that out. It is
   * compared for *equality*, never ordering, so a write racing the pass is
   * seen as a change rather than missed.
   */
  lastLocalUpdatedAt: number;
}

// ---------------------------------------------------------------------------
// the wire shapes
// ---------------------------------------------------------------------------

/** Document metadata as it travels to and from the server. */
export interface RemoteMeta {
  title: string;
  course: string | null;
  dueDate: number | null;
  tags: string[];
  pageCount: number;
  defaultTemplate: DocMeta["defaultTemplate"];
  defaultPageSize: DocMeta["defaultPageSize"];
  defaultLandscape?: boolean;
  defaultImageFit?: DocMeta["defaultImageFit"];
  createdAt: number;
  /** The client's own `updatedAt`; the row's `updated_at` is server time. */
  updatedAt: number;
  /** data: URL PNG, or null. Dropped above {@link MAX_SYNCED_THUMBNAIL_BYTES}. */
  thumbnail: string | null;
}

/** One row of the `documents` table, as this module sees it. */
export interface RemoteDocRow extends RemoteMeta {
  id: string;
  /** Monotonic per-document counter. Every accepted write increments it. */
  version: number;
  /** Content hash the server row was written with. */
  contentHash: string;
  /** Label of the device that wrote this version ("iPad", "Mac", …). */
  device: string | null;
  /** Epoch ms of the soft delete, or null for a live document. */
  deletedAt: number | null;
  /** Storage key of the scene JSON, or null for a document with no scene. */
  scenePath: string | null;
}

/**
 * A scene as it is stored in the `scenes` bucket.
 *
 * Binary files are **not** inlined: they are content-addressed blobs in the
 * `files` bucket, referenced here by id. Without that split, one ink stroke
 * on a notebook containing a 20 MB imported PDF would re-upload 20 MB.
 */
export interface ScenePayload {
  v: 1;
  elements: DocScene["elements"];
  appState: DocScene["appState"];
  fileIds: string[];
}

/** Thumbnails above this are left local-only rather than bloating the row. */
export const MAX_SYNCED_THUMBNAIL_BYTES = 96 * 1024;

// ---------------------------------------------------------------------------
// status surfaced to the UI
// ---------------------------------------------------------------------------

export type SyncPhase =
  /** No env vars: the module does nothing at all. */
  | "disabled"
  /** Configured, nobody signed in. Everything still works locally. */
  | "signed-out"
  /** Signed in, nothing to do. */
  | "idle"
  /** A pass is running. */
  | "syncing"
  /** Signed in but the network is unreachable; work is queued locally. */
  | "offline"
  /** The last pass failed. Local editing is unaffected. */
  | "error";

/** One conflict that was resolved by forking a copy. */
export interface ConflictRecord {
  at: number;
  /** The document the user kept working in (their local version). */
  docId: string;
  /** The new local document holding the other device's version. */
  copyId: string;
  copyTitle: string;
  /** Device label the other version came from, e.g. "iPad". */
  fromDevice: string;
}

/** Everything a host needs to render sync state. Never contains secrets. */
export interface SyncStatus {
  /** Env vars present and sane. */
  configured: boolean;
  phase: SyncPhase;
  /** Signed-in user's email, or null. */
  email: string | null;
  userId: string | null;
  lastSyncedAt: number | null;
  /** Documents with local changes the server has not accepted yet. */
  pending: number;
  /**
   * Documents with a newer server version that was deliberately NOT applied
   * because the document is open in the editor (see `engine.ts`).
   */
  deferred: string[];
  /** Conflict forks from this session, newest last. */
  conflicts: ConflictRecord[];
  /** Last error, already made safe to show. Never a token or a URL. */
  error: string | null;
}

/** Outcome of one full pass, for tests and for the status line. */
export interface SyncReport {
  pushed: string[];
  pulled: string[];
  deletedLocally: string[];
  deletedRemotely: string[];
  deferred: string[];
  conflicts: ConflictRecord[];
  errors: string[];
}

export const emptyReport = (): SyncReport => ({
  pushed: [],
  pulled: [],
  deletedLocally: [],
  deletedRemotely: [],
  deferred: [],
  conflicts: [],
  errors: [],
});
