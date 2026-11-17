/**
 * Turn a bridge course payload into local notebooks (and optional PDF imports).
 */

import { createDoc, getDoc, listDocs, updateDocMeta } from "../../library";
import { importPdfAsNewDocument } from "../../share-target";
import { canvasAssignmentTag, canvasFileTag } from "../sync";

import { saveCoursePayload, saveCoursesPayload } from "./cache";

import type { DocMeta } from "../../types";
import type {
  BridgeCoursePayload,
  BridgeCoursesPayload,
  BridgePayload,
} from "./types";

const isCourses = (p: BridgePayload): p is BridgeCoursesPayload =>
  (p as BridgeCoursesPayload).kind === "courses" ||
  ("courses" in p && Array.isArray((p as BridgeCoursesPayload).courses));

const isCourse = (p: BridgePayload): p is BridgeCoursePayload =>
  Boolean((p as BridgeCoursePayload).courseId) &&
  Array.isArray((p as BridgeCoursePayload).assignments);

export interface BridgeImportResult {
  kind: "courses" | "course";
  coursesCached?: number;
  notebooksCreated: number;
  notebooksUpdated: number;
  filesImported: number;
  courseLabel?: string;
}

/**
 * Cache payload + create/update notebooks for assignments; import inlined PDFs.
 */
export const applyBridgePayload = async (
  payload: BridgePayload,
  options: {
    importPdfs?: boolean;
    onProgress?: (message: string) => void;
  } = {},
): Promise<BridgeImportResult> => {
  if (isCourses(payload)) {
    saveCoursesPayload({
      kind: "courses",
      host: payload.host,
      courses: payload.courses,
      syncedAt: payload.syncedAt,
    });
    options.onProgress?.(
      `Cached ${payload.courses.length} course${
        payload.courses.length === 1 ? "" : "s"
      } from laptop.`,
    );
    return {
      kind: "courses",
      coursesCached: payload.courses.length,
      notebooksCreated: 0,
      notebooksUpdated: 0,
      filesImported: 0,
    };
  }

  if (!isCourse(payload)) {
    throw new Error("Unexpected bridge payload.");
  }

  // Caches metadata (no base64) and merges into the course-list picker.
  saveCoursePayload(payload);

  const courseLabel =
    payload.courseCode?.trim() || payload.courseName || payload.courseId;

  const docs = await listDocs();
  const byTag = new Map<string, DocMeta>();
  docs.forEach((doc) =>
    doc.tags.forEach((tag) => {
      if (tag.startsWith("canvas:") || tag.startsWith("canvas-file:")) {
        byTag.set(tag, doc);
      }
    }),
  );

  let notebooksCreated = 0;
  let notebooksUpdated = 0;

  for (const assignment of payload.assignments) {
    if (!assignment.dueAt) {
      continue;
    }
    const tag = canvasAssignmentTag(assignment.id);
    const existing = byTag.get(tag);
    const due = new Date(assignment.dueAt).getTime();
    if (existing) {
      if (existing.dueDate !== due || existing.course !== courseLabel) {
        await updateDocMeta(existing.id, {
          dueDate: due,
          course: courseLabel,
          title: assignment.name,
        });
        notebooksUpdated += 1;
      }
      continue;
    }
    await createDoc({
      title: assignment.name,
      course: courseLabel,
      dueDate: due,
      tags: [tag],
    });
    notebooksCreated += 1;
  }

  let filesImported = 0;
  if (options.importPdfs !== false) {
    for (const file of payload.files) {
      if (!file.dataBase64) {
        continue;
      }
      const type = (file.contentType || "").toLowerCase();
      const name = file.displayName || "Canvas file.pdf";
      if (!type.includes("pdf") && !/\.pdf$/i.test(name)) {
        continue;
      }
      const tag = canvasFileTag(file.id);
      if (byTag.has(tag)) {
        continue;
      }
      options.onProgress?.(`Importing ${name}…`);
      const binary = Uint8Array.from(atob(file.dataBase64), (c) =>
        c.charCodeAt(0),
      );
      const pdf = new File(
        [binary],
        name.endsWith(".pdf") ? name : `${name}.pdf`,
        { type: "application/pdf" },
      );
      const imported = await importPdfAsNewDocument(pdf);
      const doc = await getDoc(imported.docId);
      await updateDocMeta(imported.docId, {
        course: courseLabel,
        tags: doc ? [...doc.tags, tag] : [tag],
      });
      filesImported += 1;
    }
  }

  options.onProgress?.(
    `Synced ${courseLabel}: ${payload.files.length} file${
      payload.files.length === 1 ? "" : "s"
    }, ${notebooksCreated} new notebook${
      notebooksCreated === 1 ? "" : "s"
    }, ${filesImported} PDF${filesImported === 1 ? "" : "s"} imported.`,
  );

  return {
    kind: "course",
    notebooksCreated,
    notebooksUpdated,
    filesImported,
    courseLabel,
  };
};
