/**
 * The narrow interface the sync engine talks to.
 *
 * The engine knows nothing about Supabase. Everything that touches the
 * network is behind this interface, for two reasons:
 *
 *  1. the conflict logic is the part that can lose a student's notes, and it
 *     has to be testable without a server (see `testing/fakeBackend.ts`);
 *  2. the engine can then be exercised in CI, where there is no project to
 *     talk to.
 */

import type { DocScene } from "../types";
import type { RemoteDocRow, RemoteMeta, ScenePayload } from "./types";

/** One binary file (image / imported PDF page) as Excalidraw stores it. */
export type BinaryFile = DocScene["files"][string];

/** A write attempt against one document row. */
export interface CommitInput {
  id: string;
  /**
   * The version this write is based on. `0` means "I believe this document
   * does not exist on the server yet" and becomes an insert. Anything else
   * becomes an update guarded by `version = expectedVersion`, which is what
   * makes a lost update impossible rather than unlikely.
   */
  expectedVersion: number;
  meta: RemoteMeta;
  contentHash: string;
  scenePath: string | null;
  device: string;
  /** Bring a soft-deleted row back to life (a resurrect after a delete). */
  undelete?: boolean;
}

/**
 * Why a commit did not happen. `conflict` is the interesting one: the guard
 * matched no row, so somebody else moved the document first.
 */
export type CommitResult =
  | { ok: true; row: RemoteDocRow }
  | { ok: false; reason: "conflict" };

export interface SyncBackend {
  /** Every row for the signed-in user, tombstones included. */
  listDocs: () => Promise<RemoteDocRow[]>;

  /** Read a scene blob by its storage key. `null` when it is missing. */
  getScene: (path: string) => Promise<ScenePayload | null>;

  /** Write a scene blob. Resolves with the storage key written. */
  putScene: (docId: string, payload: ScenePayload) => Promise<string>;

  /** Delete a document's scene blob. Missing is success. */
  deleteScene: (docId: string) => Promise<void>;

  /** Read one content-addressed file, or null when absent. */
  getFile: (fileId: string) => Promise<BinaryFile | null>;

  /** Upload one file. Must be idempotent — files are content-addressed. */
  putFile: (file: BinaryFile) => Promise<void>;

  /** Insert or guarded-update one row. */
  commit: (input: CommitInput) => Promise<CommitResult>;

  /** Soft-delete, guarded by version. Keeps a tombstone so peers learn of it. */
  softDelete: (docId: string, expectedVersion: number) => Promise<CommitResult>;
}
