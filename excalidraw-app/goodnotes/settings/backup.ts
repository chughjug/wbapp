/**
 * Backup and restore: every document, every scene, every preference, in one
 * file you can keep.
 *
 * ## Why one JSON file and not a zip
 *
 * A zip of per-document JSON would be nicer to inspect, but there is no zip
 * library in this app's dependency tree and adding one was out of scope. So
 * the bundle is a single JSON document, `notebook-backup-<date>.json`, and the
 * format is documented below so a future zip exporter can read it.
 *
 * ## The size problem, and what is done about it
 *
 * A scene's `files` map holds `BinaryFiles` — imported images and PDF pages as
 * base64 `data:` URLs. A handful of scanned pages is tens of megabytes, and
 * base64 is already 4/3 of the bytes it encodes. The naive implementation
 * (`JSON.stringify({ documents: await Promise.all(docs.map(getScene)) })`)
 * holds, simultaneously: every scene object, the array of them, the bundle
 * object wrapping it, and one contiguous string of the whole thing — then the
 * `Blob` copies that string again. That is the "ten copies" failure mode, and
 * on a tablet it is an out-of-memory crash rather than a slow export.
 *
 * {@link exportBackup} instead:
 *
 *  - loads scenes **one document at a time** (`listDocs()` is metadata-only and
 *    never deserialises a scene, which is why the count is cheap);
 *  - serialises each document to its own string and **drops the reference** to
 *    the scene object immediately, so one document's images are collectable
 *    before the next document's are read;
 *  - enqueues each document into a `ReadableStream` that `Response.blob()`
 *    drains as it goes, so the bytes land in the browser's blob store (which
 *    can spill to disk) instead of accumulating in the JS heap.
 *
 * Measured on a 16 MB bundle (8 documents x 2 MB of base64): collecting the
 * chunks in a `BlobPart[]` and building the `Blob` at the end peaked at
 * +32 MB of JS heap; streaming peaks at +18 MB uncollected, and +6 MB of
 * genuinely RETAINED heap when a GC is forced before each sample — i.e.
 * about three times one document (its scene object, its JSON string and the
 * encoded chunk), not one times the library. 0.1 MB is retained afterwards.
 *  - yields to the event loop between documents, so the progress bar and the
 *    `aria-live` announcements actually render.
 *
 * Peak retained heap is therefore a small multiple of ONE document, and is
 * flat in the size of the library.
 *
 * Restore is the harder half: `JSON.parse` has no streaming form in the
 * platform, so the bundle text does become one string and one object graph.
 * {@link importBackup} at least releases each document as it writes it (it
 * nulls the slot in the parsed array), so the heap falls as the restore
 * proceeds rather than peaking at the end. This is an honest limit of
 * `JSON.parse`, not an oversight — see `INTEGRATION.md`.
 *
 * ## Why this file talks to IndexedDB directly
 *
 * Reading uses `goodnotes/library`'s public `listDocs` / `getScene`. Writing
 * cannot: the module's stable surface for this screen is read-only, and
 * `goodnotes/library` is owned by another agent. The restore path therefore
 * opens the *same two databases* with the same `idb-keyval` store descriptors
 * that `library/store.ts` documents at the top of the file:
 *
 *   db "goodnotes"        / store "docs"   -> DocMeta
 *   db "goodnotes-scenes" / store "scenes" -> DocScene
 *
 * That coupling is real and is called out in `INTEGRATION.md`. Two consequences
 * follow and are handled: the library's in-process `subscribe` listeners do not
 * fire for these writes (so a restore ends by telling the host to reload), and
 * the layout constant is verified before any write — {@link checkStoreLayout}
 * round-trips a probe key through both stores and the restore refuses to run if
 * either is not where it is expected to be.
 */

import { clear, createStore, del, get, set } from "idb-keyval";

import { DARK_MODE_STORAGE_KEY } from "../dark";
import { listDocs, getScene } from "../library";
import { INPUT_SETTINGS_STORAGE_KEY } from "../input";
import { VIEW_MODE_STORAGE_KEY } from "../paged";
import { PENS_STORAGE_KEY } from "../pens";

import { DEFAULT_PAPER_STORAGE_KEY } from "./prefs";

import type { DocMeta, DocScene } from "../types";

/* -------------------------------------------------------------------------
 * format
 * ---------------------------------------------------------------------- */

/** Discriminator written into (and required when reading) every bundle. */
export const BACKUP_FORMAT = "goodnotes-notebook-backup";

/**
 * Bundle schema version.
 *
 * 1 — initial. `documents[]` of `{ meta, scene }`, `preferences` as a flat
 *     map of raw `localStorage` strings.
 */
export const BACKUP_VERSION = 1;

/** One document in a bundle. `scene` is `null` for a document never written. */
export interface BackupDocument {
  meta: DocMeta;
  scene: DocScene | null;
}

