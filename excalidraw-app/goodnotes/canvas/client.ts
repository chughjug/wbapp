/**
 * Typed client for the Canvas REST API, routed through this app's own relay
 * at /api/canvas/proxy.
 *
 * Canvas sends no CORS headers, so the browser cannot call it directly; the
 * relay forwards the request server-side. See api/canvas/proxy.ts for the
 * guards on that endpoint.
 */

import {
  bridgeAssignmentsAsCanvas,
  bridgeCoursesAsCanvas,
  bridgeFilesAsCanvas,
  listCachedCourseIds,
  loadCoursePayload,
} from "./bridge/cache";
import { loadBridgeSession } from "./bridge/session";
import { loadCanvasConnection } from "./connection";

import type { CanvasConnection } from "./connection";

const RELAY = "/api/canvas/proxy";

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind:
      | "not-connected"
      | "unauthorized"
      | "forbidden"
      | "not-found"
      | "network"
      | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

export interface CanvasCourse {
  id: string;
  name: string;
  course_code?: string;
  term?: { name?: string };
  concluded?: boolean;
}

export interface CanvasAssignment {
  id: string;
  name: string;
  due_at: string | null;
  html_url?: string;
  points_possible?: number | null;
  has_submitted_submissions?: boolean;
  submission_types?: string[];
}

export interface CanvasFile {
  id: string;
  display_name: string;
  filename?: string;
  "content-type"?: string;
  size?: number;
  url?: string;
  updated_at?: string;
}

const describe = (status: number): [string, CanvasError["kind"]] => {
  switch (status) {
    case 401:
      return [
        "Canvas rejected the token. It may have been revoked.",
        "unauthorized",
      ];
    case 403:
      return ["Canvas refused the request for this account.", "forbidden"];
    case 404:
      return ["Canvas has no such course or file.", "not-found"];
    default:
      return [`Canvas returned ${status}.`, "unknown"];
  }
};

