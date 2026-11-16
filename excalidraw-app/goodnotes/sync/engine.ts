/**
 * The sync engine: one pass that reconciles this device's library with the
 * server. Framework-free, backend-agnostic, and the only place in this
 * module that is allowed to decide what happens to a user's notes.
 *
 * ## The rule everything else follows
 *
 * **Local is the truth until the server proves otherwise, and nothing is
 * ever overwritten without a copy of what was there.** The app works exactly
 * as it did before sync existed when signed out, offline, or unconfigured;
 * sync only ever *adds* a second copy.
 *
 * ## Conflict strategy — per-document version counters, with a fork
 *
 * Every document row carries a `version` integer. A push is an UPDATE
 * guarded by `version = <the version I last agreed with>`, so two devices
 * pushing from the same base cannot both win: Postgres matches the guard for
 * exactly one of them and the loser's update touches zero rows.
 *
 * This device keeps, per document, the version it last agreed with
 * (`baseVersion`) and the content hash it held at that moment
 * (`baseContentHash`). Those two give four cases:
 *
 * | local changed | server moved | what happens                      |
 * |---------------|--------------|-----------------------------------|
 * | no            | no           | nothing                           |
 * | yes           | no           | push                              |
 * | no            | yes          | pull                              |
 * | yes           | yes          | **fork**                          |
 *
 * A fork keeps the document the student is looking at exactly as it is, and
 * writes the *other* device's version into a NEW document called
 * "Lecture 4 (conflict from iPad)", tagged `conflict`. Then the local
 * version is pushed (it now has the server's blessing) and the copy is
 * pushed as a new document, so both halves exist on both devices. Nothing is
 * merged, nothing is discarded, and the user is told.
 *
 * This is NOT a CRDT. Two people drawing on one page at the same moment do
 * not get their strokes interleaved; they get two documents. For a personal
 * note-taking app where the conflict window is "I forgot to close the iPad",
 * that is the honest trade: a duplicate is annoying, a silently deleted
 * afternoon of lecture notes is not.
 *
 * ## What is never touched
 *
 * The document currently open in the editor is never *overwritten* by a
 * pull. The editor holds the scene in memory and would write it straight
 * back over anything we injected underneath it. Such documents are reported
 * as `deferred` and applied on the next pass after the user navigates away.
 */

import {
  createDoc,
  deleteDoc,
  getDoc,
  getScene,
  listDocs,
  saveScene,
  setThumbnail,
  updateDocMeta,
} from "../library";

import { contentHash, metaHash } from "./hash";
import { dropState, loadStates, putState } from "./state";
import { MAX_SYNCED_THUMBNAIL_BYTES, emptyReport } from "./types";

import type { DocMeta, DocScene } from "../types";
import type { BinaryFile, SyncBackend } from "./backend";
import type {
  DocSyncState,
  RemoteDocRow,
  RemoteMeta,
  ScenePayload,
  SyncReport,
} from "./types";

export interface SyncOptions {
  backend: SyncBackend;
  /** Label written into rows this device writes, e.g. "iPad". */
  device: string;
  /**
   * The document open in the editor right now, if any. Remote updates to it
   * are deferred rather than applied underneath the user.
   */
  activeDocId?: string | null;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** Tag put on every conflict fork so the shelf can surface them. */
export const CONFLICT_TAG = "conflict";

const defaultNow = () => Date.now();

/**
 * Strip anything that could be a URL or a token out of an error before it
 * reaches the UI or a log. Supabase's messages are tame, but an error from
 * `fetch` or a proxy is not necessarily.
 */
export const sanitizeMessage = (error: unknown): string => {
  const raw =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\beyJ[\w-]*\.[\w-]*\.[\w-]*/g, "[token]")
    .slice(0, 200);
};

const titleOf = (meta: Pick<DocMeta, "title">) =>
  meta.title || "Untitled notebook";

const toRemoteMeta = (meta: DocMeta): RemoteMeta => {
  const thumbnail =
    meta.thumbnail && meta.thumbnail.length <= MAX_SYNCED_THUMBNAIL_BYTES
      ? meta.thumbnail
      : null;
  return {
    title: titleOf(meta),
    course: meta.course,
    dueDate: meta.dueDate,
    tags: [...meta.tags],
    pageCount: meta.pageCount,
    defaultTemplate: meta.defaultTemplate,
    defaultPageSize: meta.defaultPageSize,
    ...(meta.defaultLandscape === undefined
      ? {}
      : { defaultLandscape: meta.defaultLandscape }),
    ...(meta.defaultImageFit === undefined
      ? {}
      : { defaultImageFit: meta.defaultImageFit }),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    thumbnail,
  };
};

