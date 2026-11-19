/**
 * Export safety — the hard requirement.
 *
 * "Exports and prints MUST stay standard white paper with black ink,
 * regardless of what is on screen."
 *
 * Two independent things can break that, and both are handled here:
 *
 *  1. THEME. `appState.exportWithDarkMode` used to mirror the view theme, so
 *     a dark screen produced a black-background PNG. Fixed at the source by
 *     the `exportTheme` prop (see INTEGRATION.md → `packages/` patch); this
 *     helper is the belt-and-braces version for any call site that builds
 *     its own appState.
 *
 *  2. BACKGROUND. This app runs Excalidraw with
 *     `viewBackgroundColor: "transparent"` so the `goodnotes/paper` layer
 *     (a DOM canvas *behind* the editor canvas) is visible. That paper layer
 *     is NOT part of an export — so an untouched export is transparent, not
 *     white. A transparent PNG dropped into a dark viewer reads as black
 *     ink on black. Exports must therefore paint their own white sheet.
 *
 * Use it wherever an export is produced:
 *
 *   exportScene({
 *     type: "png",
 *     data: { elements, appState: toLightExportAppState(appState), files },
 *     config: getExportConfigFromAppState(toLightExportAppState(appState)),
 *   });
 */

import {
  contrastRatio,
  hslToRgb,
  parseColor,
  rgbToHsl,
  toHex,
} from "./darkMode";

/** The paper colour every export is printed on. */
export const EXPORT_PAPER_COLOR = "#ffffff";

/** The minimum appState fields an export reads for theme/background. */
export interface ExportThemeFields {
  theme?: "light" | "dark";
  exportWithDarkMode?: boolean;
  exportBackground?: boolean;
  viewBackgroundColor?: string;
}

/**
 * Force an appState onto "white paper, black ink", leaving everything else
 * untouched. Idempotent and side-effect free.
 *
 * @param appState the live editor appState
 * @param paperColor override the sheet colour (e.g. a cream paper preset)
 */
export const toLightExportAppState = <T extends ExportThemeFields>(
  appState: T,
  paperColor: string = EXPORT_PAPER_COLOR,
): T => ({
  ...appState,
  theme: "light" as const,
  exportWithDarkMode: false,
  exportBackground: true,
  // the on-screen value is "transparent" so the paper layer shows through;
  // an export has no paper layer, so it has to paint the sheet itself
  viewBackgroundColor:
    !appState.viewBackgroundColor ||
    appState.viewBackgroundColor === "transparent"
      ? paperColor
      : appState.viewBackgroundColor,
});

/**
 * Same intent, for callers that hand Excalidraw an export *config* rather
 * than an appState (`exportScene({ config })`).
 */
export const toLightExportConfig = <
  T extends { theme?: "light" | "dark"; canvasBackgroundColor?: unknown },
>(
  config: T,
  paperColor: string = EXPORT_PAPER_COLOR,
): T => ({
  ...config,
  theme: "light" as const,
  canvasBackgroundColor:
    !config.canvasBackgroundColor ||
    config.canvasBackgroundColor === "transparent" ||
    config.canvasBackgroundColor === false
      ? paperColor
      : config.canvasBackgroundColor,
});

/* -------------------------------------------------------------------------
 * Ink that would be invisible on the paper it is printed on.
 *
 * Forcing the export to light theme (above) is the right fix for ink the
 * student never chose: Excalidraw stores a dark stroke colour and merely
 * *renders* it light while the dark canvas filter is on, so exporting in
 * light theme brings it back dark with nothing to correct.
 *
 * It is NOT a fix for ink the student picked deliberately. Someone writing
 * on a dark page who opens the colour picker and chooses white gets a white
 * stroke stored literally — and that exports as white ink on white paper,
 * which is a blank page where their notes were. Nothing earlier in the
 * pipeline catches this: the theme forcing only touches appState, and no
 * export path rewrites element colours at all.
 *
 * So the last step before rasterising is a contrast floor. Ink that cannot
 * be seen against the sheet is darkened until it can be, keeping its hue
 * and as much of its saturation as the floor allows, so a pale yellow note
 * comes out as a readable dark yellow rather than as black.
 * ---------------------------------------------------------------------- */

