/**
 * GoodNotes-style pen presets: a small, ordered set of saved pens that can be
 * activated in one tap (or one key press) — plus the width model the ink UI
 * uses.
 *
 * Persisted to `localStorage` under {@link PENS_STORAGE_KEY} (the pens) and
 * {@link PEN_WIDTH_STORAGE_KEY} (the last freely-chosen width per ink tool).
 */

import type { PenPreset } from "../types";

/** localStorage key holding the user's pen presets. */
export const PENS_STORAGE_KEY = "goodnotes-pens";

/** localStorage key holding the last freely-chosen width per ink tool. */
export const PEN_WIDTH_STORAGE_KEY = "goodnotes-pen-width";

/**
 * Excalidraw's own picker has exactly three freedraw widths
 * (`appState.currentItemStrokeWidthKey` → `FREEDRAW_STROKE_WIDTH`). They are
 * kept here because non-freedraw elements (shapes, text) still go through
 * that key, and because {@link snapPenWidth} needs them.
 *
 * `PenPreset.width` is **not** restricted to these: `element.strokeWidth` has
 * always been an arbitrary `number`, and freedraw elements now take an exact
 * width through `appState.currentItemFreedrawStrokeWidth`.
 */
export const PEN_WIDTHS = {
  thin: 0.5,
  medium: 1,
  bold: 2,
} as const;

export type PenWidthKey = keyof typeof PEN_WIDTHS;

/**
 * Smallest / largest selectable width, in `element.strokeWidth` units.
 *
 * The floor is 0.1 and the ceiling 6 (3× the old `bold`, as wide as a
 * highlighter needs).
 *
 * **Read {@link HAIRLINE_PEN_WIDTH} before changing the floor.** Below about
 * 0.36 the ink is thinner than a screen pixel, so the slider stops making the
 * line *thinner* and starts making it *lighter*. That is a property of the
 * display, not of this module — see `goodnotes/ink/INTEGRATION.md` § "The
 * sub-pixel floor".
 */
export const MIN_PEN_WIDTH = 0.1;
export const MAX_PEN_WIDTH = 6;

/**
 * The width below which a pen stroke is a *hairline*: its ink is narrower
 * than one device pixel, so the renderer draws it one device pixel wide and
 * proportionally lighter instead (`FREEDRAW_HAIRLINE_MIN_DEVICE_PX` in
 * `packages/element/src/renderElement.ts`).
 *
 * The number is `1 / (2.8 * devicePixelRatio * zoom)`: a stroke lays down
 * `strokeWidth * 2.8` scene units of ink (measured, see the ink notes), and
 * one scene unit is `devicePixelRatio * zoom` device pixels. The constant
 * below is the value at 1× and 100%; on a 2× display (iPad) the threshold
 * halves to ~0.18.
 *
 * Exported so UI can say so rather than implying 0.1 and 0.3 differ in
 * thickness. Nothing in this module clamps to it — hairlines are a legitimate
 * annotation weight, they are just light rather than thin.
 */
export const HAIRLINE_PEN_WIDTH = 0.36;
/** Slider granularity. 0.1 keeps every stop expressible as one decimal. */
export const PEN_WIDTH_STEP = 0.1;

/**
 * One-tap stops shown next to the slider. Chosen so the two smallest are
 * below the old `thin` (0.5) — the annotation-margin sizes the three-step
 * picker could not express at all.
 */
export const PEN_WIDTH_STOPS: readonly { width: number; label: string }[] = [
  { width: 0.2, label: "Extra fine" },
  { width: 0.5, label: "Fine" },
  { width: 1, label: "Medium" },
  { width: 2, label: "Bold" },
  { width: 3.5, label: "Extra bold" },
];

/** Default width per ink tool, used when nothing has been chosen yet. */
export const DEFAULT_PEN_WIDTH = 0.5;
export const DEFAULT_HIGHLIGHTER_WIDTH = 3.5;

/** Clamp to the selectable range and round onto the slider's grid. */
export const clampPenWidth = (width: number): number => {
  if (!Number.isFinite(width)) {
    return DEFAULT_PEN_WIDTH;
  }
  const clamped = Math.min(MAX_PEN_WIDTH, Math.max(MIN_PEN_WIDTH, width));
  // 0.1 grid, but keep exact stop values exact (0.35 etc. would be lost)
  return Math.round(clamped * 100) / 100;
};

/** Human-readable width, e.g. `0.2` / `1` / `3.5`. For an `<output>`. */
export const formatPenWidth = (width: number): string =>
  String(Math.round(width * 100) / 100);

/**
 * Snap an arbitrary width to the nearest of Excalidraw's three width *keys*.
 * Still needed: shapes and text have no exact-width override, and the editor's
 * own property panel reads the key.
 */
export const snapPenWidth = (width: number): PenWidthKey => {
  let best: PenWidthKey = "medium";
  let bestDelta = Infinity;
  for (const key of Object.keys(PEN_WIDTHS) as PenWidthKey[]) {
    const delta = Math.abs(PEN_WIDTHS[key] - width);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = key;
    }
  }
  return best;
};