const remoteToMetaPatch = (row: RemoteDocRow): Partial<DocMeta> => ({
  title: row.title,
  course: row.course,
  dueDate: row.dueDate,
  tags: [...row.tags],
  defaultTemplate: row.defaultTemplate,
  defaultPageSize: row.defaultPageSize,
  ...(row.defaultLandscape === undefined
    ? {}
    : { defaultLandscape: row.defaultLandscape }),
  ...(row.defaultImageFit === undefined
    ? {}
    : { defaultImageFit: row.defaultImageFit }),
  // the client's own timestamp travels with the row, so the shelf's "edited
  // 3 minutes ago" means the same thing on every device
  updatedAt: row.updatedAt,
});

// ---------------------------------------------------------------------------
// scene <-> payload
// ---------------------------------------------------------------------------

const toPayload = (scene: DocScene | null): ScenePayload => ({
  v: 1,
  elements: scene?.elements ?? [],
  appState: scene?.appState ?? {},
  fileIds: Object.keys(scene?.files ?? {}),
});

/**
 * Rebuild a scene from a payload, fetching only the files this device does
 * not already hold. Files are content-addressed, so a file id we already
 * have locally is byte-identical to the remote one and is not downloaded.
 */
const fromPayload = async (
  payload: ScenePayload,
  backend: SyncBackend,
  local: DocScene | null,
): Promise<DocScene> => {
  const files: DocScene["files"] = {};
  for (const fileId of payload.fileIds ?? []) {
    const existing = local?.files?.[fileId];
    if (existing) {
      files[fileId] = existing;
      continue;
    }
    const fetched = await backend.getFile(fileId);
    if (fetched) {
      files[fileId] = fetched;
    }
    // A missing file is survivable: the element renders as a broken image
    // rather than the whole pull failing and the document never arriving.
  }
  return {
    elements: payload.elements ?? [],
    appState: payload.appState ?? {},
    files,
  };
};

// ---------------------------------------------------------------------------
// push / pull
// ---------------------------------------------------------------------------

interface PushOutcome {
  ok: boolean;
  /** True when the version guard rejected us — a peer moved first. */
  conflicted: boolean;
}

const pushDoc = async (
  meta: DocMeta,
  scene: DocScene | null,
  expectedVersion: number,
  options: SyncOptions,
  undelete = false,
): Promise<PushOutcome> => {
  const { backend, device, now = defaultNow } = options;

  // Files first: a scene that references a file the server does not have is
  // a broken document, so the order matters if the pass dies half way.
  for (const file of Object.values(scene?.files ?? {}) as BinaryFile[]) {
    await backend.putFile(file);
  }
  const scenePath = await backend.putScene(meta.id, toPayload(scene));
  const hash = contentHash(meta, scene);

  const result = await backend.commit({
    id: meta.id,
    expectedVersion,
    meta: toRemoteMeta(meta),
    contentHash: hash,
    scenePath,
    device,
    undelete,
  });
  if (!result.ok) {
    return { ok: false, conflicted: true };
  }
  await putState({
    docId: meta.id,
    baseVersion: result.row.version,
    baseContentHash: hash,
    baseMetaHash: metaHash(meta),
    lastSyncedAt: now(),
    lastLocalUpdatedAt: meta.updatedAt,
  });
  return { ok: true, conflicted: false };
};

/** Write a remote document into the local library and record the watermark. */
const pullDoc = async (
  row: RemoteDocRow,
  options: SyncOptions,
  existing: DocMeta | null,
): Promise<void> => {
  const { backend, now = defaultNow } = options;
  const payload = row.scenePath ? await backend.getScene(row.scenePath) : null;
  const localScene = existing ? await getScene(row.id) : null;
  const scene = payload
    ? await fromPayload(payload, backend, localScene)
    : null;

  if (!existing) {
    await createDoc({
      id: row.id,
      title: row.title,
      course: row.course,
      dueDate: row.dueDate,
      tags: [...row.tags],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      pageCount: row.pageCount,
      defaultTemplate: row.defaultTemplate,
      defaultPageSize: row.defaultPageSize,
      ...(row.defaultLandscape === undefined
        ? {}
        : { defaultLandscape: row.defaultLandscape }),
      ...(row.defaultImageFit === undefined
        ? {}
        : { defaultImageFit: row.defaultImageFit }),
    });
  }
  if (scene) {
    await saveScene(row.id, scene);
  }
  // after saveScene, because that call stamps its own updatedAt
  await updateDocMeta(row.id, remoteToMetaPatch(row));
  if (row.thumbnail) {
    await setThumbnail(row.id, row.thumbnail);
  }

  const after = await getDoc(row.id);
  await putState({
    docId: row.id,
    baseVersion: row.version,
    // recomputed from what was actually written, so the next pass compares
    // against reality rather than against what the peer claimed
    baseContentHash: after ? contentHash(after, scene) : row.contentHash,
    baseMetaHash: after ? metaHash(after) : "",
    lastSyncedAt: now(),
    lastLocalUpdatedAt: after?.updatedAt ?? row.updatedAt,
  });
};

