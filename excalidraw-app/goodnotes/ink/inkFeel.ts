/**
 * INK FEEL — the handwriting-latency preference, app side.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two separate things make a stylus feel laggy or "mushy" in Excalidraw:
 *
 *   1. SAMPLE LOSS. A pen reports 120-240 samples/second; the editor used to
 *      keep one point per animation frame (~60/s) and throw the rest away.
 *      That is fixed unconditionally in `packages/` (coalesced-event capture)
 *      and needs no preference — it is strictly more information.
 *
 *   2. FILTERING. perfect-freehand's `streamline` pulls each input point
 *      towards the previous one before building the outline. Excalidraw's
 *      defaults were chosen for *diagramming*, where that hides mouse jitter.
 *      For handwriting the same filtering rounds the corners off small
 *      letterforms and leaves the ink visibly trailing the nib. There is no
 *      single right answer here — it is a feel preference — so it is exposed.
 *
 * This module owns the preference (persisted) and pushes it into the element
 * package, which bakes the resulting perfect-freehand options into each
 * stroke AT CREATION TIME. Changing the preference therefore never re-shapes
 * strokes that are already on the page.
 *
 * See ./INTEGRATION.md for the `packages/` diff this relies on.
 */

import {
  DEFAULT_INK_FEEL,
  INK_FEEL_TUNING,
  setInkFeel,
  setPreferRealPenPressure,
} from "@excalidraw/element";

import type { InkFeel } from "@excalidraw/element";

export type { InkFeel };
export { DEFAULT_INK_FEEL, INK_FEEL_TUNING };

export const INK_FEELS: readonly InkFeel[] = ["smooth", "balanced", "precise"];

export const INK_FEEL_LABELS: Record<
  InkFeel,
  { label: string; description: string }
> = {
  smooth: {
    label: "Smooth",
    description:
      "Heaviest filtering. Calm, flowing lines; small letters get rounded off.",
  },
  balanced: {
    label: "Balanced",
    description:
      "Excalidraw's original feel. Good for diagrams and large handwriting.",
  },
  precise: {
    label: "Precise",
    description:
      "Least filtering. Ink stays under the nib and small letterforms survive.",
  },
};

export const INK_FEEL_STORAGE_KEY = "goodnotes-ink-feel";
export const INK_PRESSURE_STORAGE_KEY = "goodnotes-ink-real-pressure";

export type InkFeelSettings = {
  feel: InkFeel;
  /**
   * Trust `PointerEvent.pressure` for `pointerType: "pen"` instead of the
   * editor's `pressure === 0.5 means no sensor` heuristic.
   *
   * Off by default: the heuristic is right for mice and for digitizers that
   * report a constant 0.5, and getting it wrong in that direction produces a
   * dead, uniform-width line.
   */
  preferRealPenPressure: boolean;
};

export const DEFAULT_INK_FEEL_SETTINGS: InkFeelSettings = {
  feel: DEFAULT_INK_FEEL,
  preferRealPenPressure: false,
};

const isInkFeel = (value: unknown): value is InkFeel =>
  value === "smooth" || value === "balanced" || value === "precise";

/** Read the persisted settings. Never throws (private mode / quota). */
export const getStoredInkFeelSettings = (): InkFeelSettings => {
  try {
    const feel = localStorage.getItem(INK_FEEL_STORAGE_KEY);
    const pressure = localStorage.getItem(INK_PRESSURE_STORAGE_KEY);
    return {
      feel: isInkFeel(feel) ? feel : DEFAULT_INK_FEEL_SETTINGS.feel,
      preferRealPenPressure:
        pressure === null
          ? DEFAULT_INK_FEEL_SETTINGS.preferRealPenPressure
          : pressure === "true",
    };
  } catch {
    return { ...DEFAULT_INK_FEEL_SETTINGS };
  }
};

export const setStoredInkFeelSettings = (settings: InkFeelSettings) => {
  try {
    localStorage.setItem(INK_FEEL_STORAGE_KEY, settings.feel);
    localStorage.setItem(
      INK_PRESSURE_STORAGE_KEY,
      String(settings.preferRealPenPressure),
    );
  } catch {
    // ignore: the preference is a nicety, not worth failing a stroke over
  }
};

type Listener = (settings: InkFeelSettings) => void;

const listeners = new Set<Listener>();
let current: InkFeelSettings = { ...DEFAULT_INK_FEEL_SETTINGS };

/**
 * Push the settings into the editor. The element package holds them in a
 * module-level slot that `App.tsx` reads on freedraw pointerdown — there is
 * no prop to thread them through, because the values have to be captured per
 * stroke rather than per render.
 */
const applyInkFeelSettings = (settings: InkFeelSettings) => {
  setInkFeel(settings.feel);
  setPreferRealPenPressure(settings.preferRealPenPressure);
};

export const getInkFeelSettings = (): InkFeelSettings => current;

/** Set (and persist, and apply) the settings. Notifies subscribers. */
export const updateInkFeelSettings = (patch: Partial<InkFeelSettings>) => {
  current = { ...current, ...patch };
  applyInkFeelSettings(current);
  setStoredInkFeelSettings(current);
  for (const listener of listeners) {
    listener(current);
  }
};

/** Callback-shaped subscription. Returns an unsubscribe function. */
export const subscribeToInkFeel = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Load the persisted preference and apply it to the editor. Safe to call more
 * than once; call it once at app start (before the first stroke).
 */
export const initInkFeel = (): InkFeelSettings => {
  current = getStoredInkFeelSettings();
  applyInkFeelSettings(current);
  return current;
};
