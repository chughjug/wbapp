/**
 * One function that turns {@link ExportSettings} into delivered files.
 *
 * The dialog and the one-click re-export toolbar action both call this, so
 * "repeat my last export" is guaranteed to produce the same thing the dialog
 * produced — there is no second code path to drift.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { parsePageRange } from "./pageFrames";
import {
  downloadBlob,
  exportDocumentToPdf,
  PdfExportError,
  toPdfFileName,
} from "./exportPdf";
import { exportDocumentToImages } from "./exportImages";
import { createPageRenderer } from "./renderPage";
import { shareOrDownloadFiles } from "./share";

import type { ExportFormat, ExportSettings } from "./presets";
import type { PageRenderer } from "./renderPage";
import type { ShareOutcome } from "./share";
import type { PaperTemplateId } from "../types";

export interface ResolvePagesOptions {
  settings: ExportSettings;
  totalPages: number;
  currentPageNumber?: number | null;
}

export type ResolvePagesResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

/**
 * The 1-based page numbers these settings select, or a human error.
 * Pure — the preview and the exporter both use it, so they agree.
 */
export const resolvePages = ({
  settings,
  totalPages,
  currentPageNumber,
}: ResolvePagesOptions): ResolvePagesResult => {
  if (totalPages <= 0) {
    return { ok: false, error: "This document has no pages to export." };
  }
  switch (settings.pageMode) {
    case "all":
      return {
        ok: true,
        pages: Array.from({ length: totalPages }, (_, i) => i + 1),
      };
    case "current":
      if (!currentPageNumber || currentPageNumber > totalPages) {
        return {
          ok: false,
          error: "No current page is known — pick a range instead.",
        };
      }
      return { ok: true, pages: [currentPageNumber] };
    case "custom":
    default:
      return parsePageRange(settings.customRange, totalPages);
  }
};

export interface RunExportOptions {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  appState?: Partial<AppState>;
  defaultPaperTemplate?: PaperTemplateId;
  settings: ExportSettings;
  /** Base name, no extension. */
  fileName: string;
  /** 1-based page in view, for `pageMode: "current"`. */
  currentPageNumber?: number | null;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
  /** Reuse the dialog's preview renderer instead of rebuilding one. */
  renderer?: PageRenderer;
}

export interface ExportRunResult {
  format: ExportFormat;
  /** 1-based page numbers that were exported. */
  pages: number[];
  files: { fileName: string; blob: Blob }[];
  totalBytes: number;
  /** What actually happened to the files. */
  delivery: ShareOutcome;
}

const toFile = (blob: Blob, fileName: string, type: string): File =>
  new File([blob], fileName, { type });

/**
 * Renders, then delivers. Delivery is the share sheet when the settings ask
 * for it *and* the browser can take these files, otherwise a download.
 *
 * @throws PdfExportError (with a human message) on cancel or a page failure.
 */
export const runExport = async ({
  elements,
  files,
  appState,
  defaultPaperTemplate = "blank",
  settings,
  fileName,
  currentPageNumber,
  onProgress,
  signal,
  renderer,
}: RunExportOptions): Promise<ExportRunResult> => {
  const pageRenderer =
    renderer ??
    (await createPageRenderer({
      elements,
      files,
      appState,
      defaultPaperTemplate,
    }));

  const resolved = resolvePages({
    settings,
    totalPages: pageRenderer.frames.length,
    currentPageNumber,
  });
  if (!resolved.ok) {
    throw new PdfExportError(resolved.error, null);
  }

  const out: { fileName: string; blob: Blob }[] = [];
  let mimeType = "application/pdf";

  if (settings.format === "png") {
    mimeType = "image/png";
    const images = await exportDocumentToImages({
      elements,
      files,
      appState,
      pageRange: resolved.pages,
      scale: settings.scale,
      includeBackground: settings.includeBackground,
      defaultPaperTemplate,
      fileName,
      onProgress,
      signal,
      renderer: pageRenderer,
    });
    out.push(...images.map(({ fileName: name, blob }) => ({ fileName: name, blob })));
  } else {
    const blob = await exportDocumentToPdf({
      elements,
      files,
      appState,
      pageRange: resolved.pages,
      scale: settings.scale,
      includeBackground: settings.includeBackground,
      defaultPaperTemplate,
      fileName,
      onProgress,
      signal,
      renderer: pageRenderer,
    });
    out.push({ fileName: toPdfFileName(fileName), blob });
  }

  if (signal?.aborted) {
    throw new PdfExportError("Export cancelled.", null);
  }

  let delivery: ShareOutcome = "downloaded";
  if (settings.delivery === "auto") {
    delivery = await shareOrDownloadFiles({
      files: out.map((entry) => toFile(entry.blob, entry.fileName, mimeType)),
      title: fileName,
      download: (file) => downloadBlob(file, file.name),
    });
  } else {
    for (const entry of out) {
      downloadBlob(entry.blob, entry.fileName);
    }
  }

  return {
    format: settings.format,
    pages: resolved.pages,
    files: out,
    totalBytes: out.reduce((sum, entry) => sum + entry.blob.size, 0),
    delivery,
  };
};

/** Human one-liner for a finished export, for the live region and toasts. */
export const describeExportResult = (result: ExportRunResult): string => {
  const count = result.files.length;
  const what =
    result.format === "png"
      ? `${count} image${count === 1 ? "" : "s"}`
      : result.files[0]?.fileName ?? "the PDF";
  switch (result.delivery) {
    case "shared":
      return `Shared ${what}.`;
    case "cancelled":
      return `Sharing ${what} was cancelled. Nothing was saved.`;
    default:
      return `${what} downloaded.`;
  }
};
