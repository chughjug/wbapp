/**
 * The pipeline every entry point in this module funnels into:
 *
 *   PDF file → `importPdfToElements` → `createDoc` → `saveScene` → docId
 *
 * Deliberately **headless** (no React, no `ExcalidrawImperativeAPI`): the
 * share-target route runs before any editor exists, and the library drop zone
 * creates documents the user is not currently looking at. It imports the
 * library *store* directly rather than the `../library` barrel so that
 * nothing here drags the shelf UI into the bundle. For dropping a PDF
 * into the *open* document there is `importPdfIntoScene` from
 * `../import-pdf`, which this module does not duplicate.
 *
 * Order matters: the PDF is rendered **first** and the document row is
 * created only once there is something to put in it, so a corrupt file never
 * leaves an empty "Untitled notebook" behind on the shelf.
 */

import { importPdfToElements, describePdfImportError } from "../import-pdf";
import { createDoc, saveScene } from "../library/store";

import type { ImportPdfOptions } from "../import-pdf";

/** `%PDF-` — every PDF starts with this, whatever the OS claims the type is. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** How far into the file we will look for the header. */
const PDF_MAGIC_SEARCH_BYTES = 1024;

/** Where a file came from. Only used to word error messages. */
export type SharedPdfOrigin = "share" | "picker" | "drop";

export interface SharedPdfProgress {
  /** 0-based index of the file being worked on. */
  fileIndex: number;
  fileCount: number;
  fileName: string;
  /** Pages rasterised so far in the current file. */
  pagesCompleted: number;
  /** Pages in the current file, or 0 before the PDF has been opened. */
  pageCount: number;
  phase: "checking" | "rendering" | "saving" | "done";
}

export interface ImportedSharedPdf {
  docId: string;
  title: string;
  /** Pages actually imported. */
  pageCount: number;
  fileName: string;
}

export interface SharedPdfFailure {
  fileName: string;
  /** Message fit to show a user verbatim. */
  message: string;
  error: unknown;
}

export interface ImportSharedPdfsResult {
  created: ImportedSharedPdf[];
  failed: SharedPdfFailure[];
}

export interface ImportSharedPdfsOptions {
  /** Forwarded to `importPdfToElements` (scale, template, sizing, …). */
  pdfOptions?: Omit<ImportPdfOptions, "onProgress" | "signal">;
  onProgress?: (progress: SharedPdfProgress) => void;
  /** Called as soon as each document exists, before the batch finishes. */
  onDocumentCreated?: (doc: ImportedSharedPdf) => void;
  signal?: AbortSignal;
  /** Wording only. Default `"picker"`. */
  origin?: SharedPdfOrigin;
}

/** A PDF import that failed for a reason worth showing the user. */
export class SharedPdfImportError extends Error {
  public readonly fileName: string;

  constructor(message: string, fileName: string, cause?: unknown) {
    super(message);
    this.name = "SharedPdfImportError";
    this.fileName = fileName;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** `"Lecture 3.pdf"` → `"Lecture 3"`. */
export const titleFromFileName = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "");
  const trimmed = base.trim();
  return trimmed || "Shared PDF";
};

/** Cheap name/MIME check — use {@link looksLikePdf} before importing. */
export const isProbablyPdf = (file: {
  name?: string;
  type?: string;
}): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");

/**
 * Sniff the `%PDF-` header.
 *
 * Needed because the MIME type is not trustworthy on the paths that matter:
 * iOS hands files from the Files app with an empty `type` surprisingly often,
 * and a renamed `.pdf` that is really a ZIP must fail with "that is not a
 * PDF" rather than a pdf.js stack trace. Some producers put junk before the
 * header, so we scan the first KB rather than only offset 0.
 */