/**
 * Fork: the other device's version becomes a new local document, the local
 * version stays exactly where the user left it.
 */
const forkConflict = async (
  row: RemoteDocRow,
  options: SyncOptions,
): Promise<{
  copyId: string;
  copyTitle: string;
  fromDevice: string;
} | null> => {
  const { backend } = options;
  const payload = row.scenePath ? await backend.getScene(row.scenePath) : null;
  const scene = payload ? await fromPayload(payload, backend, null) : null;
  const fromDevice = row.device || "another device";
  const copyTitle = `${titleOf(row)} (conflict from ${fromDevice})`;

  const copy = await createDoc({
    title: copyTitle,
    course: row.course,
    dueDate: row.dueDate,
    tags: [...row.tags.filter((tag) => tag !== CONFLICT_TAG), CONFLICT_TAG],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pageCount: row.pageCount,
    defaultTemplate: row.defaultTemplate,
    defaultPageSize: row.defaultPageSize,
    ...(row.defaultLandscape === undefined
      ? {}
      : { defaultLandscape: row.defaultLandscape }),
    ...(row.defaultImageFit === undefined
      ? {}
      : { defaultImageFit: row.defaultImageFit }),
  });
  if (scene) {
    await saveScene(copy.id, scene);
  }
  if (row.thumbnail) {
    await setThumbnail(copy.id, row.thumbnail);
  }

  // Push the copy immediately: it is the only surviving record of the other
  // device's work on this device, and leaving it unsynced until the next
  // pass is a window in which it exists in exactly one place.
  const copyMeta = await getDoc(copy.id);
  if (copyMeta) {
    const copyScene = await getScene(copy.id);
    await pushDoc(copyMeta, copyScene, 0, options).catch(() => ({
      ok: false,
      conflicted: false,
    }));
  }
  return { copyId: copy.id, copyTitle, fromDevice };
};

// ---------------------------------------------------------------------------
// one document
// ---------------------------------------------------------------------------

