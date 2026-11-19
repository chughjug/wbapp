/**
 * Lecture audio, as one hook the editor can hold.
 *
 * Owns three things that have to stay in step and are painful apart:
 *
 *   1. the recorder and its clock,
 *   2. the marks being collected as strokes appear, and
 *   3. playback of a saved recording, including seeking from a stroke.
 *
 * `noteSceneChange` is the bridge from the editor's hot `onChange` path.
 * It is deliberately cheap: a set lookup per element and nothing else
 * while not recording, because it runs on every pointer move of every
 * stroke. Marks accumulate in a ref — not state — so collecting one never
 * re-renders the editor.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { collectMarks, indexMarks, seedSeen, seekTargetFor } from "./marks";
import { AudioRecorderError, startRecording } from "./recorder";
import {
  deleteRecording,
  forgetRecordings,
  getRecordingBlob,
  listRecordings,
  renameRecording,
  saveRecording,
} from "./store";

import type { AudioMark, MarkableElement } from "./marks";
import type { AudioRecorderHandle } from "./recorder";
import type { RecordingSummary } from "./store";

export type AudioPhase = "idle" | "recording" | "paused";

export interface UseAudioResult {
  phase: AudioPhase;
  /** Milliseconds recorded so far, updated about twice a second. */
  elapsedMs: number;
  /** Most recent error, for the bar to show. */
  error: string | null;
  clearError: () => void;

  recordings: RecordingSummary[];
  /** The recording currently loaded for playback, if any. */
  playingId: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;

  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;

  open: (id: string) => Promise<void>;
  togglePlay: () => void;
  seekMs: (ms: number) => void;
  close: () => void;
  remove: (id: string) => Promise<void>;
  rename: (id: string, label: string) => Promise<void>;

  /** Call from the editor's `onChange`. Cheap when not recording. */
  noteSceneChange: (elements: readonly MarkableElement[]) => void;
  /**
   * Jump playback to when `elementId` was written. Returns false when the
   * stroke was not written during the loaded recording, so a caller can
   * stay quiet rather than seeking to zero.
   */
  seekToElement: (elementId: string) => boolean;
  /** Does the loaded recording know about this element? */
  hasMarkFor: (elementId: string) => boolean;
}

