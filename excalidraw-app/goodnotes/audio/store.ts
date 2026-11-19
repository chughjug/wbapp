/**
 * Where lecture recordings live.
 *
 *   db "goodnotes-audio" / store "recordings" -> Recording, keyed by
 *                                                `<docId>\u0000<startedAt>`
 *
 * Its own database, like scenes and history, and for the sharpest version
 * of the same reason: an hour of audio is by far the largest thing this
 * app will ever store. Nothing that lists notebooks or opens a page may
 * touch it. The key carries the document id so one notebook's recordings
 * can be found by key alone, without reading a single blob.
 *
 * The audio is stored as an `ArrayBuffer`, not a `Blob` and emphatically
 * not a data URL.
 *
 * Against a data URL: base64 inflates by a third and has to exist as a
 * JS string, so a long lecture would sit on the heap as one enormous
 * primitive. Not an option.
 *
 * Against a `Blob` — which is the obvious choice, and what this module
 * stored first — two reasons. Safari has a long history of bugs storing
 * Blobs in IndexedDB, and Safari is the one engine this project cannot
 * test here (the browser download host is blocked by the environment's
 * network policy), so it is the wrong place to rely on the less-trodden
 * path. And `structuredClone` of a Blob is not universally supported by
 * IndexedDB shims, which would make this store untestable.
 *
 * The cost is holding the recording in the heap while it is read, rather
 * than letting the Blob stay on disk. At Opus bitrates that is roughly
 * 14 MB per hour, so even a long lecture is tens of megabytes — real, but
 * affordable, and only while a recording is actually being opened.
 *
 * Marks live in the same record rather than in their own store: they are
 * meaningless without the audio, they are small, and keeping them together
 * means deleting a recording cannot leave them orphaned.
 */

import { createStore, del, get, keys, set } from "idb-keyval";

import type { AudioMark } from "./marks";

const audioStore = createStore("goodnotes-audio", "recordings");

const SEP = "\u0000";

export interface Recording {
  /** Storage key; `<docId>\u0000<startedAt>`. */
  id: string;
  docId: string;
  /** Wall-clock time the recording started. */
  startedAt: number;
  /** Length in ms, as measured by the recorder's own timeline. */
  durationMs: number;
  /** The MIME type the browser actually produced. */
  mimeType: string;
  /** Size in bytes, so the UI can say so without reading the audio. */
  bytes: number;
  /** User-visible label; defaults to the date it was made. */
  label: string;
  marks: AudioMark[];
  audio: ArrayBuffer;
}

/** Everything but the audio — what a list renders. */
export type RecordingSummary = Omit<Recording, "audio">;

/**
 * `blob.arrayBuffer()`, with the fallback older Safari still needs.
 *
 * `Blob.prototype.arrayBuffer` is absent in Safari before 14 — the same
 * engine this module already avoids storing Blobs for — and in jsdom, so
 * the `FileReader` path is both a real compatibility shim and what makes
 * the store testable.
 */
export const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error ?? new Error("could not read the recording"));
    reader.readAsArrayBuffer(blob);
  });
};

export const keyFor = (docId: string, startedAt: number): string =>
  `${docId}${SEP}${String(startedAt).padStart(16, "0")}`;

const parseKey = (
  key: unknown,
): { docId: string; startedAt: number } | null => {
  if (typeof key !== "string") {
    return null;
  }
  const index = key.indexOf(SEP);
  if (index <= 0) {
    return null;
  }
  const startedAt = Number.parseInt(key.slice(index + SEP.length), 10);
  return Number.isFinite(startedAt)
    ? { docId: key.slice(0, index), startedAt }
    : null;
};

const keysFor = async (docId: string): Promise<string[]> => {
  const all = await keys(audioStore);
  return all
    .filter((key): key is string => parseKey(key)?.docId === docId)
    .sort()
    .reverse();
};

const summarise = (recording: Recording): RecordingSummary => ({
  id: recording.id,
  docId: recording.docId,
  startedAt: recording.startedAt,
  durationMs: recording.durationMs,
  mimeType: recording.mimeType,
  bytes: recording.bytes,
  label: recording.label,
  marks: recording.marks,
});

/** One document's recordings, newest first, without their audio blobs. */
export const listRecordings = async (
  docId: string,
): Promise<RecordingSummary[]> => {
  const out: RecordingSummary[] = [];
  for (const key of await keysFor(docId)) {
    const value = (await get(key, audioStore)) as Recording | undefined;
    if (value) {
      out.push(summarise(value));
    }
  }
  return out;
};

/** A whole recording, audio included. */
export const getRecording = async (id: string): Promise<Recording | null> =>
  ((await get(id, audioStore)) as Recording | undefined) ?? null;

/**
 * A recording's audio as a `Blob`, ready for `URL.createObjectURL`.
 *
 * The one place the stored `ArrayBuffer` is turned back into something an
 * `<audio>` element can play, so callers never handle the raw buffer.
 */
export const getRecordingBlob = async (
  id: string,
): Promise<{ blob: Blob; recording: Recording } | null> => {
  const recording = await getRecording(id);
  if (!recording) {
    return null;
  }
  return {
    blob: new Blob([recording.audio], { type: recording.mimeType }),
    recording,
  };
};

export interface SaveRecordingInput {
  docId: string;
  startedAt: number;
  durationMs: number;
  audio: Blob;
  marks: readonly AudioMark[];
  label?: string;
}

/** Default label: the date and time it was made. */
export const defaultLabelFor = (startedAt: number): string =>
  new Date(startedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const saveRecording = async (
  input: SaveRecordingInput,
): Promise<Recording> => {
  const id = keyFor(input.docId, input.startedAt);
  const audio = await blobToArrayBuffer(input.audio);
  const recording: Recording = {
    id,
    docId: input.docId,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    mimeType: input.audio.type || "audio/webm",
    bytes: audio.byteLength,
    label: input.label ?? defaultLabelFor(input.startedAt),
    marks: [...input.marks],
    audio,
  };
  await set(id, recording, audioStore);
  return recording;
};

/** Rename a recording. Returns false when it is already gone. */
export const renameRecording = async (
  id: string,
  label: string,
): Promise<boolean> => {
  const recording = await getRecording(id);
  if (!recording) {
    return false;
  }
  await set(id, { ...recording, label }, audioStore);
  return true;
};

export const deleteRecording = async (id: string): Promise<void> => {
  await del(id, audioStore);
};

/**
 * Forget every recording of one document.
 *
 * Called when a notebook is deleted for real. Unlike the scene, this is
 * not a few hundred kilobytes of JSON — leaving it behind could hold on to
 * hours of audio with no way left to reach it.
 */
export const forgetRecordings = async (docId: string): Promise<number> => {
  const ordered = await keysFor(docId);
  for (const key of ordered) {
    await del(key, audioStore);
  }
  return ordered.length;
};

/** Total recordings and bytes, for the settings screen's storage section. */
export const recordingsSize = async (): Promise<{
  count: number;
  bytes: number;
}> => {
  let count = 0;
  let bytes = 0;
  for (const key of await keys(audioStore)) {
    const value = (await get(key, audioStore)) as Recording | undefined;
    if (value) {
      count += 1;
      bytes += value.bytes;
    }
  }
  return { count, bytes };
};
