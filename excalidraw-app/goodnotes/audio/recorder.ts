/**
 * The microphone.
 *
 * A thin, testable state machine over `MediaRecorder`. Everything that can
 * realistically go wrong with recording in a browser goes wrong *here*,
 * with a message a student can act on, rather than surfacing as a dead
 * button:
 *
 * - **Permission refused**, or dismissed, or previously refused and now
 *   remembered by the browser. The commonest case by far, and the one with
 *   the least obvious remedy, so the message names the address bar.
 * - **No microphone at all** — a desktop with nothing plugged in.
 * - **The device is in use** by another app, which some platforms report
 *   and others silently allow.
 * - **No usable codec.** `MediaRecorder` exists in every current browser
 *   but the container support differs; the preference list below is tried
 *   in order and the browser's own default is the last resort.
 * - **An insecure context.** `getUserMedia` is undefined on plain HTTP,
 *   which otherwise reads as "your browser is too old".
 *
 * The recorder owns its own clock rather than trusting wall time, because
 * pausing has to stop it. `elapsedMs()` is what marks are placed against,
 * so a mark taken after a two-minute pause points at the right audio.
 */

/** Containers to try, best first. Opus is small and widely supported. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export class AudioRecorderError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AudioRecorderError";
    this.cause = cause;
  }
}

export type RecorderState = "idle" | "recording" | "paused" | "stopping";

/** The first supported container, or "" to let the browser choose. */
export const pickMimeType = (
  isTypeSupported?: (type: string) => boolean,
): string => {
  const supported =
    isTypeSupported ??
    (typeof MediaRecorder !== "undefined"
      ? MediaRecorder.isTypeSupported?.bind(MediaRecorder)
      : undefined);
  if (!supported) {
    return "";
  }
  return PREFERRED_TYPES.find((type) => supported(type)) ?? "";
};

/**
 * Turn a `getUserMedia` rejection into something worth reading.
 *
 * The DOM names are precise and meaningless to a user: `NotAllowedError`
 * covers both "you said no" and "your browser remembers you saying no
 * last term", and that second case is the one people get stuck on.
 */
export const describeMicError = (error: unknown): string => {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "The microphone is blocked. Allow it for this site — in most browsers that is the icon at the left of the address bar — then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is in use by another app. Close that one and try again.";
    case "OverconstrainedError":
      return "This microphone cannot record at the quality asked for.";
    default:
      return "Recording could not be started.";
  }
};

export interface AudioRecorderHandle {
  state: () => RecorderState;
  /** Milliseconds recorded so far, not counting time spent paused. */
  elapsedMs: () => number;
  pause: () => void;
  resume: () => void;
  /** Stop, release the microphone, and resolve with the audio. */
  stop: () => Promise<{ blob: Blob; durationMs: number }>;
  /** Give up without producing a file (e.g. the document is closing). */
  cancel: () => void;
}

export interface StartRecordingOptions {
  /** Test seam for `navigator.mediaDevices`. */
  mediaDevices?: MediaDevices;
  /** Test seam for the `MediaRecorder` constructor. */
  recorderFactory?: (
    stream: MediaStream,
    options: MediaRecorderOptions,
  ) => MediaRecorder;
  /** Test seam for the clock. */
  now?: () => number;
}

/**
 * Open the microphone and start recording.
 *
 * Rejects with an `AudioRecorderError` carrying a readable message; the
 * microphone is released on every failure path, including a failure to
 * construct the recorder after permission was granted — forgetting that
 * leaves the recording indicator lit with nothing recording, which is
 * alarming in exactly the setting this feature is used in.
 */
export const startRecording = async (
  options: StartRecordingOptions = {},
): Promise<AudioRecorderHandle> => {
  const devices =
    options.mediaDevices ??
    (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);

  if (!devices?.getUserMedia) {
    throw new AudioRecorderError(
      "This browser will not give a page the microphone unless the page is served over HTTPS.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({ audio: true });
  } catch (error) {
    throw new AudioRecorderError(describeMicError(error), error);
  }

  const release = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    const factory =
      options.recorderFactory ??
      ((s: MediaStream, o: MediaRecorderOptions) => new MediaRecorder(s, o));
    recorder = factory(stream, mimeType ? { mimeType } : {});
  } catch (error) {
    release();
    throw new AudioRecorderError(
      "This browser cannot record audio in any format the app understands.",
      error,
    );
  }

  const clock = options.now ?? (() => Date.now());
  const chunks: Blob[] = [];
  let state: RecorderState = "recording";
  let runStartedAt = clock();
  let accumulated = 0;

  const elapsedMs = () =>
    state === "recording"
      ? accumulated + (clock() - runStartedAt)
      : accumulated;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  // A timeslice means chunks arrive as we go rather than in one lump at
  // stop. If the tab is killed mid-lecture the already-delivered chunks
  // are at least in memory for the stop handler, and on a long recording
  // it keeps the recorder's internal buffer small.
  recorder.start(5000);

  const stop = () =>
    new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => {
      if (state === "idle") {
        reject(new AudioRecorderError("The recording has already stopped."));
        return;
      }
      // freeze the duration before the async stop, or a slow stop event
      // would pad every recording by however long it took to flush
      const durationMs = elapsedMs();
      state = "stopping";

      recorder.onstop = () => {
        release();
        state = "idle";
        resolve({
          blob: new Blob(chunks, {
            type: recorder.mimeType || mimeType || "audio/webm",
          }),
          durationMs,
        });
      };
      recorder.onerror = (event) => {
        release();
        state = "idle";
        reject(
          new AudioRecorderError("The recording failed while saving.", event),
        );
      };

      try {
        recorder.stop();
      } catch (error) {
        release();
        state = "idle";
        reject(
          new AudioRecorderError("The recording could not be stopped.", error),
        );
      }
    });

  return {
    state: () => state,
    elapsedMs,
    pause: () => {
      if (state !== "recording") {
        return;
      }
      accumulated += clock() - runStartedAt;
      state = "paused";
      recorder.pause();
    },
    resume: () => {
      if (state !== "paused") {
        return;
      }
      runStartedAt = clock();
      state = "recording";
      recorder.resume();
    },
    stop,
    cancel: () => {
      state = "idle";
      try {
        recorder.stop();
      } catch {
        // already stopped; the microphone still has to be released
      }
      release();
    },
  };
};