export const useAudio = (docId: string | null): UseAudioResult => {
  const [phase, setPhase] = useState<AudioPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const handleRef = useRef<AudioRecorderHandle | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  /**
   * Has the "already on the page" set been taken yet?
   *
   * A separate flag rather than `seen.size === 0`, which looks equivalent
   * and is not: starting a recording on a blank page gives an empty set,
   * so a size check would re-seed on every scene change and never mark
   * anything — on the single commonest case there is, a fresh notebook at
   * the start of a lecture.
   */
  const seededRef = useRef(false);
  const marksRef = useRef<AudioMark[]>([]);
  const startedAtRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const markIndexRef = useRef<Map<string, number>>(new Map());
  const docIdRef = useRef(docId);
  docIdRef.current = docId;

  const refresh = useCallback(async () => {
    if (!docId) {
      setRecordings([]);
      return;
    }
    try {
      setRecordings(await listRecordings(docId));
    } catch {
      // a list that cannot be read is not worth an error banner over the
      // notebook; the record button still works
      setRecordings([]);
    }
  }, [docId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ---- recording ---------------------------------------------------- */

  const start = useCallback(async () => {
    if (handleRef.current || !docIdRef.current) {
      return;
    }
    setError(null);
    try {
      const handle = await startRecording();
      handleRef.current = handle;
      startedAtRef.current = Date.now();
      marksRef.current = [];
      // whatever is already on the page was written before the lecture
      // began; seeding stops every old stroke marking at 0:00
      seenRef.current = new Set();
      seededRef.current = false;
      setElapsedMs(0);
      setPhase("recording");
    } catch (caught) {
      setError(
        caught instanceof AudioRecorderError
          ? caught.message
          : "Recording could not be started.",
      );
    }
  }, []);

  const pause = useCallback(() => {
    handleRef.current?.pause();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    handleRef.current?.resume();
    setPhase("recording");
  }, []);

  const stop = useCallback(async () => {
    const handle = handleRef.current;
    const docIdNow = docIdRef.current;
    if (!handle) {
      return;
    }
    handleRef.current = null;
    setPhase("idle");
    try {
      const { blob, durationMs: length } = await handle.stop();
      // A recording with no audio in it is a failure dressed as a
      // success — saving it would leave an unplayable row in the list.
      if (docIdNow && blob.size > 0) {
        await saveRecording({
          docId: docIdNow,
          startedAt: startedAtRef.current,
          durationMs: length,
          audio: blob,
          marks: marksRef.current,
        });
        await refresh();
      } else if (blob.size === 0) {
        setError("Nothing was recorded — the microphone produced no audio.");
      }
    } catch (caught) {
      setError(
        caught instanceof AudioRecorderError
          ? caught.message
          : "The recording could not be saved.",
      );
    } finally {
      marksRef.current = [];
      setElapsedMs(0);
    }
  }, [refresh]);

  // tick the displayed timer; the authoritative clock is the recorder's
  useEffect(() => {
    if (phase !== "recording") {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedMs(handleRef.current?.elapsedMs() ?? 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  /**
   * Stop and save if the editor unmounts mid-recording.
   *
   * Closing the notebook with the microphone live and losing the lecture
   * is the single worst thing this feature could do, so unmount saves
   * rather than cancels.
   */
  useEffect(
    () => () => {
      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      handleRef.current = null;
      const docIdNow = docIdRef.current;
      const startedAt = startedAtRef.current;
      const marks = marksRef.current;
      void handle
        .stop()
        .then(({ blob, durationMs: length }) => {
          if (docIdNow && blob.size > 0) {
            return saveRecording({
              docId: docIdNow,
              startedAt,
              durationMs: length,
              audio: blob,
              marks,
            });
          }
          return undefined;
        })
        .catch(() => undefined);
    },
    [],
  );

  const noteSceneChange = useCallback(
    (elements: readonly MarkableElement[]) => {
      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      if (!seededRef.current) {
        seenRef.current = seedSeen(elements);
        seededRef.current = true;
        return;
      }
      const fresh = collectMarks(elements, seenRef.current, handle.elapsedMs());
      if (fresh.length > 0) {
        marksRef.current.push(...fresh);
      }
    },
    [],
  );

  /* ---- playback ------------------------------------------------------ */

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    releaseUrl();
    markIndexRef.current = new Map();
    setPlayingId(null);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
  }, [releaseUrl]);

  useEffect(() => close, [close]);

  const open = useCallback(
    async (id: string) => {
      close();
      const loaded = await getRecordingBlob(id);
      if (!loaded) {
        setError("That recording is no longer stored.");
        await refresh();
        return;
      }
      const url = URL.createObjectURL(loaded.blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.preload = "metadata";
      audio.ontimeupdate = () => setPositionMs(audio.currentTime * 1000);
      audio.onplay = () => setIsPlaying(true);
      audio.onpause = () => setIsPlaying(false);
      audio.onended = () => setIsPlaying(false);
      audioRef.current = audio;
      markIndexRef.current = indexMarks(loaded.recording.marks);
      setPlayingId(id);
      // the stored duration, not the element's: a WebM recording produced
      // by MediaRecorder frequently reports Infinity until it is played
      // through, and a scrubber cannot be drawn against Infinity
      setDurationMs(loaded.recording.durationMs);
      setPositionMs(0);
    },
    [close, refresh],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => setError("The recording could not play."));
    } else {
      audio.pause();
    }
  }, []);

  const seekMs = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = Math.max(0, ms) / 1000;
    setPositionMs(Math.max(0, ms));
  }, []);

  const seekToElement = useCallback(
    (elementId: string) => {
      const target = seekTargetFor(markIndexRef.current, elementId);
      if (target === null) {
        return false;
      }
      seekMs(target);
      void audioRef.current?.play().catch(() => undefined);
      return true;
    },
    [seekMs],
  );

  const hasMarkFor = useCallback(
    (elementId: string) => markIndexRef.current.has(elementId),
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      if (playingId === id) {
        close();
      }
      await deleteRecording(id);
      await refresh();
    },
    [close, playingId, refresh],
  );

  const rename = useCallback(
    async (id: string, label: string) => {
      await renameRecording(id, label);
      await refresh();
    },
    [refresh],
  );

  return {
    phase,
    elapsedMs,
    error,
    clearError: () => setError(null),
    recordings,
    playingId,
    isPlaying,
    positionMs,
    durationMs,
    start,
    pause,
    resume,
    stop,
    open,
    togglePlay,
    seekMs,
    close,
    remove,
    rename,
    noteSceneChange,
    seekToElement,
    hasMarkFor,
  };
};

export { forgetRecordings };
