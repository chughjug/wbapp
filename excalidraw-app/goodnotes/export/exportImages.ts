/**
 * Per-page image export (PNG).
 *
 * Students paste single pages into other documents constantly, so "one PNG
 * per page" is a first-class output, not a lesser one. It goes through the
 * *same* `renderPage` path as the PDF, so an image and the corresponding PDF
 * page are pixel-identical: same paper, same rulings, same background
 * picture, same light theme.
 *
 * There is no zip dependency in this app (and adding one isn't allowed), so
 * a multi-page image export yields separate files: shared together through
 * the OS share sheet where that exists, otherwise downloaded one by one.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  PdfExportError,
  sanitiseFileName,
  selectPages,
  yieldToUi,
} from "./exportPdf";
import { canvasToBlob, createPageRenderer, DEFAULT_SCALE } from "./renderPage";

import type { PageRenderer } from "./renderPage";
import type { PaperTemplateId } from "../types";

export type ImageFormat = "png";

export interface ExportedPageImage {
  /** 1-based page number in the document. */
  pageNumber: number;
  /** Download / share file name, extension included. */
  fileName: string;
  blob: Blob;
  /** Raster size in device pixels. */
  width: number;
  height: number;
}

export interface ExportDocumentToImagesOptions {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  appState?: Partial<AppState>;
  /** 1-based page numbers; omit for every page. */
  pageRange?: readonly number[] | null;
  /** Raster multiplier. @default 2 */
  scale?: number;
  /** Composite the paper under the ink. @default true */
  includeBackground?: boolean;
  defaultPaperTemplate?: PaperTemplateId;
  /** Base name; each page becomes `<base>-page-<n>.png`. */
  fileName?: string;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
  renderer?: PageRenderer;
}

/**
 * `notes` + page 3 of 12 -> `notes-page-03.png`.
 *
 * Page numbers are zero-padded to the width of the document's highest page
 * number so a file manager sorts them the way the document reads.
 */
export const toPageImageFileName = (
  baseName: string,
  pageNumber: number,
  totalPages: number,
  extension = "png",
): string => {
  const base = sanitiseFileName(
    (baseName || "document").replace(/\.(png|pdf|jpe?g)$/i, ""),
  );
  const width = String(Math.max(totalPages, 1)).length;
  return `${base}-page-${String(pageNumber).padStart(width, "0")}.${extension}`;
};

/**
 * Renders each selected page to its own PNG blob.
 *
 * @returns one entry per selected page, in document order.
 */
export const exportDocumentToImages = async ({
  elements,
  files,
  appState,
  pageRange,
  scale = DEFAULT_SCALE,
  includeBackground = true,
  defaultPaperTemplate = "blank",
  fileName = "document",
  onProgress,
  signal,
  renderer,
}: ExportDocumentToImagesOptions): Promise<ExportedPageImage[]> => {
  const pageRenderer =
    renderer ??
    (await createPageRenderer({
      elements,
      files,
      appState,
      defaultPaperTemplate,
    }));

  const selected = selectPages(pageRenderer.frames, pageRange);
  const total = selected.length;
  const highestPageNumber = pageRenderer.frames.length;
  const out: ExportedPageImage[] = [];

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      throw new PdfExportError("Export cancelled.", null);
    }
    const { pageNumber, frame } = selected[i];
    try {
      const canvas = await pageRenderer.renderPage(frame, {
        scale,
        includeBackground,
      });
      const blob = await canvasToBlob(canvas, "image/png");
      out.push({
        pageNumber,
        fileName: toPageImageFileName(fileName, pageNumber, highestPageNumber),
        blob,
        width: canvas.width,
        height: canvas.height,
      });
    } catch (error) {
      if (error instanceof PdfExportError) {
        throw error;
      }
      throw new PdfExportError(
        `Page ${pageNumber} could not be exported: ${
          error instanceof Error ? error.message : String(error)
        }`,
        pageNumber,
        error,
      );
    }

    onProgress?.(i + 1, total);
    if (i < total - 1) {
      await yieldToUi();
    }
  }

  if (signal?.aborted) {
    throw new PdfExportError("Export cancelled.", null);
  }

  return out;
};
