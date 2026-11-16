/**
 * Multi-page PDF export for the GoodNotes-style document layer.
 *
 * Pages are Excalidraw `frame` elements whose `name` starts with
 * {@link PAGE_FRAME_PREFIX} (e.g. `"page:1"`). Each page frame is rasterised
 * by the shared renderer in `./renderPage` — paper composited under a
 * transparent ink layer, always light theme — and placed on a
 * correspondingly sized jsPDF page.
 */

import { jsPDF } from "jspdf";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { getOrderedPageFrames, pxToPt } from "./pageFrames";
import { createPageRenderer, DEFAULT_SCALE } from "./renderPage";

import type { PageRenderer } from "./renderPage";
import type { PaperTemplateId } from "../types";

// Re-exported so this module's public surface is unchanged by the split.
export {
  PX_PER_INCH,
  PT_PER_INCH,
  pxToPt,
  isPageFrame,
  getOrderedPageFrames,
  matchPageSizeName,
  parsePageRange,
  formatPageList,
} from "./pageFrames";
export type { ParsePageRangeResult } from "./pageFrames";

export { DEFAULT_SCALE, MAX_SCALE, clampScale } from "./renderPage";

/** Thrown when a specific page fails to render, so the UI can name it. */
export class PdfExportError extends Error {
  /** 1-based page number, or `null` when the failure isn't page-specific. */
  public readonly pageNumber: number | null;

  constructor(message: string, pageNumber: number | null, cause?: unknown) {
    super(message);
    this.name = "PdfExportError";
    this.pageNumber = pageNumber;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface ExportDocumentToPdfOptions {
  /** The whole scene. Page frames are discovered within it. */
  elements: readonly ExcalidrawElement[];
  /** Binary files (images) referenced by the scene. */
  files: BinaryFiles | null;
  /** Current app state; only scene settings (e.g. background colour) are used. */
  appState?: Partial<AppState>;
  /**
   * 1-based page numbers to include, in the document's page order.
   * Omit (or pass `null`) to export every page.
   */
  pageRange?: readonly number[] | null;
  /** Raster multiplier for print quality. @default 2 */
  scale?: number;
  /**
   * Paint the page background — the paper template (lined/grid/Cornell/…)
   * plus the sheet fill — behind each page's ink. The paper layer lives in
   * the DOM, not in the Excalidraw scene, so the PDF has to redraw it.
   * When `false` the page raster is transparent.
   * @default true
   */
  includeBackground?: boolean;
  /**
   * Paper template for pages whose frame name doesn't encode one
   * (e.g. plain `"page:2"`). @default "blank"
   */
  defaultPaperTemplate?: PaperTemplateId;
  /** Stored as the PDF's document title. */
  fileName?: string;
  /** Called after each page is placed. */
  onProgress?: (completed: number, total: number) => void;
  /** Abort cooperatively between pages. */
  signal?: AbortSignal;
  /**
   * Reuse a renderer already built for this scene (the dialog builds one for
   * its preview thumbnails). Optional — omit and one is created.
   */
  renderer?: PageRenderer;
}

/** Let the browser paint progress UI between pages. */
export const yieldToUi = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Resolves a 1-based page range against a scene's page frames.
 *
 * @throws PdfExportError when the document has no pages, or a requested page
 * number doesn't exist.
 */
export const selectPages = <T extends { id: string }>(
  frames: readonly T[],
  pageRange: readonly number[] | null | undefined,
): { pageNumber: number; frame: T }[] => {
  if (frames.length === 0) {
    throw new PdfExportError(
      "This document has no pages to export. Add a page first.",
      null,
    );
  }

  const selected =
    pageRange && pageRange.length > 0
      ? [...new Set(pageRange)]
          .sort((a, b) => a - b)
          .map((pageNumber) => {
            const frame = frames[pageNumber - 1];
            if (!frame) {
              throw new PdfExportError(
                `Page ${pageNumber} doesn't exist — this document has ${frames.length} page(s).`,
                pageNumber,
              );
            }
            return { pageNumber, frame };
          })
      : frames.map((frame, index) => ({ pageNumber: index + 1, frame }));

  if (selected.length === 0) {
    throw new PdfExportError("No pages selected for export.", null);
  }

  return selected;
};

/**
 * Renders every selected page frame and assembles them into a single PDF.
 *
 * The export always uses the LIGHT theme regardless of the editor's current
 * theme — dark-theme output is wrong on paper.
 *
 * @returns a `application/pdf` Blob.
 */
export const exportDocumentToPdf = async ({
  elements,
  files,
  appState,
  pageRange,
  scale = DEFAULT_SCALE,
  includeBackground = true,
  defaultPaperTemplate = "blank",
  fileName,
  onProgress,
  signal,
  renderer,
}: ExportDocumentToPdfOptions): Promise<Blob> => {
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
  let doc: jsPDF | null = null;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      throw new PdfExportError("Export cancelled.", null);
    }

    const { pageNumber, frame } = selected[i];

    // The PDF page matches the page's real geometry, converted px -> pt.
    const widthPt = pxToPt(frame.width);
    const heightPt = pxToPt(frame.height);
    const orientation = widthPt > heightPt ? "landscape" : "portrait";
    const format: [number, number] = [widthPt, heightPt];

    try {
      const pageCanvas = await pageRenderer.renderPage(frame, {
        scale,
        includeBackground,
      });
      const dataUrl = pageCanvas.toDataURL("image/png");

      if (doc === null) {
        doc = new jsPDF({
          unit: "pt",
          format,
          orientation,
          compress: true,
        });
        if (fileName) {
          doc.setProperties({ title: fileName.replace(/\.pdf$/i, "") });
        }
      } else {
        doc.addPage(format, orientation);
      }

      doc.addImage(
        dataUrl,
        "PNG",
        0,
        0,
        widthPt,
        heightPt,
        `page-${pageNumber}`,
        "FAST",
      );
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

  if (doc === null) {
    throw new PdfExportError("Nothing was rendered.", null);
  }

  if (signal?.aborted) {
    throw new PdfExportError("Export cancelled.", null);
  }

  return doc.output("blob");
};

/** Strips characters browsers/OSes dislike in download names. */
export const sanitiseFileName = (name: string): string =>
  ((name || "document").trim() || "document").replace(/[\\/:*?"<>|]+/g, "-");

/** Normalises a user-supplied name into a `.pdf` filename. */
export const toPdfFileName = (name: string): string =>
  `${sanitiseFileName((name || "document").replace(/\.pdf$/i, ""))}.pdf`;

/** Triggers a browser download of a blob under the given file name. */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // revoke on the next tick so the download has picked up the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Triggers a browser download of an exported PDF blob. */
export const downloadPdfBlob = (blob: Blob, fileName: string): void => {
  downloadBlob(blob, toPdfFileName(fileName));
};
