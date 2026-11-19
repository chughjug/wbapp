import { clear, createStore } from "idb-keyval";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectMarks,
  formatTimecode,
  indexMarks,
  isMarkable,
  LEAD_IN_MS,
  seedSeen,
  seekTargetFor,
} from "./marks";
import {
  AudioRecorderError,
  describeMicError,
  pickMimeType,
  startRecording,
} from "./recorder";
import {
  defaultLabelFor,
  deleteRecording,
  forgetRecordings,
  getRecording,
  getRecordingBlob,
  listRecordings,
  renameRecording,
  saveRecording,
} from "./store";

const audioStore = createStore("goodnotes-audio", "recordings");

const el = (id: string, type = "freedraw", isDeleted = false) => ({
  id,
  type,
  isDeleted,
});

describe("which strokes get a mark", () => {
  it("marks the things you would tap to ask what was being said", () => {
    expect(isMarkable(el("a", "freedraw"))).toBe(true);
    expect(isMarkable(el("b", "text"))).toBe(true);
    expect(isMarkable(el("c", "arrow"))).toBe(true);
  });

  it("skips frames and images", () => {
    // a page is not a moment, and an image arrives by import rather than
    // by being written during the lecture
    expect(isMarkable(el("f", "frame"))).toBe(false);
    expect(isMarkable(el("i", "image"))).toBe(false);
  });

  it("skips deleted elements", () => {
    expect(isMarkable(el("d", "freedraw", true))).toBe(false);
  });
});

describe("collecting marks while recording", () => {
  it("marks only what is new since the last look", () => {
    const seen = new Set<string>();
    expect(collectMarks([el("a")], seen, 1000)).toEqual([
      { elementId: "a", atMs: 1000 },
    ]);
    // same element again at a later time: already seen, no second mark
    expect(collectMarks([el("a"), el("b")], seen, 5000)).toEqual([
      { elementId: "b", atMs: 5000 },
    ]);
  });

  it("does not mark what was on the page before recording started", () => {
    // otherwise every old stroke on the page jumps to 0:00
    const existing = [el("old1"), el("old2")];
    const seen = seedSeen(existing);

    expect(collectMarks([...existing, el("new")], seen, 2000)).toEqual([
      { elementId: "new", atMs: 2000 },
    ]);
  });

  it("does not seed frames, so a page added mid-lecture is not a mark", () => {
    const seen = seedSeen([el("page", "frame")]);
    expect(seen.has("page")).toBe(false);
  });
});

describe("seeking from a stroke", () => {
  it("keeps the first appearance when an element is marked twice", () => {
    // a stroke edited later still belongs to the moment it was written
    const index = indexMarks([
      { elementId: "a", atMs: 1000 },
      { elementId: "a", atMs: 9000 },
    ]);
    expect(index.get("a")).toBe(1000);
  });

  it("backs up a few seconds, because you write things down after they are said", () => {
    const index = indexMarks([{ elementId: "a", atMs: 30_000 }]);
    expect(seekTargetFor(index, "a")).toBe(30_000 - LEAD_IN_MS);
  });

  it("does not seek before the start of the recording", () => {
    const index = indexMarks([{ elementId: "a", atMs: 1200 }]);
    expect(seekTargetFor(index, "a")).toBe(0);
  });

  it("returns null for a stroke that was not written during this recording", () => {
    expect(seekTargetFor(indexMarks([]), "nope")).toBeNull();
  });
});

