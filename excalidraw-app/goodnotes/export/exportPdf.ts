/**
 * Multi-page PDF export for the GoodNotes-style document layer.
 *
 * Pages are Excalidraw `frame` elements whose `name` starts with
 * {@link PAGE_FRAME_PREFIX} (e.g. `"page:1"`). Each page frame is rendered to
 * its own raster image (clipped to the frame bounds by Excalidraw's own
 * `exportScene({ type: "canvas", config: { exportingFrame } })`) and then
 * placed on a correspondingly sized jsPDF page.
 */

import {
  exportScene,
  getNonDeletedElements,
  THEME,
} from "@excalidraw/excalidraw";
import { jsPDF } from "jspdf";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { getPaperPageRects, renderPaper } from "../paper";
import { PAGE_CUSTOM_DATA_KEY } from "../pages";
import { PAGE_FRAME_PREFIX, PAGE_SIZES } from "../types";

import type { PageSizeName, PaperTemplateId } from "../types";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * PAGE_SIZES are CSS px at 96dpi; PDF user space is points at 72dpi.
 * pt = px * 72 / 96 (i.e. px * 0.75).
 */
export const PX_PER_INCH = 96;
export const PT_PER_INCH = 72;

/** Convert CSS px (96dpi) to PDF points (72dpi). */
export const pxToPt = (px: number): number => (px * PT_PER_INCH) / PX_PER_INCH;

// ---------------------------------------------------------------------------
// Local page-frame helper
//
// Deliberately local (not imported from `goodnotes/pages/`) so this module has
// no cross-feature dependency.
// ---------------------------------------------------------------------------

/** True if the element is a non-deleted frame acting as a document page. */
export const isPageFrame = (
  element: ExcalidrawElement,
): element is NonDeleted<ExcalidrawFrameElement> =>
  element.type === "frame" &&
  !element.isDeleted &&
  typeof element.name === "string" &&
  element.name.startsWith(PAGE_FRAME_PREFIX);

/**
 * Parses the trailing number out of a page frame name (`"page:3"` -> 3).
 * Returns `null` when the suffix isn't a plain positive integer.
 */
const parsePageFrameIndex = (frame: ExcalidrawFrameElement): number | null => {
  // name shapes: "page:", "page:3", "page:3:lined", "page:lined"
  const parts = (frame.name ?? "")
    .slice(PAGE_FRAME_PREFIX.length)
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      return Number(part);
    }
  }
  return null;
};

/**
 * All page frames in document order.
 *
 * Ordered by the number embedded in the frame name when every frame has one
 * (so `page:10` sorts after `page:9`), otherwise by vertical position, which
 * is how pages are stacked on the canvas. Vertical position is always the
 * tie-breaker.
 */
