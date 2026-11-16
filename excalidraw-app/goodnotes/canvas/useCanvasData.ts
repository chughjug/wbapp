/**
 * Fetch hooks for the course browser: courses, one course's assignments, one
 * course's files.
 *
 * All three share a shape — `{ data, isLoading, error, reload }` — where
 * `error` is already a sentence fit for a `role="alert"`, every request is
 * cancelled on unmount or when the course changes, and `reload` lets a
 * "Try again" button exist. Requests are skipped entirely while Canvas is
 * not connected, so nothing fires a doomed fetch behind the connect screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { listDocs } from "../library";

import { listAssignments, listCourseFiles, listCourses } from "./client";
import { subscribeCanvasConnection, loadCanvasConnection } from "./connection";
import { describeCanvasError } from "./errors";
import { loadImportedFileIndex } from "./files";
import { canvasAssignmentTag, canvasCourseLabel } from "./sync";

import type { CanvasCourse, CanvasFile } from "./client";
import type { CanvasErrorContext } from "./errors";
import type { AssignmentRow } from "./sync";
import type { DocMeta } from "../types";

export interface CanvasResource<T> {
  data: T;
  isLoading: boolean;
  /** Human-readable; null when the last attempt succeeded. */
  error: string | null;
  /** The raw thrown value, for callers that need `kind`. */
  cause: unknown;
  reload: () => void;
}

/** Shared machinery: run `load` whenever `deps` change, newest result wins. */
const useCanvasResource = <T>(
  load: (signal: AbortSignal) => Promise<T>,
  empty: T,
  context: CanvasErrorContext,
  enabled: boolean,
): CanvasResource<T> => {
  const [data, setData] = useState<T>(empty);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cause, setCause] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setData(empty);
      setLoading(false);
      setError(null);
      setCause(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCause(null);
    loadRef
      .current(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setData(empty);
        setError(describeCanvasError(caught, context));
        setCause(caught);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `empty` is a stable literal from each caller; `load` is held in a ref
    // so a new closure every render doesn't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, context]);

  return {
    data,
    isLoading,
    error,
    cause,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
};

/** Whether a connection exists, recomputed on every store change. */
const useConnected = () => {
  const [connected, setConnected] = useState(
    () => loadCanvasConnection() !== null,
  );
  useEffect(() => {
    setConnected(loadCanvasConnection() !== null);
    const unsubscribe = subscribeCanvasConnection(() =>
      setConnected(loadCanvasConnection() !== null),
    );
    return () => {
      unsubscribe();
    };
  }, []);
  return connected;
};

const NO_COURSES: CanvasCourse[] = [];
const NO_ASSIGNMENTS: AssignmentRow[] = [];
const NO_FILES: CourseFileRow[] = [];
const NO_DOCS: DocMeta[] = [];

// ---------------------------------------------------------------------------

export const useCanvasCourses = (): CanvasResource<CanvasCourse[]> => {
  const connected = useConnected();
  const load = useCallback(async () => {
    const courses = await listCourses();
    return courses.filter((course) => !course.concluded && course.name);
  }, []);
  return useCanvasResource(load, NO_COURSES, "courses", connected);
};

/**
 * One course's assignments as {@link AssignmentRow}s — including the ones
 * with no due date, which `listUpcomingWork` filters out but a course browser
 * still has to show.
 */
export const useCourseAssignments = (
  courseId: string | null,
  course: CanvasCourse | null,
): CanvasResource<AssignmentRow[]> => {
  const connected = useConnected();
  const load = useCallback(async () => {
    if (!courseId || !course) {
      return NO_ASSIGNMENTS;
    }
    const [assignments, docs] = await Promise.all([
      listAssignments(courseId),
      listDocs(),
    ]);
    const byTag = new Map<string, DocMeta>();
    docs.forEach((doc) =>
      doc.tags.forEach((tag) => {
        if (tag.startsWith("canvas:")) {
          byTag.set(tag, doc);
        }
      }),
    );
    return assignments
      .map((assignment) => ({
        assignment,
        course,
        existing: byTag.get(canvasAssignmentTag(assignment.id)) ?? null,
      }))
      .sort((a, b) => {
        // dated first, soonest first; undated last, alphabetically
        const aDue = a.assignment.due_at
          ? new Date(a.assignment.due_at).getTime()
          : null;
        const bDue = b.assignment.due_at
          ? new Date(b.assignment.due_at).getTime()
          : null;
        if (aDue != null && bDue != null) {
          return aDue - bDue;
        }
        if (aDue != null) {
          return -1;
        }
        if (bDue != null) {
          return 1;
        }
        return a.assignment.name.localeCompare(b.assignment.name);
      });
  }, [courseId, course]);

  return useCanvasResource(
    load,
    NO_ASSIGNMENTS,
    "assignments",
    connected && Boolean(courseId && course),
  );
};

export interface CourseFileRow {
  file: CanvasFile;
  isPdf: boolean;
  /** The document already imported from this file, if any. */
  imported: DocMeta | null;
}

export const useCourseFiles = (
  courseId: string | null,
): CanvasResource<CourseFileRow[]> => {
  const connected = useConnected();
  const load = useCallback(async () => {
    if (!courseId) {
      return NO_FILES;
    }
    const [files, index] = await Promise.all([
      listCourseFiles(courseId),
      loadImportedFileIndex(),
    ]);
    return files.map((file) => ({
      file,
      isPdf:
        (file["content-type"] ?? "").toLowerCase().includes("pdf") ||
        /\.pdf$/i.test(file.display_name || file.filename || ""),
      imported: index.get(file.id) ?? null,
    }));
  }, [courseId]);

  return useCanvasResource(
    load,
    NO_FILES,
    "files",
    connected && Boolean(courseId),
  );
};

/**
 * The documents this app already holds for a course — the "My notebooks"
 * tab. Local only: it reads IndexedDB, never Canvas, so it works offline and
 * while the token is rejected.
 */
export const useCourseNotebooks = (
  course: CanvasCourse | null,
  refreshKey = 0,
): { docs: DocMeta[]; isLoading: boolean; reload: () => void } => {
  const [docs, setDocs] = useState<DocMeta[]>(NO_DOCS);
  const [isLoading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const label = course ? canvasCourseLabel(course) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDocs()
      .then((all) => {
        if (cancelled) {
          return;
        }
        setDocs(
          label
            ? all.filter(
                (doc) =>
                  (doc.course ?? "").toLowerCase() === label.toLowerCase(),
              )
            : NO_DOCS,
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDocs(NO_DOCS);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [label, nonce, refreshKey]);

  return {
    docs,
    isLoading,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
};

/** Re-export so a host can type a course without reaching into client.ts. */
export type { CanvasCourse, CanvasFile, AssignmentRow };

/** Convenience: find a course by id in a list. */
export const findCourse = (
  courses: readonly CanvasCourse[],
  id: string | null,
): CanvasCourse | null =>
  (id ? courses.find((course) => course.id === id) : undefined) ?? null;