/** One page of a Canvas collection, plus the `next` link if there is one. */
const requestPage = async <T>(
  path: string,
  query: Record<string, string | number | undefined>,
  connection: CanvasConnection,
): Promise<{ data: T; next: string | null }> => {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined) {
      search.set(k, String(v));
    }
  });

  const url = `${RELAY}?path=${encodeURIComponent(
    path,
  )}&query=${encodeURIComponent(search.toString())}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-canvas-host": connection.host,
        "x-canvas-token": connection.token,
      },
    });
  } catch {
    throw new CanvasError(
      "Could not reach the Canvas relay. Are you offline?",
      undefined,
      "network",
    );
  }

  if (!response.ok) {
    const [message, kind] = describe(response.status);
    throw new CanvasError(message, response.status, kind);
  }

  const link = response.headers.get("x-canvas-link") ?? "";
  const nextMatch = /<([^>]+)>;\s*rel="next"/.exec(link);
  let next: string | null = null;
  if (nextMatch) {
    try {
      next = new URL(nextMatch[1]).searchParams.get("page");
    } catch {
      next = null;
    }
  }

  return { data: (await response.json()) as T, next };
};

/** Follow Canvas pagination to the end, with a hard page cap. */
const requestAll = async <T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  maxPages = 10,
): Promise<T[]> => {
  const connection = loadCanvasConnection();
  if (!connection) {
    throw new CanvasError(
      "Canvas is not connected.",
      undefined,
      "not-connected",
    );
  }

  const out: T[] = [];
  let page: string | null = "1";
  for (let i = 0; i < maxPages && page; i++) {
    const { data, next }: { data: T[]; next: string | null } =
      await requestPage<T[]>(
        path,
        { ...query, per_page: 100, page },
        connection,
      );
    out.push(...(Array.isArray(data) ? data : []));
    page = next;
  }
  return out;
};

const requireTokenOrThrow = () => {
  const connection = loadCanvasConnection();
  if (!connection) {
    throw new CanvasError(
      "Canvas is not connected.",
      undefined,
      "not-connected",
    );
  }
  return connection;
};

/** Verify a connection and return the account name. Used by the connect UI. */
export const checkCanvasConnection = async (
  connection: CanvasConnection,
): Promise<string> => {
  const { data } = await requestPage<{ name?: string; short_name?: string }>(
    "users/self",
    {},
    connection,
  );
  return data.name ?? data.short_name ?? "Canvas user";
};

export const listCourses = async (): Promise<CanvasCourse[]> => {
  if (loadCanvasConnection()) {
    // Match the extension: active + completed + invited, not active-only.
    const states = ["active", "completed", "invited_or_pending"] as const;
    const byId = new Map<string, CanvasCourse>();
    for (const enrollment_state of states) {
      try {
        const page = await requestAll<CanvasCourse>("courses", {
          enrollment_state,
          include: "term",
        });
        for (const course of page) {
          const id = String(course.id);
          if (!byId.has(id) || enrollment_state === "active") {
            byId.set(id, { ...course, id });
          }
        }
      } catch {
        // some tenants reject certain enrollment_state values
      }
    }
    if (byId.size === 0) {
      return requestAll<CanvasCourse>("courses", { include: "term" });
    }
    return [...byId.values()].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, {
        sensitivity: "base",
      }),
    );
  }
  if (loadBridgeSession()) {
    const cached = bridgeCoursesAsCanvas();
    if (cached.length > 0) {
      return cached;
    }
    throw new CanvasError(
      "Paired with your laptop, but no courses yet. Sync the course list from Connect Canvas → Laptop extension.",
      undefined,
      "not-connected",
    );
  }
  throw new CanvasError("Canvas is not connected.", undefined, "not-connected");
};

export const listAssignments = async (
  courseId: string,
): Promise<CanvasAssignment[]> => {
  if (loadCanvasConnection()) {
    return requestAll<CanvasAssignment>(`courses/${courseId}/assignments`, {
      order_by: "due_at",
    });
  }
  if (loadBridgeSession()) {
    if (!loadCoursePayload(courseId)) {
      throw new CanvasError(
        "This course isn’t on the iPad yet. Pull it from Connect Canvas → Laptop extension.",
        undefined,
        "not-found",
      );
    }
    return bridgeAssignmentsAsCanvas(courseId);
  }
  throw new CanvasError("Canvas is not connected.", undefined, "not-connected");
};

export const listCourseFiles = async (
  courseId: string,
): Promise<CanvasFile[]> => {
  if (loadCanvasConnection()) {
    return requestAll<CanvasFile>(`courses/${courseId}/files`, {
      sort: "updated_at",
    });
  }
  if (loadBridgeSession()) {
    if (!loadCoursePayload(courseId)) {
      throw new CanvasError(
        "This course isn’t on the iPad yet. Pull it from Connect Canvas → Laptop extension.",
        undefined,
        "not-found",
      );
    }
    return bridgeFilesAsCanvas(courseId);
  }
  throw new CanvasError("Canvas is not connected.", undefined, "not-connected");
};

/** A single file record, whose `url` is a short-lived direct download. */
export const getFile = async (fileId: string): Promise<CanvasFile> => {
  if (loadBridgeSession() && !loadCanvasConnection()) {
    const courseIds = new Set([
      ...bridgeCoursesAsCanvas().map((c) => c.id),
      ...listCachedCourseIds(),
    ]);
    for (const courseId of courseIds) {
      const hit = bridgeFilesAsCanvas(courseId).find((f) => f.id === fileId);
      if (hit) {
        return hit;
      }
    }
    throw new CanvasError(
      "That file isn’t in the last laptop sync.",
      404,
      "not-found",
    );
  }
  const connection = requireTokenOrThrow();
  const { data } = await requestPage<CanvasFile>(
    `files/${fileId}`,
    {},
    connection,
  );
  return data;
};
