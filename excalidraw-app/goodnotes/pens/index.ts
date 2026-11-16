/**
 * GoodNotes-style quick pen presets.
 *
 * ```tsx
 * <PenTray excalidrawAPI={excalidrawAPI} />
 * ```
 *
 * Rendering a {@link PenTray} is all the integration that is needed: it loads
 * the saved presets, activates one on click or on the matching number key, and
 * persists edits. {@link applyPenPreset} is exported for callers that want to
 * drive the editor without the UI.
 */

/** Compact tray of preset buttons (see `PenTray.tsx`). */
export { PenTray, applyPenPreset, HIGHLIGHTER_CUSTOM_DATA } from "./PenTray";
export type { PenTrayProps } from "./PenTray";

/** Preset data, defaults and localStorage persistence. */
export {
  DEFAULT_PEN_PRESETS,
  PENS_STORAGE_KEY,
  PEN_WIDTHS,
  MIN_PEN_WIDTH,
  MAX_PEN_WIDTH,
  loadPenPresets,
  savePenPresets,
  resetPenPresets,
  snapPenWidth,
} from "./presets";
export type { PenWidthKey } from "./presets";

/**
 * The continuous width model the ink UI uses. `element.strokeWidth` is an
 * arbitrary number; only Excalidraw's picker was ever quantised to three
 * steps, so these are the real bounds, the slider's grid, the one-tap stops
 * and the per-tool "last nib used" memory.
 */
export {
  PEN_WIDTH_STEP,
  PEN_WIDTH_STOPS,
  PEN_WIDTH_STORAGE_KEY,
  DEFAULT_PEN_WIDTH,
  DEFAULT_HIGHLIGHTER_WIDTH,
  DEFAULT_PEN_WIDTH_MEMORY,
  clampPenWidth,
  formatPenWidth,
  loadPenWidths,
  savePenWidth,
} from "./presets";
export type { InkToolId, PenWidthMemory } from "./presets";

/** Re-exported for convenience; the canonical declaration lives in the contract. */
export type { PenPreset } from "../types";
