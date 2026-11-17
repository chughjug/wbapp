import {
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_STROKE_STREAMLINE_PRECISE,
} from "@excalidraw/common";

import type { StrokeOptions, StrokeVariability } from "./types";

/**
 * "Ink feel" — how much the raw digitizer path is filtered before it becomes
 * a rendered stroke.
 *
 * Excalidraw's freedraw defaults were tuned for *diagramming*: heavy
 * streamlining hides the jitter of a mouse dragged across a desk, and the
 * resulting roundness is harmless on arrows and boxes. Handwriting wants the
 * opposite trade-off — a lowercase "e" is only a few millimetres across, and
 * streamlining that much path away closes the loop.
 *
 * The three presets map onto perfect-freehand's three relevant knobs:
 *
 * - `streamline` — how far each input point is pulled towards the previous
 *   one before the outline is built (0 = raw input, 1 = extreme lag). This is
 *   the one that destroys small letterforms.
 * - `smoothing`  — curve fitting applied to the outline.
 * - `thinning`   — how strongly pressure modulates stroke width.
 *
 * `BALANCED` is byte-for-byte what the editor did historically. The notebook
 * app defaults to `precise` because handwriting is the primary input.
 */
export type InkFeel = "smooth" | "balanced" | "precise";

export const DEFAULT_INK_FEEL: InkFeel = "precise";

export type InkFeelTuning = {
  /** streamline for pen / touch input */
  streamlinePen: number;
  /** streamline for mouse input (mouse jitter needs more filtering) */
  streamlineMouse: number;
  smoothing: number;
  thinning: number;
};

export const INK_FEEL_TUNING: Record<InkFeel, InkFeelTuning> = {
  /** Heavier filtering: calm lines, rounded corners. Good for diagramming. */
  smooth: {
    streamlinePen: 0.45,
    streamlineMouse: 0.6,
    smoothing: 0.65,
    thinning: 0.5,
  },
  /** The editor's historical behaviour. */
  balanced: {
    streamlinePen: DEFAULT_STROKE_STREAMLINE_PRECISE, // 0.2
    streamlineMouse: DEFAULT_STROKE_STREAMLINE, // 0.5
    // == VARIABLE_WIDTH_FREEDRAW.SMOOTHING / .THINNING in shape.ts
    smoothing: 0.5,
    thinning: 0.6,
  },
  /**
   * Minimal filtering: small letterforms survive, and the ink stays under the
   * nib instead of trailing behind it. Intended for handwriting with a stylus.
   */
  precise: {
    streamlinePen: 0.08,
    streamlineMouse: 0.3,
    smoothing: 0.35,
    thinning: 0.7,
  },
};

/**
 * Renderer hardcoded defaults in `shape.ts` match the balanced tuning. When
 * serialising strokeOptions we omit smoothing/thinning that equal these so
 * historical scenes stay byte-identical — regardless of which preset is the
 * *app* default.
 */
const RENDERER_DEFAULT_TUNING = INK_FEEL_TUNING.balanced;

let currentInkFeel: InkFeel = DEFAULT_INK_FEEL;

/**
 * When `false` we keep the editor's original heuristic: a pointer reporting
 * exactly `0.5` at pointerdown is assumed to have no pressure sensor, and
 * pressure is simulated from velocity instead.
 *
 * When `true`, pen input is always taken at its word. See
 * `shouldSimulatePressure` for why this is a preference.
 *
 * Default is `true` for the notebook app (Apple Pencil / stylus first).
 */
let preferRealPenPressure = true;

/**
 * When `true`, coalesced samples are pre-filtered through Google's Ink Stroke
 * Modeler (via `ink-stroke-modeler-ts`) before they become element points.
 * Off keeps the raw coalesced path (previous behaviour).
 */
let useStrokeModeler = true;

export const getInkFeel = (): InkFeel => currentInkFeel;

export const setInkFeel = (feel: InkFeel) => {
  currentInkFeel = feel;
};

export const getPreferRealPenPressure = () => preferRealPenPressure;

export const setPreferRealPenPressure = (prefer: boolean) => {
  preferRealPenPressure = prefer;
};

export const getUseStrokeModeler = () => useStrokeModeler;

export const setUseStrokeModeler = (use: boolean) => {
  useStrokeModeler = use;
};

/**
 * Stroke geometry baked into a freedraw element at creation time, so changing
 * the preference later never re-shapes strokes that are already on the page.
 */
export const resolveFreedrawStrokeOptions = ({
  pointerType,
  variability,
}: {
  pointerType: string | null;
  variability: StrokeVariability;
}): StrokeOptions => {
  const tuning = INK_FEEL_TUNING[currentInkFeel];

  return {
    variability,
    streamline:
      pointerType === "mouse" ? tuning.streamlineMouse : tuning.streamlinePen,
    // only persisted when they differ from the renderer's own defaults, so
    // balanced strokes serialise exactly as they did before this existed
    ...(tuning.smoothing === RENDERER_DEFAULT_TUNING.smoothing
      ? {}
      : { smoothing: tuning.smoothing }),
    ...(tuning.thinning === RENDERER_DEFAULT_TUNING.thinning
      ? {}
      : { thinning: tuning.thinning }),
  };
};

/**
 * Whether perfect-freehand should synthesise pressure from stroke velocity
 * instead of using the reported `PointerEvent.pressure`.
 *
 * perfect-freehand's `simulatePressure` defaults to `true`, and when it is on
 * the `pressures` we record are ignored entirely. Excalidraw decides from the
 * first sample: a mouse always reports `0.5` while a button is held, so
 * `pressure === 0.5` is read as "no sensor". That heuristic misfires for a
 * stylus that happens to be pressed at mid-force on touchdown — the whole
 * stroke then renders with simulated pressure and the pen's real force is
 * thrown away.
 *
 * `preferRealPenPressure` opts out of the heuristic for `pointerType: "pen"`
 * only. Some pens (and some remote-desktop / virtualised digitizers) report a
 * constant `0.5` for every sample; trusting that yields a dead, uniform-width
 * line — hence the Settings toggle.
 */
export const shouldSimulatePressure = ({
  pointerType,
  pressure,
}: {
  pointerType: string | null;
  pressure: number;
}): boolean => {
  if (preferRealPenPressure && pointerType === "pen") {
    return false;
  }
  return pressure === 0.5;
};