/**
 * Minimum contrast ratio between exported ink and the paper.
 *
 * 3.0, the WCAG floor for large text and graphical objects, rather than the
 * 4.5 for body text. Handwriting is a graphical object, and 4.5 would drag
 * every mid-tone highlighter and coloured annotation most of the way to
 * black — destroying information the student encoded in the colour in order
 * to protect legibility they already had.
 */
export const MIN_EXPORT_INK_CONTRAST = 3;

/**
 * Darken `color` until it clears `minContrast` against `paperColor`.
 *
 * Hue is preserved exactly. Lightness is walked down in small steps and
 * saturation is left alone until lightness alone cannot get there, at which
 * point the colour is already near-black and saturation is doing nothing
 * for it anyway. Returns the input unchanged when it already passes, when
 * it cannot be parsed, or when it is fully transparent.
 */
export const inkForPaper = (
  color: string,
  paperColor: string = EXPORT_PAPER_COLOR,
  minContrast: number = MIN_EXPORT_INK_CONTRAST,
): string => {
  if (color === "transparent") {
    return color;
  }
  const rgba = parseColor(color);
  if (!rgba) {
    return color;
  }
  // A stroke that is nearly invisible anyway is the user's business; the
  // problem being solved is ink they expect to see.
  if (rgba.a === 0) {
    return color;
  }
  if (contrastRatio(color, paperColor) >= minContrast) {
    return color;
  }

  const { h, s } = rgbToHsl(rgba);
  for (let l = 0.95; l >= 0; l -= 0.02) {
    const candidate = toHex(hslToRgb({ h, s, l }, rgba.a));
    if (contrastRatio(candidate, paperColor) >= minContrast) {
      return candidate;
    }
  }
  // Unreachable for any normal paper, but a black fallback beats a blank
  // page if someone exports onto a very dark custom sheet.
  return toHex({ r: 0, g: 0, b: 0, a: rgba.a });
};

/**
 * Apply the contrast floor across a scene, returning elements safe to print.
 *
 * Only `strokeColor` is touched, and only on elements that are actually ink:
 *
 * - **Images are skipped** — an imported PDF page or a photo is content,
 *   not a pen stroke, and nothing here should be repainting it.
 * - **Frames are skipped.** A page frame is scaffolding, never drawn into
 *   the export, and its pale outline is exactly the kind of low-contrast
 *   colour this function exists to darken. Skipping it also keeps frame
 *   objects referentially identical to the ones in the source array, which
 *   matters: Excalidraw's `exportingFrame` is matched by identity, so
 *   returning a copy would silently stop the page being clipped to it.
 * - **Semi-transparent elements are skipped.** A highlighter is a pale
 *   colour laid over text *on purpose*; darkening it to a 3:1 contrast
 *   would turn a yellow wash into a brown bar straight through the words
 *   it was meant to emphasise.
 * - **`backgroundColor` is left alone.** A white-filled shape on white
 *   paper is usually a deliberate knockout — a label sitting over ruling —
 *   and "fixing" it would put a grey box on the page.
 *
 * Returns the original array when nothing needed changing, so the common
 * case allocates nothing.
 */
export const toPrintableElements = <
  T extends {
    readonly type: string;
    readonly strokeColor?: string;
    readonly opacity?: number;
  },
>(
  elements: readonly T[],
  paperColor: string = EXPORT_PAPER_COLOR,
  minContrast: number = MIN_EXPORT_INK_CONTRAST,
): readonly T[] => {
  let changed = false;
  const next = elements.map((element) => {
    if (
      element.type === "image" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      typeof element.strokeColor !== "string" ||
      (typeof element.opacity === "number" && element.opacity < 100)
    ) {
      return element;
    }
    const safe = inkForPaper(element.strokeColor, paperColor, minContrast);
    if (safe === element.strokeColor) {
      return element;
    }
    changed = true;
    return { ...element, strokeColor: safe };
  });
  return changed ? next : elements;
};