export const looksLikePdf = async (file: Blob): Promise<boolean> => {
  if (!file.size) {
    return false;
  }
  const head = new Uint8Array(
    await file.slice(0, PDF_MAGIC_SEARCH_BYTES).arrayBuffer(),
  );
  outer: for (let i = 0; i + PDF_MAGIC.length <= head.length; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (head[i + j] !== PDF_MAGIC[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
};

const abortError = (): Error => {
  const error = new Error("Import cancelled.");
  error.name = "AbortError";
  return error;
};

/**
 * Render one PDF into a brand-new library document.
 *
 * @throws {SharedPdfImportError} for anything the user should read: not a
 *   PDF, empty file, password-protected, corrupt, pdf.js missing.
 */
export const importPdfAsNewDocument = async (
  file: File,
  options: ImportSharedPdfsOptions & {
    /** Progress for this single file. */
    onPageProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<ImportedSharedPdf> => {
  const { pdfOptions, signal } = options;
  const fileName = file.name || "shared.pdf";

  if (signal?.aborted) {
    throw abortError();
  }

  if (!file.size) {
    throw new SharedPdfImportError(
      `“${fileName}” is empty, so there is nothing to import.`,
      fileName,
    );
  }

  if (!(await looksLikePdf(file))) {
    throw new SharedPdfImportError(
      isProbablyPdf(file)
        ? `“${fileName}” is named like a PDF but its contents are not a PDF, so it cannot be opened.`
        : `“${fileName}” is not a PDF. Only PDF files can be opened as documents.`,
      fileName,
    );
  }

  let result;
  try {
    result = await importPdfToElements(file, {
      ...pdfOptions,
      elements: [],
      sourceName: fileName,
      signal,
      onProgress: options.onPageProgress,
    });
  } catch (error) {
    if (
      (error as Error | undefined)?.name === "AbortError" ||
      signal?.aborted
    ) {
      throw abortError();
    }
    throw new SharedPdfImportError(
      describePdfImportError(error),
      fileName,
      error,
    );
  }

  if (!result.pages.length) {
    throw new SharedPdfImportError(
      `No pages could be read from “${fileName}”.`,
      fileName,
    );
  }

  const title = titleFromFileName(fileName);
  const meta = await createDoc({ title });
  await saveScene(meta.id, {
    elements: result.elements,
    appState: {},
    files: result.files,
  });

  return {
    docId: meta.id,
    title,
    pageCount: result.pages.length,
    fileName,
  };
};

/**
 * Batch form of {@link importPdfAsNewDocument}: one document per file, and a
 * failing file never stops the others.
 *
 * Never rejects except on abort — inspect `failed` for per-file errors.
 */
export const importPdfsAsNewDocuments = async (
  files: readonly File[],
  options: ImportSharedPdfsOptions = {},
): Promise<ImportSharedPdfsResult> => {
  const { onProgress, onDocumentCreated, signal } = options;
  const created: ImportedSharedPdf[] = [];
  const failed: SharedPdfFailure[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    if (signal?.aborted) {
      throw abortError();
    }
    const file = files[fileIndex];
    const fileName = file.name || "shared.pdf";
    const report = (patch: Partial<SharedPdfProgress>) =>
      onProgress?.({
        fileIndex,
        fileCount: files.length,
        fileName,
        pagesCompleted: 0,
        pageCount: 0,
        phase: "rendering",
        ...patch,
      });

    report({ phase: "checking" });

    let pageCount = 0;
    try {
      const doc = await importPdfAsNewDocument(file, {
        ...options,
        onPageProgress: (completed, total) => {
          pageCount = total;
          report({
            phase: "rendering",
            pagesCompleted: completed,
            pageCount: total,
          });
        },
      });
      report({
        phase: "saving",
        pagesCompleted: doc.pageCount,
        pageCount: doc.pageCount || pageCount,
      });
      created.push(doc);
      onDocumentCreated?.(doc);
    } catch (error) {
      if ((error as Error | undefined)?.name === "AbortError") {
        throw error;
      }
      failed.push({
        fileName,
        message:
          error instanceof SharedPdfImportError
            ? error.message
            : describePdfImportError(error),
        error,
      });
    }
  }

  onProgress?.({
    fileIndex: Math.max(files.length - 1, 0),
    fileCount: files.length,
    fileName: "",
    pagesCompleted: 0,
    pageCount: 0,
    phase: "done",
  });

  return { created, failed };
};

/** Keep only the entries that are plausibly PDFs (by name or MIME). */
export const filterPdfFiles = (files: readonly File[]): File[] =>
  files.filter((file) => isProbablyPdf(file) || !file.type);

/** Pull `File`s out of a `DataTransfer`, including the `items` shape. */
export const filesFromDataTransfer = (
  dataTransfer: DataTransfer | null,
): File[] => {
  if (!dataTransfer) {
    return [];
  }
  const fromItems: File[] = [];
  if (dataTransfer.items?.length) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          fromItems.push(file);
        }
      }
    }
  }
  return fromItems.length ? fromItems : Array.from(dataTransfer.files ?? []);
};

/**
 * Does this drag carry something we would try to import? Checked during
 * `dragover`, where file *contents* are not readable — only the item types
 * are, so this is a type-level guess by design.
 */
export const dragHasPdf = (dataTransfer: DataTransfer | null): boolean => {
  if (!dataTransfer) {
    return false;
  }
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  if (items.length) {
    return items.some(
      (item) =>
        item.kind === "file" &&
        (item.type === "application/pdf" || item.type === ""),
    );
  }
  return Array.from(dataTransfer.types ?? []).includes("Files");
};
