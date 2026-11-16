/**
 * An in-memory {@link SyncBackend}, used to exercise the engine without a
 * Supabase project.
 *
 * It is not a mock in the "returns whatever the test wants" sense: it
 * enforces the same version guard the real backend relies on (an UPDATE
 * matching `version = expectedVersion`), the same insert-collision
 * behaviour, the same tombstones, and the same content-addressed file
 * store. A conflict in this fake is a conflict in Postgres.
 *
 * It lives in `testing/` and is not re-exported from the module's `index.ts`,
 * so it never reaches the bundle.
 */

import type {
  BinaryFile,
  CommitInput,
  CommitResult,
  SyncBackend,
} from "../backend";
import type { RemoteDocRow, ScenePayload } from "../types";

export interface FakeServer extends SyncBackend {
  /** Everything the "server" holds, for assertions. */
  rows: Map<string, RemoteDocRow>;
  scenes: Map<string, ScenePayload>;
  files: Map<string, BinaryFile>;
  /** Request counters, so a test can prove what was NOT uploaded. */
  counts: {
    listDocs: number;
    putScene: number;
    getScene: number;
    putFile: number;
    getFile: number;
    commit: number;
  };
  /** Make the next N calls of any kind throw, simulating a dead network. */
  failNext: (count: number) => void;
}

export const createFakeBackend = (userId = "user-1"): FakeServer => {
  const rows = new Map<string, RemoteDocRow>();
  const scenes = new Map<string, ScenePayload>();
  const files = new Map<string, BinaryFile>();
  const counts = {
    listDocs: 0,
    putScene: 0,
    getScene: 0,
    putFile: 0,
    getFile: 0,
    commit: 0,
  };
  let failures = 0;

  const guard = () => {
    if (failures > 0) {
      failures--;
      throw new Error("network down");
    }
  };

  const scenePath = (docId: string) => `${userId}/${docId}/scene.json`;

  const backend: FakeServer = {
    rows,
    scenes,
    files,
    counts,
    failNext: (count: number) => {
      failures = count;
    },

    listDocs: async () => {
      guard();
      counts.listDocs++;
      // structural copies: a test must not be able to mutate "the server"
      // by holding on to a row it was handed.
      return [...rows.values()].map((row) => ({ ...row, tags: [...row.tags] }));
    },

    getScene: async (path: string) => {
      guard();
      counts.getScene++;
      const payload = scenes.get(path);
      return payload
        ? (JSON.parse(JSON.stringify(payload)) as ScenePayload)
        : null;
    },

    putScene: async (docId: string, payload: ScenePayload) => {
      guard();
      counts.putScene++;
      const path = scenePath(docId);
      scenes.set(path, JSON.parse(JSON.stringify(payload)) as ScenePayload);
      return path;
    },

    deleteScene: async (docId: string) => {
      guard();
      scenes.delete(scenePath(docId));
    },

    getFile: async (fileId: string) => {
      guard();
      counts.getFile++;
      const file = files.get(fileId);
      return file ? (JSON.parse(JSON.stringify(file)) as BinaryFile) : null;
    },

    putFile: async (file: BinaryFile) => {
      guard();
      counts.putFile++;
      // content-addressed: writing an id that exists is a no-op
      if (!files.has(file.id)) {
        files.set(file.id, JSON.parse(JSON.stringify(file)) as BinaryFile);
      }
    },

    commit: async (input: CommitInput): Promise<CommitResult> => {
      guard();
      counts.commit++;
      const existing = rows.get(input.id);

      if (input.expectedVersion === 0) {
        if (existing) {
          return { ok: false, reason: "conflict" };
        }
        const row: RemoteDocRow = {
          ...input.meta,
          tags: [...input.meta.tags],
          id: input.id,
          version: 1,
          contentHash: input.contentHash,
          device: input.device,
          deletedAt: null,
          scenePath: input.scenePath,
        };
        rows.set(row.id, row);
        return { ok: true, row: { ...row } };
      }

      if (!existing || existing.version !== input.expectedVersion) {
        // exactly what `.eq("version", n)` does when a peer moved first
        return { ok: false, reason: "conflict" };
      }
      const row: RemoteDocRow = {
        ...input.meta,
        tags: [...input.meta.tags],
        id: input.id,
        version: existing.version + 1,
        contentHash: input.contentHash,
        device: input.device,
        deletedAt: input.undelete ? null : existing.deletedAt,
        scenePath: input.scenePath,
      };
      rows.set(row.id, row);
      return { ok: true, row: { ...row } };
    },

    softDelete: async (
      docId: string,
      expectedVersion: number,
    ): Promise<CommitResult> => {
      guard();
      const existing = rows.get(docId);
      if (!existing || existing.version !== expectedVersion) {
        return { ok: false, reason: "conflict" };
      }
      const row: RemoteDocRow = {
        ...existing,
        version: existing.version + 1,
        deletedAt: Date.now(),
        scenePath: null,
      };
      rows.set(docId, row);
      return { ok: true, row: { ...row } };
    },
  };

  return backend;
};
