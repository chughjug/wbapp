/**
 * Canvas LMS integration.
 *
 * Pulls course deadlines and files from a student's Canvas instance so the
 * shelf's due dates and course folders fill themselves in, and a course PDF
 * becomes an annotatable document in one step.
 *
 * Two things shape the design:
 *
 * 1. Canvas sends no CORS headers and Instructure-hosted instances cannot be
 *    configured to, so the browser cannot call it directly. Requests go
 *    through this app's own relay at /api/canvas/proxy, which is read-only,
 *    allowlists both the destination host and the API path, and refuses
 *    private/link-local addresses.
 * 2. A Canvas personal access token cannot be scoped to read-only, so it
 *    carries the full authority of the account. It lives in localStorage and
 *    is sent per request to our own relay, never to a third party. That is a
 *    stated trade-off, not an oversight: the connect UI must say so, and the
 *    user can revoke the token from Canvas at any time.
 */

export {
  loadCanvasConnection,
  saveCanvasConnection,
  clearCanvasConnection,
  isCanvasConnected,
  normalizeCanvasHost,
  subscribeCanvasConnection,
} from "./connection";
export type { CanvasConnection } from "./connection";

export {
  CanvasError,
  checkCanvasConnection,
  listCourses,
  listAssignments,
  listCourseFiles,
  getFile,
} from "./client";
export type { CanvasCourse, CanvasAssignment, CanvasFile } from "./client";

export {
  listUpcomingWork,
  createDocumentForAssignment,
  refreshLinkedDueDates,
  importCanvasFileAsDocument,
  CanvasDownloadError,
} from "./sync";
export type { AssignmentRow } from "./sync";

export { canvasAssignmentTag, canvasFileTag, canvasCourseLabel } from "./sync";

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** The connect screen: address + token, with the token warning up front. */
export { CanvasConnectDialog } from "./CanvasConnectDialog";
export type { CanvasConnectDialogProps } from "./CanvasConnectDialog";

/**
 * Callback-shaped entry point for opening the connect screen:
 * `const canvas = useCanvasConnect(); <button onClick={canvas.open}/>{canvas.dialog}`
 */
export { useCanvasConnect } from "./useCanvasConnect";
export type {
  CanvasConnectController,
  UseCanvasConnectOptions,
} from "./useCanvasConnect";

/** The per-course browser: Assignments / Files / My notebooks. */
export { CourseBrowser } from "./CourseBrowser";
export type { CourseBrowserProps, CourseBrowserTab } from "./CourseBrowser";

/** Building blocks, exported so a host can compose its own layout. */
export { CanvasTabs, tabId, tabPanelId } from "./CanvasTabs";
export type { CanvasTabsProps, CanvasTabSpec } from "./CanvasTabs";
export { AssignmentList } from "./AssignmentList";
export type { AssignmentListProps } from "./AssignmentList";
export { FileList } from "./FileList";
export type { FileListProps } from "./FileList";
export { FilePreviewPane } from "./FilePreviewPane";
export type { FilePreviewPaneProps } from "./FilePreviewPane";
export { NotebookList } from "./NotebookList";
export type { NotebookListProps } from "./NotebookList";
export { CanvasProgress, describeImportPhase } from "./CanvasProgress";
export type { CanvasProgressProps } from "./CanvasProgress";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export { useCanvasConnection } from "./useCanvasConnection";
export type { UseCanvasConnection } from "./useCanvasConnection";

export {
  useCanvasCourses,
  useCourseAssignments,
  useCourseFiles,
  useCourseNotebooks,
  findCourse,
} from "./useCanvasData";
export type { CanvasResource, CourseFileRow } from "./useCanvasData";

// ---------------------------------------------------------------------------
// Files, previews and error copy
// ---------------------------------------------------------------------------

export {
  /** importCanvasFileAsDocument + an "imported from this file" tag. */
  importCanvasFile,
  loadImportedFileIndex,
  fetchCanvasFileBlob,
  renderPdfFirstPage,
  describeImportOutcome,
  describeUnsupportedFile,
  canvasFileName,
  isPdfFile,
} from "./files";
export type { PdfPreview } from "./files";

export {
  /** Any thrown value -> a sentence that says what actually happened. */
  describeCanvasError,
  canvasErrorKind,
  needsReconnect,
  TOKEN_SETTINGS_PATH,
} from "./errors";
export type { CanvasErrorContext } from "./errors";
