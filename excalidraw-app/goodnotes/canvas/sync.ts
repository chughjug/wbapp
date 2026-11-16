/**
 * Maps Canvas into this app's own model.
 *
 * The shelf already sorts by due date and groups by course, so a Canvas
 * assignment lines up almost exactly with a document: name -> title,
 * course -> course, due_at -> dueDate.
 */

import { createDoc, getDoc, listDocs, updateDocMeta } from "../library";
import { importPdfAsNewDocument } from "../share-target";

import { CanvasError, getFile, listAssignments, listCourses } from "./client";

import type { CanvasAssignment, CanvasCourse, CanvasFile } from "./client";
import type { DocMeta } from "../types";

/** customData-free marker kept on the document so we don't import twice. */
const canvasTag = (assignmentId: string) => `canvas:${assignmentId}`;

export interface AssignmentRow {
  assignment: CanvasAssignment;
  course: CanvasCourse;
  /** The document already created for this assignment, if any. */
  existing: DocMeta | null;
}

/** Every active course's assignments that have a due date, soonest first. */
export const listUpcomingWork = async (): Promise<AssignmentRow[]> => {
  const [courses, docs] = await Promise.all([listCourses(), listDocs()]);
  const byTag = new Map<string, DocMeta>();
  docs.forEach((doc) =>
    doc.tags.forEach((tag) => {
      if (tag.startsWith("canvas:")) {
        byTag.set(tag, doc);
      }
    }),
  );

  const rows: AssignmentRow[] = [];
  // sequential rather than parallel: Canvas rate-limits, and a student may
  // be enrolled in a lot of courses
  for (const course of courses) {
    let assignments: CanvasAssignment[] = [];
    try {
      assignments = await listAssignments(course.id);
    } catch (error) {
      if (error instanceof CanvasError && error.kind === "forbidden") {
        continue; // some courses hide assignments; skip rather than fail all
      }
      throw error;
    }
    assignments
      .filter((a) => a.due_at)
      .forEach((assignment) =>
        rows.push({
          assignment,
          course,
          existing: byTag.get(canvasTag(assignment.id)) ?? null,
        }),
      );
  }

  return rows.sort(
    (a, b) =>
      new Date(a.assignment.due_at ?? 0).getTime() -
      new Date(b.assignment.due_at ?? 0).getTime(),
  );
};

const courseLabel = (course: CanvasCourse) =>
  course.course_code?.trim() || course.name;

/** Create a notebook for an assignment, carrying its course and due date. */
export const createDocumentForAssignment = async (
  row: AssignmentRow,
): Promise<DocMeta> => {
  if (row.existing) {
    return row.existing;
  }
  const doc = await createDoc({
    title: row.assignment.name,
    course: courseLabel(row.course),
    dueDate: row.assignment.due_at
      ? new Date(row.assignment.due_at).getTime()
      : null,
    tags: [canvasTag(row.assignment.id)],
  });
  return doc;
};

/**
 * Refresh due dates on documents already linked to Canvas assignments.
 * Deadlines move; this is the whole reason to connect rather than retype.
 */
export const refreshLinkedDueDates = async (): Promise<number> => {
  const rows = await listUpcomingWork();
  let changed = 0;
  for (const row of rows) {
    const due = row.assignment.due_at
      ? new Date(row.assignment.due_at).getTime()
      : null;
    if (row.existing && row.existing.dueDate !== due) {
      await updateDocMeta(row.existing.id, { dueDate: due });
      changed += 1;
    }
  }
  return changed;
};

export class CanvasDownloadError extends Error {
  constructor(message: string, readonly canOpenInTab: boolean, readonly url?: string) {
    super(message);
    this.name = "CanvasDownloadError";
  }
}

/**
 * Pull a Canvas file into a new document.
 *
 * Canvas hands back a short-lived, pre-signed download URL that usually
 * points at its upload bucket rather than the instance itself. Fetching it
 * from the browser may be blocked by CORS, and the relay deliberately does
 * NOT forward arbitrary hosts — an open file proxy carrying a bearer token
 * is exactly the thing to avoid. So: try the direct fetch, and when it is
 * blocked, say so and offer to open the file instead of failing silently.
 */
export const importCanvasFileAsDocument = async (
  file: CanvasFile,
  options: {
    course?: string;
    onProgress?: (phase: string, done: number, total: number) => void;
  } = {},
): Promise<DocMeta> => {
  const meta = file.url ? file : await getFile(file.id);
  const url = meta.url;
  if (!url) {
    throw new CanvasDownloadError("Canvas gave no download link.", false);
  }

  const type = (meta["content-type"] ?? "").toLowerCase();
  const name = meta.display_name || meta.filename || "Canvas file";
  if (!type.includes("pdf") && !/\.pdf$/i.test(name)) {
    throw new CanvasDownloadError(
      `"${name}" is not a PDF, so it cannot be opened as a document yet.`,
      true,
      url,
    );
  }

  let blob: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    blob = await response.blob();
  } catch {
    throw new CanvasDownloadError(
      `Your browser blocked the download of "${name}" from Canvas's file host. Open it in a new tab and drop it in instead.`,
      true,
      url,
    );
  }

  const pdf = new File([blob], name.endsWith(".pdf") ? name : `${name}.pdf`, {
    type: "application/pdf",
  });
  // importPdfAsNewDocument reports {phase, completed, total} and returns a
  // summary, not the document record, so re-read it afterwards.
  const imported = await importPdfAsNewDocument(pdf, {
    onProgress: options.onProgress
      ? (progress) =>
          options.onProgress?.(
            progress.phase,
            progress.pagesCompleted,
            progress.pageCount,
          )
      : undefined,
  });

  if (options.course) {
    await updateDocMeta(imported.docId, { course: options.course });
  }
  const doc = await getDoc(imported.docId);
  if (!doc) {
    throw new CanvasDownloadError(
      `"${name}" imported but the document could not be read back.`,
      false,
    );
  }
  return doc;
};
