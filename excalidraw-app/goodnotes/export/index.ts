/**
 * Public API of the GoodNotes PDF export module.
 *
 * Typical use:
 * ```tsx
 * {isExportOpen && (
 *   <ExportDialog
 *     elements={excalidrawAPI.getSceneElements()}
 *     files={excalidrawAPI.getFiles()}
 *     appState={excalidrawAPI.getAppState()}
 *     onClose={() => setIsExportOpen(false)}
 *   />
 * )}
 * ```
 */

/** Options dialog (page range, scale, background, filename, progress). */
export { ExportDialog } from "./ExportDialog";
export type { ExportDialogProps, PageRangeMode } from "./ExportDialog";

/**
 * Renders page frames to a multi-page PDF Blob. Always light theme.
 * Each page is composited as paper (sheet + rulings + border, redrawn from
 * `goodnotes/paper`) with a transparent ink raster on top, then placed on a
 * jsPDF page sized from the frame's real geometry (px * 72/96 = pt).
 */
export { exportDocumentToPdf } from "./exportPdf";
export type { ExportDocumentToPdfOptions } from "./exportPdf";

/** Error carrying the 1-based page number that failed, when known. */
export { PdfExportError } from "./exportPdf";

/** Finds/orders the `page:N` frames of a scene (local to this module). */
export { getOrderedPageFrames, isPageFrame, matchPageSizeName } from "./exportPdf";

/** Parses user input like `"1-3,5"` into 1-based page numbers. */
export { parsePageRange } from "./exportPdf";
export type { ParsePageRangeResult } from "./exportPdf";

/** px(96dpi) -> pt(72dpi) conversion used for PDF page geometry. */
export { pxToPt } from "./exportPdf";

/** Filename helpers / browser download trigger. */
export { downloadPdfBlob, toPdfFileName } from "./exportPdf";
