/**
 * Last payloads pulled from the laptop extension, used so CourseBrowser /
 * dashboard can read courses without a PAT.
 */

import type { CanvasAssignment, CanvasCourse, CanvasFile } from "../client";
import type { BridgeCoursePayload, BridgeCoursesPayload } from "./types";

const COURSES_KEY = "goodnotes:canvas-bridge-courses";
const courseKey = (id: string) => `goodnotes:canvas-bridge-course:${id}`;

type Listener = () => void;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

export const subscribeBridgeCache = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Drop inlined PDF bytes before localStorage — they blow the ~5MB quota. */
const withoutInlineBytes = (
  payload: BridgeCoursePayload,
): BridgeCoursePayload => ({
  ...payload,
  files: payload.files.map((file) => {
    const { dataBase64, ...rest } = file;
    void dataBase64;
    return rest;
  }),
});

export const saveCoursesPayload = (payload: BridgeCoursesPayload) => {
  try {
    localStorage.setItem(COURSES_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
  notify();
};

export const loadCoursesPayload = (): BridgeCoursesPayload | null => {
  try {
    const raw = localStorage.getItem(COURSES_KEY);
    return raw ? (JSON.parse(raw) as BridgeCoursesPayload) : null;
  } catch {
    return null;
  }
};

/** Ensure a pulled course also appears in the course-list picker. */
export const mergeCourseIntoCoursesList = (payload: BridgeCoursePayload) => {
  const existing = loadCoursesPayload();
  const summary = {
    id: payload.courseId,
    name: payload.courseName,
    courseCode: payload.courseCode,
  };
  if (!existing) {
    saveCoursesPayload({
      kind: "courses",
      host: payload.host,
      courses: [summary],
      syncedAt: payload.syncedAt,
    });
    return;
  }
  const others = existing.courses.filter((c) => c.id !== payload.courseId);
  saveCoursesPayload({
    ...existing,
    host: payload.host || existing.host,
    courses: [...others, summary].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    ),
    syncedAt: Math.max(existing.syncedAt, payload.syncedAt),
  });
};

export const saveCoursePayload = (payload: BridgeCoursePayload) => {
  const slim = withoutInlineBytes(payload);
  try {
    localStorage.setItem(
      courseKey(payload.courseId),
      JSON.stringify(slim),
    );
  } catch {
    // Still notify so UI can refresh from any prior metadata.
  }
  mergeCourseIntoCoursesList(slim);
  notify();
};

export const loadCoursePayload = (
  courseId: string,
): BridgeCoursePayload | null => {
  try {
    const raw = localStorage.getItem(courseKey(courseId));
    return raw ? (JSON.parse(raw) as BridgeCoursePayload) : null;
  } catch {
    return null;
  }
};

/** All course ids that have a cached course payload (not just the list). */
export const listCachedCourseIds = (): string[] => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("goodnotes:canvas-bridge-course:")) {
        ids.push(k.slice("goodnotes:canvas-bridge-course:".length));
      }
    }
  } catch {
    // ignore
  }
  return ids;
};

export const clearBridgeCache = () => {
  try {
    localStorage.removeItem(COURSES_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("goodnotes:canvas-bridge-course:")) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
  notify();
};

export const bridgeCoursesAsCanvas = (): CanvasCourse[] => {
  const payload = loadCoursesPayload();
  if (!payload) {
    return [];
  }
  return payload.courses.map((c) => ({
    id: c.id,
    name: c.name,
    course_code: c.courseCode,
    term: c.term ? { name: c.term } : undefined,
  }));
};

export const bridgeAssignmentsAsCanvas = (
  courseId: string,
): CanvasAssignment[] => {
  const payload = loadCoursePayload(courseId);
  if (!payload) {
    return [];
  }
  return payload.assignments.map((a) => ({
    id: a.id,
    name: a.name,
    due_at: a.dueAt,
    html_url: a.htmlUrl,
    points_possible: a.pointsPossible ?? null,
  }));
};

export const bridgeFilesAsCanvas = (courseId: string): CanvasFile[] => {
  const payload = loadCoursePayload(courseId);
  if (!payload) {
    return [];
  }
  return payload.files.map((f) => ({
    id: f.id,
    display_name: f.displayName,
    "content-type": f.contentType,
    size: f.size,
    // Prefer authenticated Canvas download URL for later import attempts;
    // inlined bytes are imported during applyBridgePayload, not stored here.
    url: f.downloadUrl,
    updated_at: f.updatedAt,
  }));
};
