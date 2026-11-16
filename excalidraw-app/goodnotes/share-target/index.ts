/**
 * **Open a PDF in this app from outside it** — public API.
 *
 * Three ways in, in order of how many of your users can actually use them:
 *
 * | Path | Works on |
 * | --- | --- |
 * | File picker (`PdfDropZone`) | everywhere, including iPad/iPhone via the Files app and "Open in…" |
 * | Drag & drop (`PdfDropZone`, `GlobalPdfDropOverlay`) | every desktop browser; iPadOS Split View / Stage Manager drags |
 * | OS share sheet (`share_target` + `ShareTargetReceiver`) | **installed** Chromium PWAs on Android and ChromeOS only |
 *
 * ## iOS cannot receive shares. Design for that.
 *
 * WebKit does not implement the Web Share Target API, and every browser on
 * iOS is WebKit. An iPad user will never see this app in the share sheet, no
 * matter how the manifest is written — so the picker and drag-and-drop paths
 * are the product on iPad, not a fallback. Gate any "share a PDF to
 * Notebook" copy on {@link canReceiveShares}, which is false there.
 *
 * ## Minimal integration
 *
 * ```tsx
 * // 1. the receive route, before the rest of the routing
 * if (isShareTargetUrl()) {
 *   return <ShareTargetReceiver theme={editorTheme} />;
 * }
 *
 * // 2. the always-works path, on the shelf
 * <Shelf headerExtra={<PdfDropZone variant="inline" theme={editorTheme} />} … />
 * <GlobalPdfDropOverlay mode="library" theme={editorTheme} />
 * ```
 *
 * See `INTEGRATION.md` for the exact, copy-pasteable `App.tsx` diff and the
 * `vite.config.mts` wiring (already applied).
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * The `/share-target` landing screen: consumes the file the service worker
 * stashed, imports it, navigates to the new document. Also usable as a
 * standalone "import a PDF" page.
 */
export { ShareTargetReceiver } from "./ShareTargetReceiver";
export type { ShareTargetReceiverProps } from "./ShareTargetReceiver";

/**
 * Keyboard-accessible drop zone + file picker. The import path that works on
 * every platform; mount it on the shelf.
 */
export { PdfDropZone } from "./PdfDropZone";
export type { PdfDropZoneProps } from "./PdfDropZone";

/**
 * Window-wide drag-and-drop. `mode="library"` creates a document per PDF;
 * `mode="document"` appends the pages to the open document.
 */
export { GlobalPdfDropOverlay } from "./GlobalPdfDropOverlay";
export type { GlobalPdfDropOverlayProps } from "./GlobalPdfDropOverlay";

/** Progress bar + live region + `role="alert"` error, if you build your own UI. */
export { ImportProgress } from "./ImportProgress";
export type { ImportProgressProps } from "./ImportProgress";

// ---------------------------------------------------------------------------
// Capability detection — never advertise what the device cannot do
// ---------------------------------------------------------------------------

export {
  /** Can the OS share sheet hand us a PDF *right now*? False on all of iOS. */
  canReceiveShares,
  /** Full report: installed?, iOS?, would-work-if-installed?, share-out? */
  getShareTargetCapabilities,
  /** One sentence explaining the verdict, fit for a tooltip. */
  describeShareSupport,
  isIos,
  isWebKitOnly,
  isInstalledPwa,
} from "./capabilities";
export type { ShareTargetCapabilities } from "./capabilities";

// ---------------------------------------------------------------------------
// Headless import pipeline (PDF → new library document)
// ---------------------------------------------------------------------------

export {
  /** Render one PDF into a brand-new library document. Throws on bad input. */
  importPdfAsNewDocument,
  /** Batch form: one document per file; a bad file never stops the rest. */
  importPdfsAsNewDocuments,
  /** `%PDF-` sniffing — the MIME type is not trustworthy on iOS. */
  looksLikePdf,
  /** Cheap name/MIME check. */
  isProbablyPdf,
  /** `"Lecture 3.pdf"` → `"Lecture 3"`. */
  titleFromFileName,
  /** Pull `File`s out of a `DataTransfer`. */
  filesFromDataTransfer,
  /** Does a `dragover` look like it carries a PDF? */
  dragHasPdf,
  filterPdfFiles,
  SharedPdfImportError,
} from "./importSharedPdfs";
export type {
  ImportedSharedPdf,
  ImportSharedPdfsOptions,
  ImportSharedPdfsResult,
  SharedPdfFailure,
  SharedPdfProgress,
  SharedPdfOrigin,
} from "./importSharedPdfs";

/** The import run as React state (progress, cancel, per-file errors). */
export { usePdfImport } from "./usePdfImport";
export type {
  PdfImportState,
  PdfImportStatus,
  UsePdfImportOptions,
  UsePdfImportResult,
} from "./usePdfImport";

/** Window-level PDF drag-and-drop, without the overlay UI. */
export { useGlobalPdfDrop } from "./useGlobalPdfDrop";
export type {
  UseGlobalPdfDropOptions,
  UseGlobalPdfDropResult,
} from "./useGlobalPdfDrop";

// ---------------------------------------------------------------------------
// Service-worker handoff (Cache Storage)
// ---------------------------------------------------------------------------

export {
  /** Read **and remove** the shared files. What the receive route uses. */
  takeSharedFiles,
  /** Read them without removing. */
  peekSharedFiles,
  /** Remove some or all of them. */
  clearSharedFiles,
  /** Is anything waiting? */
  hasPendingSharedFiles,
  /** Put files in the share cache from the page (tests, manual hand-off). */
  stashSharedFiles,
  /** Ids the SW put in `?shared=`. */
  readSharedIdsFromUrl,
  /** The SW's failure code from `?shareError=`, if any. */
  readShareErrorFromUrl,
  /** Is the current URL the share-target landing route? */
  isShareTargetUrl,
} from "./sharedFiles";
export type { SharedFile } from "./sharedFiles";

// ---------------------------------------------------------------------------
// Routing helpers (match how App.tsx routes today)
// ---------------------------------------------------------------------------

export {
  documentUrl,
  openDocument,
  openLibrary,
  clearShareQuery,
} from "./navigation";

// ---------------------------------------------------------------------------
// Wire format — shared with vite.config.mts and the generated service worker
// ---------------------------------------------------------------------------

export {
  SHARE_TARGET_ACTION,
  SHARE_TARGET_ACCEPT,
  SHARE_TARGET_FILE_FIELD,
  SHARE_TARGET_MANIFEST,
  SHARE_CACHE_NAME,
  SHARE_IDS_PARAM,
  SHARE_ERROR_PARAM,
  SHARE_SW_URL,
  SHARE_SW_FILE_NAME,
} from "./constants";
export type { ShareErrorCode } from "./constants";

// The build-time plugin that emits the service-worker snippet
// (`shareTargetSwPlugin`) is deliberately NOT re-exported here: it is
// imported straight from `./vitePlugin` by `vite.config.mts`, so the
// generated SW source string never ends up in the app bundle.
