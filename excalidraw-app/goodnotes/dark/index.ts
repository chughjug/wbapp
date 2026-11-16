/**
 * TRUE DARK MODE — public API.
 *
 * What this module owns:
 *   - the tri-state viewing preference (light / dark / follow-system),
 *     persisted to the app's existing theme key,
 *   - a hue-preserving ink colour transform (+ WCAG contrast helpers),
 *   - the toggle control (controlled or self-managing).
 *
 * What it deliberately does NOT own:
 *   - the dark page background — Excalidraw's `theme` already filters the
 *     canvas background, and `goodnotes/paper` is already theme-aware,
 *   - the ink inversion for ordinary pens — Excalidraw's `theme` already
 *     does that per element at render time. Doing it twice would double
 *     invert.
 *
 * It DOES require one surgical patch under `packages/` (export theme
 * decoupling + highlighter compositing). Every touched file is listed in
 * ./INTEGRATION.md.
 *
 * Quick start:
 *
 *   const { theme, preference, setPreference } = useDarkMode();
 *   <DarkModeToggle preference={preference} onChange={setPreference} />
 *   <Excalidraw theme={theme} exportTheme="light" ... />
 *   <PaperBackgroundLayer theme={theme} ... />
 */

export {
  /** Tri-state preference, persisted; also exposes the built-in-theme key. */
  DARK_MODE_STORAGE_KEY,
  DARK_MODE_PREFERENCES,
  getStoredDarkModePreference,
  setStoredDarkModePreference,
  /** "system" -> the OS's current answer. */
  resolveDarkModeTheme,
  prefersSystemDark,
  subscribeToSystemTheme,
  /** Hue-preserving dark-mode ink transform (see the file for the rationale). */
  invertInkForDarkMode,
  /** Highlighter-specific: keep hue, drop glare. */
  desaturateHighlightForDarkMode,
  /** Tunables behind the transform. */
  INK_TRANSFORM,
  /** Colour utilities the transform is built from, exported for reuse. */
  parseColor,
  toHex,
  rgbToHsl,
  hslToRgb,
  /** WCAG helpers, so contrast claims can be asserted in tests. */
  relativeLuminance,
  contrastRatio,
  /** Dark surfaces that match `goodnotes/paper`'s dark palette. */
  DARK_MODE_PALETTE,
} from "./darkMode";

export type { DarkModePreference, ResolvedTheme, RGBA } from "./darkMode";

export {
  /** Force an appState onto white paper / black ink for an export. */
  toLightExportAppState,
  /** Same, for callers that pass an export config instead. */
  toLightExportConfig,
  EXPORT_PAPER_COLOR,
} from "./exportSafety";
export type { ExportThemeFields } from "./exportSafety";

export {
  /** Hook owning the preference; drop-in for `useHandleAppTheme()`. */
  useDarkMode,
} from "./useDarkMode";
export type { UseDarkModeResult } from "./useDarkMode";

export {
  /** Segmented (light/dark/auto) or icon toggle; controlled or standalone. */
  DarkModeToggle,
} from "./DarkModeToggle";
export type { DarkModeToggleProps } from "./DarkModeToggle";