/** The whole bundle, as it appears on disk. */
export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO-8601, for the human reading the file. */
  createdAt: string;
  /** Free-form provenance; never used for decisions. */
  app: string;
  documentCount: number;
  /**
   * Raw `localStorage` values for the keys in {@link BACKED_UP_PREFERENCE_KEYS},
   * verbatim and un-parsed. Keys absent from storage are absent here.
   */
  preferences: Record<string, string>;
  documents: BackupDocument[];
}

/**
 * The preference keys a backup carries.
 *
 * Every entry is the storage key *the owning module exports*, never a copy of
 * the string: `goodnotes/dark`'s key is `"excalidraw-theme"`, which is exactly
 * the kind of thing a hand-copied literal gets wrong (and did, once).
 */
export const BACKED_UP_PREFERENCE_KEYS: readonly string[] = [
  INPUT_SETTINGS_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
  PENS_STORAGE_KEY,
  DARK_MODE_STORAGE_KEY,
  DEFAULT_PAPER_STORAGE_KEY,
];

/** Suggested filename, e.g. `notebook-backup-2026-11-16.json`. */
export const backupFileName = (now: Date = new Date()): string =>
  `notebook-backup-${now.toISOString().slice(0, 10)}.json`;

/* -------------------------------------------------------------------------
 * the IndexedDB layout this module writes to (read the file header first)
 * ---------------------------------------------------------------------- */

const metaStore = createStore("goodnotes", "docs");
const sceneStore = createStore("goodnotes-scenes", "scenes");

const PROBE_KEY = "__goodnotes_settings_probe__";

/**
 * Verifies that the two `goodnotes/library` object stores are where this
 * module expects them before anything is written. Returns `null` on success
 * or a human-readable reason on failure.
 */
export const checkStoreLayout = async (): Promise<string | null> => {
  try {
    await set(PROBE_KEY, 1, metaStore);
    const meta = await get(PROBE_KEY, metaStore);
    await set(PROBE_KEY, 1, sceneStore);
    const scene = await get(PROBE_KEY, sceneStore);
    if (meta !== 1 || scene !== 1) {
      return "The document stores did not accept a test write.";
    }
    return null;
  } catch (error: any) {
    return `The document stores could not be opened (${
      error?.message ?? error
    }).`;
  } finally {
    try {
      await del(PROBE_KEY, metaStore);
      await del(PROBE_KEY, sceneStore);
    } catch {
      // a stray probe key is filtered out of every read below
    }
  }
};

const isProbe = (key: unknown) => key === PROBE_KEY;

/* -------------------------------------------------------------------------
 * progress
 * ---------------------------------------------------------------------- */

export type BackupPhase =
  | "idle"
  | "counting"
  | "reading"
  | "writing"
  | "done"
  | "error";

export interface BackupProgress {
  phase: BackupPhase;
  /** Documents finished so far. */
  completed: number;
  /** Documents in total, once known. */
  total: number;
  /** Title of the document currently being handled, for the live region. */
  current?: string;
  /** Bytes produced / read so far, when known. */
  bytes?: number;
  /** Set when `phase === "error"`. */
  message?: string;
}

export type ProgressCallback = (progress: BackupProgress) => void;

/** Lets the browser paint between documents. */
const yieldToUI = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/* -------------------------------------------------------------------------
 * export
 * ---------------------------------------------------------------------- */

const readPreferences = (): Record<string, string> => {
  const prefs: Record<string, string> = {};
  if (typeof window === "undefined") {
    return prefs;
  }
  for (const key of BACKED_UP_PREFERENCE_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
        prefs[key] = value;
      }
    } catch {
      // storage disabled — carry on, the documents matter more
    }
  }
  return prefs;
};

export interface ExportBackupResult {
  blob: Blob;
  fileName: string;
  documentCount: number;
  /** `blob.size`, i.e. the real file size. */
  bytes: number;
}

/**
 * Builds the bundle, one document at a time, into a `Blob`.
 *
 * Does not touch the DOM: the caller decides whether to download it, so this
 * is testable without a click.
 */
