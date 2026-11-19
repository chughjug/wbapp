/**
 * Which part of the recording each stroke was written during.
 *
 * This is the half of lecture audio that makes it worth having. A plain
 * voice memo alongside a notebook is nearly useless an hour later: you
 * remember that the lecturer explained the thing you half-wrote down, and
 * finding *where* means scrubbing a fifty-minute file. Tapping the scribble
 * and landing on the moment it was written is the whole feature.
 *
 * A "mark" is one pair: an element id, and how far into the recording it
 * first appeared. Marks are collected by watching the scene for elements
 * that were not there a moment ago — see `collectMarks` — rather than by
 * writing timestamps onto the elements themselves. That choice matters:
 *
 * - Mutating every stroke as it is drawn would put a scene write in the
 *   middle of the drawing hot path, and make each stroke's `customData` a
 *   thing the autosave, the cross-tab merge and undo all have to carry.
 * - Marks belong to the *recording*, not to the drawing. Deleting the
 *   audio should take them with it, and it does — they live in the same
 *   record. A stroke outlives the recording it was made during, and when
 *   the audio is gone the stroke is just a stroke again.
 *
 * Erased strokes keep their marks. The mark costs two numbers, the element
 * may come back via undo, and a mark pointing at an element that no longer
 * exists is simply never looked up.
 */

/** One stroke, and when during the recording it appeared. */
export interface AudioMark {
  elementId: string;
  /** Milliseconds from the start of the recording. */
  atMs: number;
}

/**
 * Element ids worth marking.
 *
 * Only things a student would tap to ask "what was being said here":
 * strokes, text, shapes and arrows. Not frames — a page is not a moment —
 * and not images, which arrive by import rather than by being written.
 */
const MARKABLE_TYPES = new Set([
  "freedraw",
  "line",
  "arrow",
  "text",
  "rectangle",
  "ellipse",
  "diamond",
]);

export interface MarkableElement {
  readonly id: string;
  readonly type: string;
  readonly isDeleted?: boolean;
}

export const isMarkable = (element: MarkableElement): boolean =>
  !element.isDeleted && MARKABLE_TYPES.has(element.type);

/**
 * New marks for elements in `elements` that `seen` has not got yet.
 *
 * Mutates `seen` — it is the caller's running set for one recording, and
 * copying it on every scene change would be a per-stroke allocation of the
 * whole document.
 *
 * `atMs` is passed in rather than read from a clock so a caller can place
 * marks against the recording's own timeline, which pauses when the
 * recording pauses and is not the wall clock.
 */
export const collectMarks = (
  elements: readonly MarkableElement[],
  seen: Set<string>,
  atMs: number,
): AudioMark[] => {
  const fresh: AudioMark[] = [];
  for (const element of elements) {
    if (!isMarkable(element) || seen.has(element.id)) {
      continue;
    }
    seen.add(element.id);
    fresh.push({ elementId: element.id, atMs });
  }
  return fresh;
};

/**
 * Seed the "already seen" set from the scene as it stands.
 *
 * Called once when recording starts: everything already on the page was
 * written before the lecture began and must not be marked at zero, or
 * every old stroke on the page would jump to the start of the audio.
 */
export const seedSeen = (elements: readonly MarkableElement[]): Set<string> => {
  const seen = new Set<string>();
  for (const element of elements) {
    if (isMarkable(element)) {
      seen.add(element.id);
    }
  }
  return seen;
};

/** Index marks by element id, newest-wins, for fast lookup during playback. */
export const indexMarks = (
  marks: readonly AudioMark[],
): Map<string, number> => {
  const index = new Map<string, number>();
  for (const mark of marks) {
    // first appearance is the interesting one: a stroke that was edited
    // later still belongs to the moment it was written
    if (!index.has(mark.elementId)) {
      index.set(mark.elementId, mark.atMs);
    }
  }
  return index;
};

/**
 * Where to seek to for `elementId`, with a little lead-in.
 *
 * Seeking to the exact millisecond a stroke appeared lands you *after* the
 * sentence that prompted it — you write a thing down once it has been
 * said. Backing up a few seconds is what makes the jump useful rather than
 * merely accurate.
 */
export const LEAD_IN_MS = 4000;

export const seekTargetFor = (
  index: ReadonlyMap<string, number>,
  elementId: string,
  leadIn: number = LEAD_IN_MS,
): number | null => {
  const at = index.get(elementId);
  return at === undefined ? null : Math.max(0, at - leadIn);
};

/** `m:ss`, or `h:mm:ss` past an hour. For the scrubber's readouts. */
export const formatTimecode = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
