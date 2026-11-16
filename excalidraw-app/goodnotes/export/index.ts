/**
 * Public API of the GoodNotes export module.
 *
 * Three entry points:
 *
 * 1. the dialog — presets, live page preview, size estimate, progress:
 * ```tsx
 * {isExportOpen && (
 *   <ExportDialog
 *     elements={excalidrawAPI.getSceneElements()}
 *     files={excalidrawAPI.getFiles()}
 *     appState={excalidrawAPI.getAppState()}
 *     currentPageNumber={currentPageNumber}
 *     onClose={() => setIsExportOpen(false)}
 *   />
 * )}
 * ```
 *
 * 2. one-click re-export — repeats the last export, no dialog:
 * ```tsx
 * <QuickExportButton getScene={() => excalidrawAPI && ({ … })} />
 * ```
 *
 * 3. the headless exporters (`exportDocumentToPdf`,
 *    `exportDocumentToImages`, `runExport`).
 *
 * See INTEGRATION.md for copy-pasteable App.tsx changes.
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Preset-led export dialog (preview, size estimate, progress, share sheet). */
export { ExportDialog } from "./ExportDialog";
export type { ExportDialogProps } from "./ExportDialog";

/** Toolbar control + headless hook that repeat the last export. */
export { QuickExportButton, useQuickExport } from "./QuickExport";
export type {
  QuickExportButtonProps,
  UseQuickExportOptions,
  UseQuickExportResult,
} from "./QuickExport";

/** Page thumbnails, if a host wants its own preview surface. */
export {
  PagePreviewStrip,
  usePagePreviews,
  useSceneRenderer,
  MAX_THUMBNAILS,
} from "./PagePreview";
export type {
  PagePreviewItem,
  PagePreviewStripProps,
  UsePagePreviewsOptions,
  UsePagePreviewsResult,
  UseSceneRendererOptions,
  UseSceneRendererResult,
} from "./PagePreview";

// ---------------------------------------------------------------------------
// Presets + remembered settings
// ---------------------------------------------------------------------------

/**
 * The four presets and the settings behind them:
 *
 * | preset           | format | pages   | scale | background | delivery         |
 * | ---------------- | ------ | ------- | ----- | ---------- | ---------------- |
 * | Submit           | PDF    | all     | 2x    | on         | download         |
 * | Share            | PDF    | all     | 1x    | on         | share sheet/auto |
 * | Images           | PNG    | all     | 2x    | on         | download         |
 * | This page only   | PDF    | current | 2x    | on         | download         |
 */
export {
  EXPORT_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  matchPreset,
  settingsEqual,
} from "./presets";
export type {
  ExportPreset,
  ExportPresetId,
  ExportSettings,
  ExportFormat,
  ExportDelivery,
  PageRangeMode,
} from "./presets";

/** The last successful export, persisted so it can be repeated. */
export {
  LAST_EXPORT_STORAGE_KEY,
  getLastExport,
  setLastExport,
  clearLastExport,
  subscribeLastExport,
  describeLastExport,
} from "./presets";
export type { LastExport } from "./presets";

// ---------------------------------------------------------------------------
// Exporters
// ---------------------------------------------------------------------------

/**
 * Renders page frames to a multi-page PDF Blob. Always light theme.
 * Each page is composited as paper (sheet + rulings + background picture +
 * border, redrawn from `goodnotes/paper`) with a transparent ink raster on
 * top, then placed on a jsPDF page sized from the frame's real geometry
 * (px * 72/96 = pt).
 */
export { exportDocumentToPdf } from "./exportPdf";
export type { ExportDocumentToPdfOptions } from "./exportPdf";

/** One PNG per page, through the exact same compositing path as the PDF. */
export { exportDocumentToImages, toPageImageFileName } from "./exportImages";
export type {
  ExportDocumentToImagesOptions,
  ExportedPageImage,
  ImageFormat,
} from "./exportImages";

/** Settings in, delivered files out — what the dialog and quick export run. */
export { runExport, resolvePages, describeExportResult } from "./runExport";
export type {
  RunExportOptions,
  ExportRunResult,
  ResolvePagesOptions,
  ResolvePagesResult,
} from "./runExport";

/** The shared page rasteriser behind every export path. */
export {
  createPageRenderer,
  canvasToBlob,
  clampScale,
  DEFAULT_SCALE,
  MAX_SCALE,
} from "./renderPage";
export type {
  PageRenderer,
  CreatePageRendererOptions,
  RenderPageOptions,
} from "./renderPage";

/** Error carrying the 1-based page number that failed, when known. */
export { PdfExportError } from "./exportPdf";

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * `navigator.share({ files })` with a download fallback. Feature-detected
 * per payload — on iOS/iPadOS this opens the OS share sheet instead of
 * dropping the PDF into Files.
 */
export {
  shareOrDownloadFiles,
  canShareFiles,
  supportsFileShare,
} from "./share";
export type { ShareOutcome, ShareFilesOptions } from "./share";

/** Filename helpers / browser download trigger. */
export {
  downloadPdfBlob,
  downloadBlob,
  toPdfFileName,
  sanitiseFileName,
} from "./exportPdf";

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

/** Finds/orders the `page:N` frames of a scene (local to this module). */
export {
  getOrderedPageFrames,
  isPageFrame,
  matchPageSizeName,
} from "./pageFrames";

/** Parses user input like `"1-3,5"` into 1-based page numbers. */
export { parsePageRange, formatPageList } from "./pageFrames";
export type { ParsePageRangeResult } from "./pageFrames";

/** px(96dpi) -> pt(72dpi) conversion used for PDF page geometry. */
export { pxToPt, PX_PER_INCH, PT_PER_INCH } from "./pageFrames";

// ---------------------------------------------------------------------------
// Size / time estimates
// ---------------------------------------------------------------------------

export {
  estimateExportBytes,
  estimateSeconds,
  formatFileSize,
  formatDuration,
  exponentFor,
  CALIBRATION_SCALE,
} from "./estimate";
export type { PageSizeSample, EstimateOptions } from "./estimate";
