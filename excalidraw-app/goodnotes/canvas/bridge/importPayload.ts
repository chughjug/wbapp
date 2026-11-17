/**
 * Turn a bridge course/files payload into local notebooks in the course folder.
 */

import { createDoc, getDoc, listDocs, updateDocMeta } from "../../library";
import { importPdfAsNewDocument } from "../../share-target";
import { canvasAssignmentTag, canvasFileTag } from "../sync";

import { loadCoursePayload, saveCoursePayload, saveCoursesPayload } from "./cache";

import type { DocMeta } from "../../types";
import type {
  BridgeCoursePayload,
  BridgeCoursesPayload,
  BridgeFile,
  BridgeFilesPayload,
  BridgePayload,
} from "./types";

const isCourses = (p: BridgePayload): p is BridgeCoursesPayload =>
  (p as BridgeCoursesPayload).kind === "courses" ||
  ("courses" in p && Array.isArray((p as BridgeCoursesPayload).courses));

const isFiles = (p: BridgePayload): p is BridgeFilesPayload =>
  (p as BridgeFilesPayload).kind === "files";

const isCourse = (p: BridgePayload): p is BridgeCoursePayload =>
  !isFiles(p) &&
  Boolean((p as BridgeCoursePayload).courseId) &&
  Array.isArray((p as BridgeCoursePayload).assignments);

const isPdf = (file: BridgeFile) => {
  const type = (file.contentType || "").toLowerCase();
  const name = file.displayName || "";
  return type.includes("pdf") || /\.pdf$/i.test(name);
};

const courseFolderLabel = (
  courseCode?: string,
  courseName?: string,
  courseId?: string,
) => courseCode?.trim() || courseName?.trim() || courseId || "Canvas";

export interface BridgeImportResult {
  kind: "courses" | "course" | "files";
  coursesCached?: number;
  notebooksCreated: number;
  notebooksUpdated: number;
  filesImported: number;
  filesPlaceholder: number;
  courseLabel?: string;
  pendingFileIds?: string[];
}

const loadTagIndex = async () => {
  const docs = await listDocs();
  const byTag = new Map<string, DocMeta>();
  docs.forEach((doc) =>
    doc.tags.forEach((tag) => {
      if (tag.startsWith("canvas:") || tag.startsWith("canvas-file:")) {
        byTag.set(tag, doc);
      }
    }),
  );
  return byTag;
};

/** Put every file into the course folder (PDF pages or a titled placeholder). */
const importFilesIntoFolder = async (
  files: BridgeFile[],
  courseLabel: string,
  byTag: Map<string, DocMeta>,
  onProgress?: (message: string) => void,
) => {
  let filesImported = 0;
  let filesPlaceholder = 0;

  for (const file of files) {
    const tag = canvasFileTag(file.id);
    const name = file.displayName || `Canvas file ${file.id}`;

    if (file.dataBase64 && isPdf(file)) {
      if (byTag.has(tag)) {
        continue;
      }
      onProgress?.(`Importing ${name} into ${courseLabel}…`);
      try {
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
        byTag.set(tag, {
          id: imported.docId,
          title: imported.title,
          course: courseLabel,
          tags: [tag],
        } as DocMeta);
        filesImported += 1;
      } catch {
        if (!byTag.has(tag)) {
          const created = await createDoc({
            title: name,
            course: courseLabel,
            tags: [tag],
          });
          byTag.set(tag, created);
          filesPlaceholder += 1;
        }
      }
      continue;
    }

    // Non-PDF, or PDF waiting on a chunk / too large: folder placeholder.
    // Skip empty PDF placeholders so chunk imports can create real notebooks.
    if (isPdf(file) && !file.skippedTooLarge && !file.dataBase64) {
      continue;
    }
    if (!byTag.has(tag)) {
      const title = file.skippedTooLarge ? `${name} (too large to sync)` : name;
      const created = await createDoc({
        title,
        course: courseLabel,
        tags: [tag],
      });
      byTag.set(tag, created);
      filesPlaceholder += 1;
    }
  }

  return { filesImported, filesPlaceholder };
};

/**
 * Cache payload + create/update notebooks for assignments; import files into
 * the course folder on the shelf.
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
      filesPlaceholder: 0,
    };
  }

  if (isFiles(payload)) {
    const cached = payload.courseId
      ? loadCoursePayload(payload.courseId)
      : null;
    const courseLabel = courseFolderLabel(
      payload.courseCode || cached?.courseCode,
      payload.courseName || cached?.courseName,
      payload.courseId || cached?.courseId,
    );

    if (cached && payload.courseId) {
      const byId = new Map(cached.files.map((f) => [f.id, f]));
      for (const file of payload.files) {
        const prev = byId.get(file.id);
        byId.set(file.id, {
          ...(prev || file),
          ...file,
          // Don't persist bytes in localStorage.
          dataBase64: undefined,
        });
      }
      saveCoursePayload({
        ...cached,
        courseName: payload.courseName || cached.courseName,
        courseCode: payload.courseCode || cached.courseCode,
        host: payload.host || cached.host,
        files: [...byId.values()],
        syncedAt: payload.syncedAt,
      });
    }

    const byTag = await loadTagIndex();
    const { filesImported, filesPlaceholder } =
      options.importPdfs === false
        ? { filesImported: 0, filesPlaceholder: 0 }
        : await importFilesIntoFolder(
            payload.files,
            courseLabel,
            byTag,
            options.onProgress,
          );

    options.onProgress?.(
      `Added ${filesImported + filesPlaceholder} file${
        filesImported + filesPlaceholder === 1 ? "" : "s"
      } to ${courseLabel}.`,
    );

    return {
      kind: "files",
      notebooksCreated: 0,
      notebooksUpdated: 0,
      filesImported,
      filesPlaceholder,
      courseLabel,
    };
  }

  if (!isCourse(payload)) {
    throw new Error("Unexpected bridge payload.");
  }

  // Caches metadata (no base64) and merges into the course-list picker.
  saveCoursePayload(payload);

  const courseLabel = courseFolderLabel(
    payload.courseCode,
    payload.courseName,
    payload.courseId,
  );

  const byTag = await loadTagIndex();

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

  // Place every file into the course folder immediately (placeholders), then
  // PDF bytes from chunk jobs replace/fill content as they arrive.
  let filesImported = 0;
  let filesPlaceholder = 0;
  if (options.importPdfs !== false) {
    const result = await importFilesIntoFolder(
      payload.files,
      courseLabel,
      byTag,
      options.onProgress,
    );
    filesImported = result.filesImported;
    filesPlaceholder = result.filesPlaceholder;
  }

  const pendingFileIds =
    payload.pendingFileIds?.length
      ? payload.pendingFileIds
      : payload.files.filter((f) => f.downloadUrl && !f.dataBase64).map((f) => f.id);

  options.onProgress?.(
    `Folder “${courseLabel}”: ${payload.files.length} files listed` +
      (pendingFileIds.length
        ? `, downloading ${pendingFileIds.length}…`
        : "."),
  );

  return {
    kind: "course",
    notebooksCreated,
    notebooksUpdated,
    filesImported,
    filesPlaceholder,
    courseLabel,
    pendingFileIds,
  };
};