export const getOrderedPageFrames = (
  elements: readonly ExcalidrawElement[],
): NonDeleted<ExcalidrawFrameElement>[] => {
  const frames = elements.filter(isPageFrame);

  return frames.slice().sort((a, b) => {
    const ai = parsePageFrameIndex(a);
    const bi = parsePageFrameIndex(b);
    if (ai !== null && bi !== null && ai !== bi) {
      return ai - bi;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
};

/**
 * The named page-size preset matching these dimensions, if any (1px
 * tolerance). Purely informational — export always uses the frame's real
 * geometry.
 */
export const matchPageSizeName = (
  width: number,
  height: number,
): PageSizeName | null => {
  for (const [name, size] of Object.entries(PAGE_SIZES) as [
    PageSizeName,
    { width: number; height: number },
  ][]) {
    if (Math.abs(size.width - width) <= 1 && Math.abs(size.height - height) <= 1) {
      return name;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Page range parsing
// ---------------------------------------------------------------------------

export type ParsePageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

/**
 * Parses a human page range such as `"1-3,5"` into sorted, de-duplicated,
 * 1-based page numbers. Rejects malformed input with a human-readable message
 * rather than silently dropping tokens.
 */
export const parsePageRange = (
  input: string,
  totalPages: number,
): ParsePageRangeResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a page range, for example 1-3,5." };
  }
  if (totalPages <= 0) {
    return { ok: false, error: "This document has no pages to export." };
  }

  const pages = new Set<number>();

  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      return {
        ok: false,
        error: `Empty entry in "${trimmed}" — remove the extra comma.`,
      };
    }

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (from < 1 || to < 1) {
        return { ok: false, error: `Page numbers start at 1 ("${part}").` };
      }
      if (from > to) {
        return {
          ok: false,
          error: `"${part}" counts backwards — write ${to}-${from} instead.`,
        };
      }
      if (to > totalPages) {
        return {
          ok: false,
          error: `"${part}" is out of range — this document has ${totalPages} page${
            totalPages === 1 ? "" : "s"
          }.`,
        };
      }
      for (let page = from; page <= to; page++) {
        pages.add(page);
      }
      continue;
    }

    if (!/^\d+$/.test(part)) {
      return {
        ok: false,
        error: `"${part}" isn't a page number or range. Use numbers and ranges, for example 1-3,5.`,
      };
    }

    const page = Number(part);
    if (page < 1 || page > totalPages) {
      return {
        ok: false,
        error: `Page ${page} is out of range — this document has ${totalPages} page${
          totalPages === 1 ? "" : "s"
        }.`,
      };
    }
    pages.add(page);
  }

  if (pages.size === 0) {
    return { ok: false, error: "No pages selected." };
  }

  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

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
}

const DEFAULT_SCALE = 2;
/** Guard against absurd canvases (browser canvas limits are ~16k px/side). */
const MAX_SCALE = 8;

/** Let the browser paint progress UI between pages. */
const yieldToUi = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

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
}: ExportDocumentToPdfOptions): Promise<Blob> => {
  const sceneElements = getNonDeletedElements(elements);
  const allPageFrames = getOrderedPageFrames(sceneElements);

  // Per-frame paper template, in precedence order:
  //   1. the pages module's `customData` (canonical; frame names stay plain)
  //   2. a template encoded in the frame name ("page:3:lined"), which the
  //      paper module also understands
  //   3. the caller's document default
  const templateByFrameId = new Map<string, PaperTemplateId>();
  for (const rect of getPaperPageRects(sceneElements)) {
    if (rect.template) {
      templateByFrameId.set(rect.id, rect.template);
    }
  }
  for (const frame of allPageFrames) {
    const stored = (
      frame.customData as Record<string, unknown> | undefined
    )?.[PAGE_CUSTOM_DATA_KEY] as { template?: PaperTemplateId } | undefined;
    if (stored?.template) {
      templateByFrameId.set(frame.id, stored.template);
    }
  }

  if (allPageFrames.length === 0) {
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
            const frame = allPageFrames[pageNumber - 1];
            if (!frame) {
              throw new PdfExportError(
                `Page ${pageNumber} doesn't exist — this document has ${allPageFrames.length} page(s).`,
                pageNumber,
              );
            }
            return { pageNumber, frame };
          })
      : allPageFrames.map((frame, index) => ({
          pageNumber: index + 1,
          frame,
        }));

  if (selected.length === 0) {
    throw new PdfExportError("No pages selected for export.", null);
  }

  const effectiveScale = Math.min(
    MAX_SCALE,
    Math.max(0.1, Number.isFinite(scale) ? scale : DEFAULT_SCALE),
  );

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
      // Ink layer: always transparent, so the paper drawn underneath shows
      // through. Excalidraw clips this to exactly the frame's bounds, with
      // zero padding, and hides the frame's own name/outline.
      const inkCanvas = await exportScene({
        type: "canvas",
        data: {
          elements: sceneElements,
          appState,
          files: files ?? undefined,
        },
        config: {
          exportingFrame: frame,
          // print output is always light theme
          theme: THEME.LIGHT,
          canvasBackgroundColor: false,
          scale: effectiveScale,
        },
      });

      let pageCanvas: HTMLCanvasElement = inkCanvas;

      if (includeBackground) {
        // Paper (sheet fill + rulings + border) is a DOM overlay in the app,
        // not part of the scene, so it has to be redrawn here as the bottom
        // layer of the page.
        const composite = document.createElement("canvas");
        composite.width = inkCanvas.width;
        composite.height = inkCanvas.height;
        const ctx = composite.getContext("2d");
        if (!ctx) {
          throw new Error("could not get a 2d canvas context");
        }
        const sx = inkCanvas.width / frame.width;
        const sy = inkCanvas.height / frame.height;
        ctx.save();
        ctx.scale(sx, sy);
        renderPaper(
          ctx,
          templateByFrameId.get(frame.id) ?? defaultPaperTemplate,
          frame.width,
          frame.height,
          { theme: "light", sheet: true },
        );
        ctx.restore();
        ctx.drawImage(inkCanvas, 0, 0);
        pageCanvas = composite;
      }

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

  return doc.output("blob");
};

/** Normalises a user-supplied name into a `.pdf` filename. */
export const toPdfFileName = (name: string): string => {
  const base = (name || "document").trim().replace(/\.pdf$/i, "") || "document";
  // strip characters that browsers/OSes dislike in download names
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
};

/** Triggers a browser download of an exported PDF blob. */
export const downloadPdfBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = toPdfFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // revoke on the next tick so the download has picked up the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
