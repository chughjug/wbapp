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
