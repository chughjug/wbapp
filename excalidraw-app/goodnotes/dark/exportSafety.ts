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
