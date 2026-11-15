/**
 * GoodNotes-style pen presets: a small, ordered set of saved pens that can be
 * activated in one tap (or one key press).
 *
 * Persisted to `localStorage` under {@link PENS_STORAGE_KEY}.
 */

import type { PenPreset } from "../types";

/** localStorage key holding the user's pen presets. */
export const PENS_STORAGE_KEY = "goodnotes-pens";

/**
 * Excalidraw only exposes three discrete freedraw stroke widths through
 * `appState.currentItemStrokeWidthKey`, which map to these element
 * `strokeWidth` values (see `FREEDRAW_STROKE_WIDTH` in `@excalidraw/common`).
 * `PenPreset.width` is expressed in those units and snapped to the nearest.
 */
export const PEN_WIDTHS = {
  thin: 0.5,
  medium: 1,
  bold: 2,
} as const;

export type PenWidthKey = keyof typeof PEN_WIDTHS;

/** Smallest / largest selectable width, for the editor UI. */
export const MIN_PEN_WIDTH = PEN_WIDTHS.thin;
export const MAX_PEN_WIDTH = PEN_WIDTHS.bold;

/** Snap an arbitrary width to the nearest width Excalidraw can actually draw. */
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
    id: "fine-black",
    label: "Fine black pen",
    tool: "freedraw",
    color: "#1e1e1e",
    width: PEN_WIDTHS.thin,
    opacity: 100,
  },
  {
    id: "thick-blue",
    label: "Thick blue pen",
    tool: "freedraw",
    color: "#1971c2",
    width: PEN_WIDTHS.bold,
    opacity: 100,
  },
  {
    id: "yellow-highlighter",
    label: "Yellow highlighter",
    tool: "highlighter",
    color: "#ffd43b",
    width: PEN_WIDTHS.bold,
    opacity: 45,
  },
  {
    id: "eraser",
    label: "Eraser",
    tool: "eraser",
    color: "#1e1e1e",
    width: PEN_WIDTHS.medium,
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