/** The out-of-the-box pens. Order is the tray order and the 1-9 key order. */
export const DEFAULT_PEN_PRESETS: readonly PenPreset[] = [
  {
    id: "margin-note",
    label: "Margin note",
    tool: "freedraw",
    color: "#e03131",
    width: 0.2,
    opacity: 100,
  },
  {
    id: "fine-black",
    label: "Fine black pen",
    tool: "freedraw",
    color: "#1e1e1e",
    width: 0.5,
    opacity: 100,
  },
  {
    id: "thick-blue",
    label: "Thick blue pen",
    tool: "freedraw",
    color: "#1971c2",
    width: 2,
    opacity: 100,
  },
  {
    id: "yellow-highlighter",
    label: "Yellow highlighter",
    tool: "highlighter",
    color: "#ffd43b",
    width: 3.5,
    opacity: 45,
  },
  {
    id: "eraser",
    label: "Eraser",
    tool: "eraser",
    color: "#1e1e1e",
    width: 1,
    opacity: 100,
  },
];

const isPenPreset = (value: unknown): value is PenPreset => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    (p.tool === "freedraw" ||
      p.tool === "highlighter" ||
      p.tool === "eraser") &&
    typeof p.color === "string" &&
    typeof p.width === "number" &&
    Number.isFinite(p.width) &&
    typeof p.opacity === "number" &&
    Number.isFinite(p.opacity)
  );
};

const clonePresets = (presets: readonly PenPreset[]): PenPreset[] =>
  presets.map((preset) => ({ ...preset }));

/**
 * Read the saved presets. Falls back to {@link DEFAULT_PEN_PRESETS} when
 * nothing is stored, storage is unavailable (private mode / SSR) or the stored
 * payload is malformed. Never throws.
 *
 * Migration: the stored shape is unchanged (`PenPreset[]`), so pens saved by
 * the three-width build load as-is; their widths are merely clamped into the
 * (wider) selectable range, which is a no-op for 0.5 / 1 / 2.
 */
export const loadPenPresets = (): PenPreset[] => {
  try {
    const raw = localStorage.getItem(PENS_STORAGE_KEY);
    if (!raw) {
      return clonePresets(DEFAULT_PEN_PRESETS);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return clonePresets(DEFAULT_PEN_PRESETS);
    }
    const presets = parsed.filter(isPenPreset).map((preset) => ({
      ...preset,
      width: clampPenWidth(preset.width),
      opacity: Math.min(100, Math.max(0, preset.opacity)),
    }));
    return presets.length ? presets : clonePresets(DEFAULT_PEN_PRESETS);
  } catch {
    return clonePresets(DEFAULT_PEN_PRESETS);
  }
};

/** Persist presets. Returns `false` if storage rejected the write. */
export const savePenPresets = (presets: readonly PenPreset[]): boolean => {
  try {
    localStorage.setItem(PENS_STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
};

/** Drop any customisation and return the shipped defaults. */
export const resetPenPresets = (): PenPreset[] => {
  try {
    localStorage.removeItem(PENS_STORAGE_KEY);
  } catch {
    // ignore
  }
  return clonePresets(DEFAULT_PEN_PRESETS);
};

/* -------------------------------------------------------------------------- */
/*  Last-used width, per ink tool                                              */
/* -------------------------------------------------------------------------- */

/** The two ink tools that carry their own remembered width. */
export type InkToolId = "pen" | "highlighter";

export interface PenWidthMemory {
  pen: number;
  highlighter: number;
}

export const DEFAULT_PEN_WIDTH_MEMORY: PenWidthMemory = {
  pen: DEFAULT_PEN_WIDTH,
  highlighter: DEFAULT_HIGHLIGHTER_WIDTH,
};

/**
 * Read the last freely-chosen width for each ink tool. Never throws; falls
 * back to {@link DEFAULT_PEN_WIDTH_MEMORY} key by key, so a half-written
 * payload still yields a usable record.
 */
export const loadPenWidths = (): PenWidthMemory => {
  try {
    const raw = localStorage.getItem(PEN_WIDTH_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PEN_WIDTH_MEMORY };
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_PEN_WIDTH_MEMORY };
    }
    const record = parsed as Record<string, unknown>;
    const read = (key: InkToolId): number =>
      typeof record[key] === "number" && Number.isFinite(record[key])
        ? clampPenWidth(record[key] as number)
        : DEFAULT_PEN_WIDTH_MEMORY[key];
    return { pen: read("pen"), highlighter: read("highlighter") };
  } catch {
    return { ...DEFAULT_PEN_WIDTH_MEMORY };
  }
};

/** Persist one tool's width. Returns `false` if storage rejected the write. */
export const savePenWidth = (tool: InkToolId, width: number): boolean => {
  try {
    const next = { ...loadPenWidths(), [tool]: clampPenWidth(width) };
    localStorage.setItem(PEN_WIDTH_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};
