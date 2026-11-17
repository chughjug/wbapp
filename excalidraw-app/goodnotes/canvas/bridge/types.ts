/** Shared shapes with canvas-bridge/src/types.js (keep in sync). */

export type BridgeJobStatus =
  | "waiting"
  | "running"
  | "ready"
  | "error"
  | "expired";

export interface BridgeFile {
  id: string;
  displayName: string;
  contentType?: string;
  size?: number;
  updatedAt?: string;
  downloadUrl?: string;
  dataBase64?: string;
  /** Set by the extension when the file exceeded the per-file size cap. */
  skippedTooLarge?: boolean;
}

export interface BridgeAssignment {
  id: string;
  name: string;
  dueAt: string | null;
  htmlUrl?: string;
  pointsPossible?: number | null;
}

export interface BridgeCourseSummary {
  id: string;
  name: string;
  courseCode?: string;
  term?: string;
}

export interface BridgeCoursesPayload {
  kind: "courses";
  host: string;
  courses: BridgeCourseSummary[];
  syncedAt: number;
}

export interface BridgeCoursePayload {
  kind?: "course";
  courseId: string;
  courseName: string;
  courseCode?: string;
  host: string;
  assignments: BridgeAssignment[];
  files: BridgeFile[];
  /** File ids still needing byte download via follow-up chunk jobs. */
  pendingFileIds?: string[];
  syncedAt: number;
}

/** One chunk of file bytes for a course already catalogued on the iPad. */
export interface BridgeFilesPayload {
  kind: "files";
  courseId?: string;
  courseName?: string;
  courseCode?: string;
  host: string;
  files: BridgeFile[];
  syncedAt: number;
}

export type BridgePayload =
  | BridgeCoursesPayload
  | BridgeCoursePayload
  | BridgeFilesPayload;

export interface BridgeSession {
  roomId: string;
  pairCode: string;
  bridgeUrl: string;
  canvasHost?: string | null;
  joinedAt: number;
}

export interface BridgeJobView {
  id: string;
  status: BridgeJobStatus;
  courseId?: string | null;
  error?: string | null;
  payload?: BridgePayload | null;
  updatedAt?: number;
  agentOnline?: boolean;
}