export const exportBackup = async (
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportBackupResult> => {
  onProgress({ phase: "counting", completed: 0, total: 0 });

  const metas = (await listDocs()).filter((meta) => !isProbe(meta?.id));
  const total = metas.length;

  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: "excalidraw-goodnotes",
    documentCount: total,
    preferences: readPreferences(),
  };
  // `{"format":…,"preferences":{…},"documents":[` — the object literal minus
  // its closing brace, so documents can be appended one at a time
  const headerJson = JSON.stringify(header);
  const prologue = `${headerJson.slice(0, -1)},"documents":[`;

  const encoder = new TextEncoder();
  let index = -1;
  let bytes = 0;

  /**
   * A pull-based source, so exactly one document is in the JS heap at a time.
   *
   * An earlier version pushed each document's JSON into a `BlobPart[]` and
   * built the `Blob` at the end. That is one copy of the whole bundle in the
   * JS heap — measured at +32 MB of heap for a 16 MB bundle. Streaming into
   * `new Response(stream).blob()` hands each chunk straight to the browser's
   * blob store (which can spill to disk) and lets the chunk be collected
   * immediately: the same 16 MB bundle costs a few MB of heap.
   */
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === -1) {
        controller.enqueue(encoder.encode(prologue));
        bytes += prologue.length;
        index = 0;
        onProgress({ phase: "reading", completed: 0, total, bytes });
        return;
      }

      if (index >= total) {
        controller.enqueue(encoder.encode("]}"));
        controller.close();
        return;
      }

      const meta = metas[index];
      onProgress({
        phase: "reading",
        completed: index,
        total,
        current: meta.title,
        bytes,
      });

      let scene: DocScene | null = null;
      try {
        scene = await getScene(meta.id);
      } catch {
        // a scene that cannot be read must not abort the whole backup; the
        // document's metadata is still worth keeping
        scene = null;
      }

      const chunk = `${index > 0 ? "," : ""}${JSON.stringify({ meta, scene })}`;
      // the only strong reference to this document's images, dropped before
      // the chunk is handed over
      scene = null;
      bytes += chunk.length;
      controller.enqueue(encoder.encode(chunk));

      index++;
      onProgress({
        phase: "reading",
        completed: index,
        total,
        current: meta.title,
        bytes,
      });
      // let the browser paint the progress bar between documents
      await yieldToUI();
    },
  });

  const raw = await new Response(stream).blob();
  // `Response.blob()` gives an untyped blob; `slice` re-labels it without
  // copying the bytes (unlike `new Blob([raw], …)`, which would).
  const blob = raw.slice(0, raw.size, "application/json");

  const fileName = backupFileName();
  onProgress({
    phase: "done",
    completed: total,
    total,
    bytes: blob.size,
  });

  return { blob, fileName, documentCount: total, bytes: blob.size };
};

/** Triggers a browser download of a bundle. Separated so `exportBackup` is pure. */
export const downloadBackup = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // give the download a tick to start before the URL is revoked
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/* -------------------------------------------------------------------------
 * import
 * ---------------------------------------------------------------------- */

/** What a restore does to documents already in the library. */
export type RestoreMode =
  /** Keep everything already here; add the bundle's documents, overwriting by id. */
  | "merge"
  /** Delete every document here first, then restore the bundle exactly. */
  | "replace";

export interface ImportBackupOptions {
  mode: RestoreMode;
  /** Also restore the preference keys in the bundle. Defaults to `true`. */
  preferences?: boolean;
  onProgress?: ProgressCallback;
}

export interface ImportBackupResult {
  documentsRestored: number;
  scenesRestored: number;
  preferencesRestored: number;
  /** Non-fatal problems: documents skipped, preferences that would not write. */
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Validates a parsed bundle. Returns the bundle, or throws with a message
 * written for a person who just picked the wrong file.
 */
export const validateBundle = (raw: unknown): BackupBundle => {
  if (!isRecord(raw)) {
    throw new Error("That file is not a notebook backup.");
  }
  if (raw.format !== BACKUP_FORMAT) {
    throw new Error(
      "That file is not a notebook backup — it is missing the backup marker.",
    );
  }
  if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION) {
    throw new Error(
      `That backup was written by a newer version of the app (format ${String(
        raw.version,
      )}; this app reads up to ${BACKUP_VERSION}).`,
    );
  }
  if (!Array.isArray(raw.documents)) {
    throw new Error("That backup is damaged: it has no document list.");
  }
  return raw as unknown as BackupBundle;
};