const syncOne = async (
  docId: string,
  local: DocMeta | null,
  row: RemoteDocRow | null,
  state: DocSyncState | null,
  options: SyncOptions,
  report: SyncReport,
  allowTombstones: boolean,
): Promise<void> => {
  const { now = defaultNow } = options;

  // ---- local only: never pushed, or the row vanished ----------------------
  if (local && !row) {
    const scene = await getScene(docId);
    const result = await pushDoc(local, scene, 0, options);
    if (result.ok) {
      report.pushed.push(docId);
    }
    return;
  }

  // ---- remote only --------------------------------------------------------
  if (!local && row) {
    if (row.deletedAt) {
      // A tombstone for something we do not have: nothing to do, but stop
      // carrying the watermark around.
      if (state) {
        await dropState(docId);
      }
      return;
    }
    if (state && allowTombstones) {
      // We had it, it is gone locally => the user deleted it here.
      if (row.version !== state.baseVersion) {
        // ...but a peer edited it after that delete. Their edit wins over our
        // delete: a deletion is cheap to repeat, an edit is not recoverable.
        await pullDoc(row, options, null);
        report.pulled.push(docId);
        return;
      }
      const result = await options.backend.softDelete(docId, state.baseVersion);
      if (result.ok) {
        await options.backend.deleteScene(docId);
        await dropState(docId);
        report.deletedRemotely.push(docId);
      }
      return;
    }
    await pullDoc(row, options, null);
    report.pulled.push(docId);
    return;
  }

  if (!local || !row) {
    // state with neither side present: stale watermark
    if (state) {
      await dropState(docId);
    }
    return;
  }

  // ---- both sides present -------------------------------------------------
  if (row.deletedAt) {
    const scene = await getScene(docId);
    const localDirty =
      !state || contentHash(local, scene) !== state.baseContentHash;
    if (localDirty) {
      // Deleted elsewhere, but there is work here that the deleting device
      // never saw. Bring it back rather than destroy it.
      const result = await pushDoc(local, scene, row.version, options, true);
      if (result.ok) {
        report.pushed.push(docId);
      }
      return;
    }
    await deleteDoc(docId);
    await dropState(docId);
    report.deletedLocally.push(docId);
    return;
  }

  // Fast path: nothing has been written locally since the last sync and the
  // row has not moved, so the (potentially multi-megabyte) scene is never
  // read. `updatedAt` is compared for equality, not ordering, and the
  // metadata hash is checked too — a rename landing in the same millisecond
  // as the last sync's snapshot would otherwise slip through until the next
  // edit.
  if (
    state &&
    local.updatedAt === state.lastLocalUpdatedAt &&
    metaHash(local) === state.baseMetaHash &&
    row.version === state.baseVersion
  ) {
    return;
  }

  const scene = await getScene(docId);
  const hash = contentHash(local, scene);

  if (!state) {
    // No watermark (fresh install restored from a backup, say). If the two
    // sides are byte-identical, just adopt the row rather than inventing a
    // conflict out of a document nobody changed.
    if (hash === row.contentHash) {
      await putState({
        docId,
        baseVersion: row.version,
        baseContentHash: hash,
        baseMetaHash: metaHash(local),
        lastSyncedAt: now(),
        lastLocalUpdatedAt: local.updatedAt,
      });
      return;
    }
  }

  const localDirty = !state || hash !== state.baseContentHash;
  const remoteMoved = !state || row.version !== state.baseVersion;

  if (!localDirty && !remoteMoved) {
    return;
  }

  if (localDirty && !remoteMoved) {
    const result = await pushDoc(local, scene, row.version, options);
    if (result.ok) {
      report.pushed.push(docId);
    } else if (result.conflicted) {
      // A peer landed a write between our list and our update. Leave the
      // watermark alone; the next pass sees `remoteMoved` and resolves it
      // properly instead of guessing now.
      report.errors.push(
        `"${titleOf(local)}" changed on another device; retrying.`,
      );
    }
    return;
  }

  if (!localDirty && remoteMoved) {
    if (options.activeDocId === docId) {
      // Applying this underneath an open editor would be overwritten by the
      // editor's next autosave anyway, and would flicker the canvas.
      report.deferred.push(docId);
      return;
    }
    await pullDoc(row, options, local);
    report.pulled.push(docId);
    return;
  }

  // ---- both moved: fork ---------------------------------------------------
  const fork = await forkConflict(row, options);
  if (fork) {
    report.conflicts.push({
      at: now(),
      docId,
      copyId: fork.copyId,
      copyTitle: fork.copyTitle,
      fromDevice: fork.fromDevice,
    });
  }
  // The local version now carries the server's blessing: it is based on the
  // row we just forked away, so pushing it at that version succeeds.
  const result = await pushDoc(local, scene, row.version, options);
  if (result.ok) {
    report.pushed.push(docId);
  }
};

// ---------------------------------------------------------------------------
// one pass
// ---------------------------------------------------------------------------

/**
 * Reconcile every document, once. Resolves with what happened; a failure on
 * one document is recorded in `errors` and never stops the others.
 */
export const syncAll = async (options: SyncOptions): Promise<SyncReport> => {
  const report = emptyReport();

  const [rows, locals, states] = await Promise.all([
    options.backend.listDocs(),
    listDocs(),
    loadStates(),
  ]);

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const localById = new Map(locals.map((meta) => [meta.id, meta]));

  /**
   * Safety catch. If every local document has vanished while watermarks
   * survive, the likely cause is a half-cleared IndexedDB (Safari's ITP
   * eviction, a storage wipe, a failed migration) — not a user deleting
   * their entire library one notebook at a time. Pushing tombstones here
   * would turn a local accident into permanent, cross-device data loss, so
   * this pass pulls everything back instead.
   */
  const allowTombstones = !(localById.size === 0 && states.size > 1);
  if (!allowTombstones) {
    report.errors.push(
      "Local library is empty but this device has synced before — restoring from the server instead of deleting.",
    );
  }

  const ids = new Set<string>([
    ...localById.keys(),
    ...rowById.keys(),
    ...states.keys(),
  ]);

  for (const id of ids) {
    try {
      await syncOne(
        id,
        localById.get(id) ?? null,
        rowById.get(id) ?? null,
        states.get(id) ?? null,
        options,
        report,
        allowTombstones,
      );
    } catch (error) {
      report.errors.push(sanitizeMessage(error));
    }
  }

  return report;
};

/**
 * How many documents have local changes the server has not accepted. Cheap:
 * compares timestamps and never reads a scene.
 */
export const countPending = async (): Promise<number> => {
  const [locals, states] = await Promise.all([listDocs(), loadStates()]);
  let pending = 0;
  for (const meta of locals) {
    const state = states.get(meta.id);
    if (
      !state ||
      state.lastLocalUpdatedAt !== meta.updatedAt ||
      state.baseMetaHash !== metaHash(meta)
    ) {
      pending++;
    }
  }
  return pending;
};
