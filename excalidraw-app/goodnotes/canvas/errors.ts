/**
 * Every failure the Canvas UI can show, turned into a sentence a student can
 * act on.
 *
 * The rule here: never render "something went wrong". `CanvasError.kind` is a
 * discriminant precisely so each case can say what actually happened and what
 * to do about it — a rejected token is a different problem from a course that
 * hides its files, and a missing relay is a different problem again.
 */

import { CanvasError } from "./client";
import { CanvasDownloadError } from "./sync";

/** Where in Canvas → Account → Settings a token is made and revoked. */
export const TOKEN_SETTINGS_PATH = "Account → Settings → Approved Integrations";

export type CanvasErrorContext =
  | "connect"
  | "courses"
  | "assignments"
  | "files";

const CONTEXT_NOUN: Record<CanvasErrorContext, string> = {
  connect: "check that token",
  courses: "load your courses",
  assignments: "load this course's assignments",
  files: "load this course's files",
};

/**
 * A message for any thrown value, specialised by what was being attempted.
 *
 * `unauthorized` is deliberately phrased as "that token was rejected" rather
 * than a generic failure: it is the one error the user can fix in a minute.
 */
export const describeCanvasError = (
  error: unknown,
  context: CanvasErrorContext = "courses",
): string => {
  if (error instanceof CanvasDownloadError) {
    return error.message;
  }

  if (error instanceof CanvasError) {
    switch (error.kind) {
      case "not-connected":
        return "Canvas isn’t connected yet. Add your Canvas address and an access token to continue.";
      case "unauthorized":
        return `That token was rejected by Canvas. Tokens are revoked, expire, and are easy to paste half of — make a new one in Canvas under ${TOKEN_SETTINGS_PATH} and try again.`;
      case "forbidden":
        return context === "connect"
          ? "Canvas accepted the request but refused this account. If your school restricts API access, ask them whether personal access tokens are allowed."
          : `Canvas refused to ${CONTEXT_NOUN[context]}. Teachers can hide this part of a course, and some schools restrict API access entirely.`;
      case "not-found":
        return context === "connect"
          ? "There is no Canvas API at that address. It should look like your-school.instructure.com — the host only, with no https:// and no path."
          : "Canvas no longer has that course, assignment or file. It may have been deleted or unpublished.";
      case "network":
        return "Could not reach the Canvas relay. Check your connection — and note the relay only runs on the deployed app, so this always fails on a local dev server.";
      default:
        return error.status
          ? `Canvas returned an unexpected ${error.status} response. Nothing was changed; try again in a moment.`
          : `Could not ${CONTEXT_NOUN[context]}. Nothing was changed; try again in a moment.`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }
  return `Could not ${CONTEXT_NOUN[context]}.`;
};

/** The kind, when there is one — lets a caller branch (e.g. re-open connect). */
export const canvasErrorKind = (error: unknown): CanvasError["kind"] | null =>
  error instanceof CanvasError ? error.kind : null;

/** True when the only sensible next step is to reconnect. */
export const needsReconnect = (error: unknown): boolean => {
  const kind = canvasErrorKind(error);
  return kind === "unauthorized" || kind === "not-connected";
};