describe("timecodes", () => {
  it("reads as m:ss under an hour", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(9_000)).toBe("0:09");
    expect(formatTimecode(65_000)).toBe("1:05");
    expect(formatTimecode(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("grows an hours field past an hour", () => {
    expect(formatTimecode(3_600_000)).toBe("1:00:00");
    expect(formatTimecode(3_661_000)).toBe("1:01:01");
  });

  it("does not show a negative time", () => {
    expect(formatTimecode(-5_000)).toBe("0:00");
  });
});

describe("microphone failures", () => {
  it("tells someone whose browser is remembering an old refusal what to do", () => {
    const message = describeMicError({ name: "NotAllowedError" });
    expect(message).toMatch(/address bar/i);
  });

  it("distinguishes no microphone from a blocked one", () => {
    expect(describeMicError({ name: "NotFoundError" })).toMatch(
      /no microphone/i,
    );
    expect(describeMicError({ name: "NotReadableError" })).toMatch(
      /another app/i,
    );
  });

  it("has something to say about an error it has never seen", () => {
    expect(describeMicError(new Error("???"))).toMatch(/could not be started/i);
  });

  it("explains an insecure context rather than failing silently", async () => {
    await expect(
      startRecording({ mediaDevices: {} as MediaDevices }),
    ).rejects.toThrow(/HTTPS/);
  });

  it("releases the microphone when the recorder cannot be constructed", async () => {
    // forgetting this leaves the browser's recording indicator lit with
    // nothing recording, in the middle of a lecture
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    } as unknown as MediaDevices;

    await expect(
      startRecording({
        mediaDevices,
        recorderFactory: () => {
          throw new Error("no codec");
        },
      }),
    ).rejects.toBeInstanceOf(AudioRecorderError);
    expect(stop).toHaveBeenCalled();
  });

  it("picks the first supported container and falls back to the browser's", () => {
    expect(pickMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });
});

describe("the recorder's clock", () => {
  /** A MediaRecorder stand-in; jsdom has none. */
  const fakeRecorder = () => {
    const recorder = {
      mimeType: "audio/webm",
      ondataavailable: null as ((e: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(() => recorder.onstop?.()),
    };
    return recorder;
  };

  const harness = async () => {
    let t = 0;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const recorder = fakeRecorder();
    const handle = await startRecording({
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      } as unknown as MediaDevices,
      recorderFactory: () => recorder as unknown as MediaRecorder,
      now: () => t,
    });
    return { handle, recorder, release: stop, tick: (ms: number) => (t += ms) };
  };

  it("does not count time spent paused", async () => {
    // a mark taken after a pause must point at the right audio, so the
    // recorder's own clock has to stop when the recording does
    const { handle, tick } = await harness();
    tick(10_000);
    handle.pause();
    tick(120_000);
    handle.resume();
    tick(5_000);

    expect(handle.elapsedMs()).toBe(15_000);
  });

  it("freezes the duration at stop rather than at flush", async () => {
    const { handle, tick } = await harness();
    tick(30_000);
    const stopping = handle.stop();
    tick(4_000); // a slow flush must not pad the recording
    await expect(stopping).resolves.toMatchObject({ durationMs: 30_000 });
  });

  it("releases the microphone on stop", async () => {
    const { handle, release } = await harness();
    await handle.stop();
    expect(release).toHaveBeenCalled();
  });

  it("releases the microphone on cancel", async () => {
    const { handle, release } = await harness();
    handle.cancel();
    expect(release).toHaveBeenCalled();
    expect(handle.state()).toBe("idle");
  });

  it("ignores resume when not paused, and pause when not recording", async () => {
    const { handle, recorder } = await harness();
    handle.resume();
    expect(recorder.resume).not.toHaveBeenCalled();
    handle.pause();
    handle.pause();
    expect(recorder.pause).toHaveBeenCalledTimes(1);
  });
});

describe("storing recordings", () => {
  beforeEach(async () => {
    await clear(audioStore);
  });

  const blob = (text = "audio") => new Blob([text], { type: "audio/webm" });

  it("saves and reads one back with its marks", async () => {
    await saveRecording({
      docId: "doc1",
      startedAt: 1000,
      durationMs: 60_000,
      audio: blob(),
      marks: [{ elementId: "a", atMs: 5000 }],
    });

    const [summary] = await listRecordings("doc1");
    expect(summary.durationMs).toBe(60_000);
    expect(summary.marks).toEqual([{ elementId: "a", atMs: 5000 }]);

    const full = await getRecording(summary.id);
    expect(full?.audio).toBeInstanceOf(ArrayBuffer);

    // and it comes back out as something an <audio> element can play
    const playable = await getRecordingBlob(summary.id);
    expect(playable?.blob).toBeInstanceOf(Blob);
    expect(playable?.blob.type).toBe("audio/webm");
  });

  it("lists newest first and keeps documents apart", async () => {
    await saveRecording({
      docId: "doc1",
      startedAt: 1000,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });
    await saveRecording({
      docId: "doc1",
      startedAt: 9000,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });
    await saveRecording({
      docId: "doc2",
      startedAt: 5000,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });

    expect((await listRecordings("doc1")).map((r) => r.startedAt)).toEqual([
      9000, 1000,
    ]);
    expect(await listRecordings("doc2")).toHaveLength(1);
  });

  it("labels a recording by when it was made, and can be renamed", async () => {
    const saved = await saveRecording({
      docId: "doc1",
      startedAt: 1700000000000,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });
    expect(saved.label).toBe(defaultLabelFor(1700000000000));

    expect(await renameRecording(saved.id, "Lecture 4")).toBe(true);
    expect((await getRecording(saved.id))?.label).toBe("Lecture 4");
    expect(await renameRecording("missing", "x")).toBe(false);
  });

  it("deletes one, and forgets a whole document's", async () => {
    const a = await saveRecording({
      docId: "doc1",
      startedAt: 1,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });
    await saveRecording({
      docId: "doc1",
      startedAt: 2,
      durationMs: 1,
      audio: blob(),
      marks: [],
    });

    await deleteRecording(a.id);
    expect(await listRecordings("doc1")).toHaveLength(1);

    expect(await forgetRecordings("doc1")).toBe(1);
    expect(await listRecordings("doc1")).toHaveLength(0);
  });

  it("records the byte size so a list need not read the audio", async () => {
    const saved = await saveRecording({
      docId: "doc1",
      startedAt: 1,
      durationMs: 1,
      audio: blob("a longer piece of audio"),
      marks: [],
    });
    expect(saved.bytes).toBeGreaterThan(0);
    expect((await listRecordings("doc1"))[0].bytes).toBe(saved.bytes);
  });
});

describe("seeding the seen-set", () => {
  it("marks the first stroke on a blank page", () => {
    // Regression: an earlier version decided "have I seeded yet?" by
    // `seen.size === 0`, which is empty-and-seeded on a fresh notebook —
    // so it re-seeded on every change and never marked anything, on the
    // commonest case there is. The hook now tracks seeding separately;
    // this pins the behaviour the hook depends on.
    const seen = seedSeen([]);
    expect(seen.size).toBe(0);

    // once seeded, the first stroke is new and must be marked
    expect(collectMarks([el("first")], seen, 2500)).toEqual([
      { elementId: "first", atMs: 2500 },
    ]);
  });
});