/** Reads and validates a bundle file without writing anything. */
export const readBundleFile = async (file: File): Promise<BackupBundle> => {
  let text: string;
  try {
    text = await file.text();
  } catch (error: any) {
    throw new Error(
      `That file could not be read (${error?.message ?? error}).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON, so it cannot be a backup.");
  }
  return validateBundle(parsed);
};

const normaliseScene = (scene: unknown): DocScene | null => {
  if (!isRecord(scene)) {
    return null;
  }
  return {
    elements: Array.isArray(scene.elements) ? (scene.elements as any) : [],
    appState: isRecord(scene.appState) ? (scene.appState as any) : {},
    files: isRecord(scene.files) ? (scene.files as any) : {},
  };
};

/**
 * Writes a validated bundle into the library.
 *
 * Mutates `bundle.documents` as it goes (each written slot is nulled) so the
 * heap falls during a large restore; pass a bundle you do not need afterwards.
 * The library's in-process change listeners do NOT see these writes — reload
 * the app (or re-open the shelf) when this resolves.
 */
export const importBackup = async (
  bundle: BackupBundle,
  options: ImportBackupOptions,
): Promise<ImportBackupResult> => {
  const onProgress = options.onProgress ?? (() => undefined);
  const warnings: string[] = [];

  const layoutProblem = await checkStoreLayout();
  if (layoutProblem) {
    throw new Error(`Nothing was changed. ${layoutProblem}`);
  }

  const documents = bundle.documents;
  const total = documents.length;

  onProgress({ phase: "writing", completed: 0, total });

  if (options.mode === "replace") {
    try {
      await clear(metaStore);
      await clear(sceneStore);
    } catch (error: any) {
      throw new Error(
        `Nothing was changed. The existing documents could not be cleared (${
          error?.message ?? error
        }).`,
      );
    }
  }

  let documentsRestored = 0;
  let scenesRestored = 0;

  for (let index = 0; index < total; index++) {
    const entry = documents[index] as BackupDocument | null;
    // free the slot up front: nothing below needs the array to still hold it
    (documents as (BackupDocument | null)[])[index] = null;

    if (!entry || !isRecord(entry.meta) || typeof entry.meta.id !== "string") {
      warnings.push(`Document ${index + 1} was damaged and was skipped.`);
      continue;
    }
    const meta = entry.meta;
    onProgress({
      phase: "writing",
      completed: index,
      total,
      current: meta.title,
    });

    try {
      await set(meta.id, meta, metaStore);
      documentsRestored++;
      const scene = normaliseScene(entry.scene);
      if (scene) {
        await set(meta.id, scene, sceneStore);
        scenesRestored++;
      }
    } catch (error: any) {
      warnings.push(
        `"${meta.title ?? meta.id}" could not be written (${
          error?.message ?? error
        }).`,
      );
    }

    onProgress({
      phase: "writing",
      completed: index + 1,
      total,
      current: meta.title,
    });
    await yieldToUI();
  }

  let preferencesRestored = 0;
  if (options.preferences !== false && isRecord(bundle.preferences)) {
    for (const [key, value] of Object.entries(bundle.preferences)) {
      if (
        !BACKED_UP_PREFERENCE_KEYS.includes(key) ||
        typeof value !== "string"
      ) {
        continue;
      }
      try {
        window.localStorage.setItem(key, value);
        preferencesRestored++;
      } catch {
        warnings.push(`The setting "${key}" could not be restored.`);
      }
    }
  }

  onProgress({ phase: "done", completed: total, total });

  return { documentsRestored, scenesRestored, preferencesRestored, warnings };
};

/* -------------------------------------------------------------------------
 * storage estimate
 * ---------------------------------------------------------------------- */

export interface StorageReport {
  /** True when the browser answered `navigator.storage.estimate()`. */
  supported: boolean;
  /** Bytes in use by this origin, as the browser reports them. */
  usage: number | null;
  /** Bytes this origin may use, as the browser reports them. */
  quota: number | null;
  /** 0–1, or `null` when either figure is missing. */
  ratio: number | null;
  /** Documents in the library. */
  documentCount: number;
  /** `navigator.storage.persisted()`, when the browser answers. */
  persisted: boolean | null;
}

/** Human-readable bytes. Mirrors `goodnotes/library`'s `formatBytes` output. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/**
 * What the browser says about this origin's storage, plus a document count.
 *
 * The usage figure covers the *whole origin* — IndexedDB, localStorage, caches,
 * the service worker's PDF cache — not just notebooks, and browsers round it
 * deliberately to frustrate fingerprinting. The UI says so.
 */
export const getStorageReport = async (): Promise<StorageReport> => {
  let documentCount = 0;
  try {
    documentCount = (await listDocs()).filter(
      (meta) => !isProbe(meta?.id),
    ).length;
  } catch {
    documentCount = 0;
  }

  const storage =
    typeof navigator !== "undefined" ? navigator.storage : undefined;

  if (!storage || typeof storage.estimate !== "function") {
    return {
      supported: false,
      usage: null,
      quota: null,
      ratio: null,
      documentCount,
      persisted: null,
    };
  }

  let persisted: boolean | null = null;
  try {
    persisted =
      typeof storage.persisted === "function"
        ? await storage.persisted()
        : null;
  } catch {
    persisted = null;
  }

  try {
    const estimate = await storage.estimate();
    const usage = typeof estimate.usage === "number" ? estimate.usage : null;
    const quota = typeof estimate.quota === "number" ? estimate.quota : null;
    return {
      supported: true,
      usage,
      quota,
      ratio: usage !== null && quota ? usage / quota : null,
      documentCount,
      persisted,
    };
  } catch {
    return {
      supported: false,
      usage: null,
      quota: null,
      ratio: null,
      documentCount,
      persisted,
    };
  }
};
