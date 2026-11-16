/**
 * INK — lower-latency, higher-fidelity handwriting. Public API.
 *
 * What this module owns:
 *   - the "ink feel" preference (Smooth / Balanced / Precise) and the
 *     "always use real pen pressure" opt-in, persisted to localStorage,
 *   - pushing those into the editor (the element package bakes them into each
 *     stroke at creation time),
 *   - the settings control, controlled or self-managing.
 *
 * What it deliberately does NOT own:
 *   - coalesced-sample capture. That is an unconditional fix inside
 *     `packages/excalidraw/components/App.tsx`: there is no sane reason to
 *     offer "throw away 70% of the pen's samples" as a user option.
 *
 * Quick start:
 *
 *   initInkFeel();                       // once, at app start
 *   <InkFeelSettings />                  // anywhere (self-managing), or
 *   const ink = useInkFeel();            // controlled, for a Settings screen
 *   <InkFeelSettings settings={ink.settings} onChange={...} />
 *
 * See ./INTEGRATION.md for the `packages/` diff this relies on.
 */

export {
  /** Preference store: read / write / subscribe / apply-at-startup. */
  initInkFeel,
  getInkFeelSettings,
  updateInkFeelSettings,
  subscribeToInkFeel,
  getStoredInkFeelSettings,
  setStoredInkFeelSettings,
  /** Presets and their user-facing copy. */
  INK_FEELS,
  INK_FEEL_LABELS,
  INK_FEEL_TUNING,
  DEFAULT_INK_FEEL,
  DEFAULT_INK_FEEL_SETTINGS,
  INK_FEEL_STORAGE_KEY,
  INK_PRESSURE_STORAGE_KEY,
} from "./inkFeel";

export type {
  InkFeel,
  InkFeelSettings as InkFeelSettingsValue,
} from "./inkFeel";

export {
  /** Hook owning the preference; subscribes to out-of-React updates. */
  useInkFeel,
} from "./useInkFeel";
export type { UseInkFeelResult } from "./useInkFeel";

export {
  /** Radiogroup of presets + real-pressure opt-in. */
  InkFeelSettings,
} from "./InkFeelSettings";
export type { InkFeelSettingsProps } from "./InkFeelSettings";
