/**
 * GoodNotes-style **PDF import** for Excalidraw.
 *
 * Each PDF page is rasterised with pdf.js and inserted as a locked `image`
 * element inside a new page frame (see `../pages`), appended to the end of
 * the document and restacked. The student draws on top; the scan can never be
 * selected, moved or resized by accident because it is `locked`.
 *
 * ## Dependency — read this first
 *
 * This feature needs **`pdfjs-dist`** (`^4.7.0 || ^5.0.0`), which is **not**
 * installed in this repo. The code is written against a dynamic import, so
 * the app builds and type-checks without it; at runtime every entry point
 * fails with `PdfImportError { code: "missing-dependency" }` and the dialog
 * shows an install banner. See `INTEGRATION.md`.
 *
 * ## Known limitation — no text layer
 *
 * Imported pages are **pictures**. Nothing on them is selectable, searchable
 * or editable text, and zooming past the render scale shows interpolation.
 * With `extractText: true` the page's text is pulled out and stored as a
 * string in the frame's `customData` (`goodnotesPdfImport.text`) as metadata
 * for a future search feature — it is never rendered.
 *
 * ## Typical wiring (toolbar button)
 *
 * ```tsx
 * const [isImportOpen, setImportOpen] = useState(false);
 * // …
 * <button onClick={() => setImportOpen(true)}>Import PDF</button>
 * {isImportOpen && excalidrawAPI && (
 *   <ImportPdfDialog
 *     excalidrawAPI={excalidrawAPI}
 *     onClose={() => setImportOpen(false)}
 *   />
 * )}
 * ```
 *
 * Headless (no dialog), e.g. for a drag-and-drop handler:
 *
 * ```ts
 * const onImportPdf = createPdfImportHandler(excalidrawAPI, {
 *   onError: (message) => setToast({ message }),
 * });
 * await onImportPdf(file, { scale: 2 });
 * ```
 */

export {
  /**
   * Renders a PDF and returns the NEW scene arrays (`elements` + `files`)
   * without touching the editor. Use when you own the scene state.
   */
  importPdfToElements,
  /**
   * Renders a PDF and applies it to a live editor: `addFiles` first, then
   * `updateScene`, then scrolls to the first imported page.
   */
  importPdfIntoScene,
  /**
   * Callback-shaped entry point for a toolbar button: returns
   * `(file, options?) => Promise<ImportPdfResult | null>` that never rejects
   * — failures go to the supplied `onError`.
   */
  createPdfImportHandler,
  /** Page count of a PDF without rendering it (used to seed the range field). */
  readPdfPageCount,
  /** Is a pdf.js build reachable? Lets a toolbar disable the button up front. */
  isPdfjsAvailable,
  /** Inject your own pdf.js build and/or worker URL (optional). */
  configurePdfjs,
  /** Loads pdf.js or throws `PdfImportError("missing-dependency")`. */
  loadPdfjs,
  /** `"1-3, 7, 10-"` → sorted 1-based page numbers, or `null` if unparseable. */
  parsePageRange,
  /** Nearest `PAGE_SIZES` preset for a PDF page, plus landscape-ness. */
  matchClosestPageSize,
  /** Typed error thrown by every entry point. */
  PdfImportError,
  /** Any thrown value → a message fit for the UI. */
  describePdfImportError,
  /** Dependency metadata, also shown in the dialog's install banner. */
  PDFJS_PACKAGE,
  PDFJS_VERSION_RANGE,
  /** `customData` key holding per-page import provenance. */
  PDF_IMPORT_CUSTOM_DATA_KEY,
  /** Default render scale and the scale choices offered by the dialog. */
  DEFAULT_RENDER_SCALE,
  RENDER_SCALE_OPTIONS,
} from "./importPdf";

export type {
  PdfSource,
  PdfPageSizing,
  PdfImportErrorCode,
  PdfImportCustomData,
  ImportPdfOptions,
  ImportPdfToElementsOptions,
  ImportPdfIntoSceneOptions,
  ImportPdfResult,
  ImportedPdfPage,
  PdfjsLike,
} from "./importPdf";

/** The accessible import dialog (file picker, drag-drop, range, progress). */
export { ImportPdfDialog } from "./ImportPdfDialog";
export type { ImportPdfDialogProps } from "./ImportPdfDialog";
