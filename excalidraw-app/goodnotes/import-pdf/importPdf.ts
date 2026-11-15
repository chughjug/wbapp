/**
 * PDF import: turn a PDF into GoodNotes-style pages in the Excalidraw scene.
 *
 * WHAT THIS DOES
 * --------------
 * Every PDF page is **rasterised** with pdf.js into a PNG/JPEG, and that
 * raster is inserted as a locked Excalidraw `image` element parented to a new
 * page frame (see `../pages`). The student then draws on top of it.
 *
 * WHAT THIS DOES NOT DO (read before promising anything to a user)
 * ----------------------------------------------------------------
 * The imported page is a **picture**. There is no selectable, searchable or
 * re-flowable text on the canvas, no vector geometry, no hyperlinks and no
 * form fields. Zooming past the render scale shows interpolation blur, not
 * sharper glyphs. Optionally ({@link ImportPdfOptions.extractText}) the page's
 * text is pulled out with `page.getTextContent()` and stashed as a plain
 * string in the frame's `customData` under {@link PDF_IMPORT_CUSTOM_DATA_KEY}
 * so a future search feature has something to grep — it is metadata only and
 * is never rendered.
 *
 * DEPENDENCY (IMPORTANT)
 * ----------------------
 * This module needs **`pdfjs-dist`**, which is NOT currently a dependency of
 * this repo. Everything here is written against a *dynamic* import so the app
 * still builds and type-checks without it; at runtime, importing a PDF
 * without the package fails with a
 * `PdfImportError` whose `code` is `"missing-dependency"` and whose message
 * names the package. Install it (see `INTEGRATION.md`) or inject your own
 * pdf.js build with {@link configurePdfjs}.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith, newImageElement } from "@excalidraw/element";
import { generateIdFromFile, getDataURL } from "@excalidraw/excalidraw/data/blob";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  ExcalidrawImageElement,
  FileId,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  createPageFrame,
  getPages,
  getStackHeight,
  restackPages,
  scrollToPage,
} from "../pages";

import {
  PAGE_GAP,
  PAGE_SIZES,
  type PageSizeName,
  type PaperTemplateId,
} from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** npm package the renderer needs, and the version range this code targets. */
export const PDFJS_PACKAGE = "pdfjs-dist";
/** Verified against the pdf.js 4.x/5.x API surface (`getDocument`, `page.render`). */
export const PDFJS_VERSION_RANGE = "^4.7.0 || ^5.0.0";

/**
 * `customData` key for this module's per-page provenance. Deliberately NOT
 * the pages module's key (`goodnotesPage`) — both live side by side on the
 * frame's `customData` object.
 */
export const PDF_IMPORT_CUSTOM_DATA_KEY = "goodnotesPdfImport";

/** PDF user units are 1/72in; the page model's presets are CSS px at 96dpi. */
const PDF_POINTS_TO_CSS_PX = 96 / 72;

/** Hard ceiling per canvas side — browsers refuse much larger canvases. */
const MAX_CANVAS_SIDE = 8192;

/** Default raster scale (relative to the PDF's natural 72dpi size). */
export const DEFAULT_RENDER_SCALE = 2;

export const RENDER_SCALE_OPTIONS = [
  { value: 1, label: "1x — draft (smallest, blurry when zoomed)" },
  { value: 2, label: "2x — standard (recommended)" },
  { value: 3, label: "3x — sharp (slower, larger scene)" },
  { value: 4, label: "4x — maximum (very large scene)" },
] as const;

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export type PdfImportErrorCode =
  /** `pdfjs-dist` is not installed and no pdf.js build was injected. */
  | "missing-dependency"
  /** Not a PDF, or the bytes are damaged beyond pdf.js's repair attempts. */
  | "invalid-pdf"
  /** Encrypted; needs a password (or the supplied one was wrong). */
  | "password-required"
  /** The document opened but a page failed to rasterise. */
  | "render-failed"
  /** The caller's `AbortSignal` fired. */
  | "cancelled"
  /** The requested page range selected nothing. */
  | "empty-selection"
  /** Could not obtain a 2D canvas (headless / blocked canvas). */
  | "no-canvas";

export class PdfImportError extends Error {
  public readonly code: PdfImportErrorCode;
  /** 1-based PDF page number, when the failure is page-specific. */
  public readonly pageNumber: number | null;

  constructor(
    code: PdfImportErrorCode,
    message: string,
    pageNumber: number | null = null,
    cause?: unknown,
  ) {
    super(message);
    this.name = "PdfImportError";
    this.code = code;
    this.pageNumber = pageNumber;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** Human-readable message for any thrown value, for UI surfacing. */
export const describePdfImportError = (error: unknown): string => {
  if (error instanceof PdfImportError) {
    return error.pageNumber
      ? `${error.message} (page ${error.pageNumber})`
      : error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "PDF import failed for an unknown reason.";
};

// ---------------------------------------------------------------------------
// pdf.js loading
// ---------------------------------------------------------------------------

/**
 * The slice of the pdf.js API this module uses. Typed structurally so the
 * repo does not need `pdfjs-dist`'s types to compile.
 */
export interface PdfjsLike {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<PdfDocumentLike>;
    destroy: () => Promise<void> | void;
    onPassword?: (
      callback: (password: string) => void,
      reason: number,
    ) => void;
  };
  GlobalWorkerOptions?: { workerSrc?: string; workerPort?: unknown };
  version?: string;
}

interface PdfDocumentLike {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy: () => Promise<void> | void;
}

interface PdfPageLike {
  getViewport: (params: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (params: Record<string, unknown>) => {
    promise: Promise<void>;
    cancel: () => void;
  };
  getTextContent?: () => Promise<{ items: Array<{ str?: string }> }>;
  cleanup?: () => void;
}

let injectedPdfjs: PdfjsLike | null = null;
let injectedWorkerSrc: string | null = null;
let pdfjsPromise: Promise<PdfjsLike> | null = null;

/**
 * Supply a pdf.js build (and/or its worker URL) yourself, e.g.
 *
 * ```ts
 * import * as pdfjs from "pdfjs-dist";
 * import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
 * configurePdfjs({ pdfjs, workerSrc: worker });
 * ```
 *
 * Call this once at app start if you want the bundler to see the dependency
 * statically; otherwise this module resolves `pdfjs-dist` lazily at runtime.
 */
export const configurePdfjs = (config: {
  pdfjs?: PdfjsLike;
  workerSrc?: string;
}) => {
  if (config.pdfjs) {
    injectedPdfjs = config.pdfjs;
    pdfjsPromise = null;
  }
  if (config.workerSrc) {
    injectedWorkerSrc = config.workerSrc;
  }
};

/** Is a pdf.js build reachable? Lets the UI disable itself up front. */
export const isPdfjsAvailable = async (): Promise<boolean> => {
  try {
    await loadPdfjs();
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves pdf.js, or throws `PdfImportError("missing-dependency")`.
 *
 * The specifier is held in a variable and the import is marked
 * `@vite-ignore`: that keeps both TypeScript and Vite from trying to resolve
 * a package that may not be installed, which is what makes this module safe
 * to ship ahead of the dependency.
 */
export const loadPdfjs = async (): Promise<PdfjsLike> => {
  if (injectedPdfjs) {
    applyWorkerSrc(injectedPdfjs);
    return injectedPdfjs;
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const specifier = PDFJS_PACKAGE;
      let mod: Record<string, unknown>;
      try {
        mod = (await import(/* @vite-ignore */ specifier)) as Record<
          string,
          unknown
        >;
      } catch (error) {
        throw new PdfImportError(
          "missing-dependency",
          `PDF import needs the "${PDFJS_PACKAGE}" package (${PDFJS_VERSION_RANGE}), which is not installed. Run \`yarn workspace excalidraw-app add ${PDFJS_PACKAGE}\` (see goodnotes/import-pdf/INTEGRATION.md), or call configurePdfjs() with your own pdf.js build.`,
          null,
          error,
        );
      }
      const candidate = ((mod as { default?: unknown }).default ??
        mod) as PdfjsLike;
      if (typeof candidate?.getDocument !== "function") {
        throw new PdfImportError(
          "missing-dependency",
          `"${PDFJS_PACKAGE}" resolved but does not expose getDocument(); expected ${PDFJS_VERSION_RANGE}.`,
        );
      }
      applyWorkerSrc(candidate);
      return candidate;
    })();
    // don't cache failures: installing the package shouldn't need a reload
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
};

const applyWorkerSrc = (pdfjs: PdfjsLike) => {
  if (injectedWorkerSrc && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = injectedWorkerSrc;
  }
};

// ---------------------------------------------------------------------------
// page ranges
// ---------------------------------------------------------------------------

/**
 * Parses `"1-3, 7, 10-"`-style input into sorted, de-duplicated **1-based**
 * page numbers clamped to `[1, total]`. Returns `null` when the text cannot
 * be parsed (so the UI can show a validation error); an empty/whitespace
 * string means "all pages".
 */
export const parsePageRange = (
  input: string,
  total: number,
): number[] | null => {
  const text = input.trim();
  if (!text) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const selected = new Set<number>();
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!match || (!match[1] && !match[3])) {
      return null;
    }
    const [, rawStart, dash, rawEnd] = match;
    if (!dash) {
      if (!rawStart || rawEnd) {
        return null;
      }
      const page = Number(rawStart);
      if (page >= 1 && page <= total) {
        selected.add(page);
      }
      continue;
    }
    const start = rawStart ? Number(rawStart) : 1;
    const end = rawEnd ? Number(rawEnd) : total;
    if (start > end) {
      return null;
    }
    for (let page = Math.max(1, start); page <= Math.min(total, end); page++) {
      selected.add(page);
    }
  }
  return [...selected].sort((a, b) => a - b);
};

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/**
 * Closest {@link PAGE_SIZES} preset for a PDF page, by aspect ratio.
 *
 * Portrait presets are compared against portrait pages and (transposed)
 * against landscape pages, so a landscape A4 PDF maps to A4 rather than to
 * LEGAL. Returns the preset name plus whether it should be used rotated.
 */
export const matchClosestPageSize = (
  pdfWidthPx: number,
  pdfHeightPx: number,
): { size: PageSizeName; landscape: boolean } => {
  const landscape = pdfWidthPx > pdfHeightPx;
  const ratio = landscape
    ? pdfHeightPx / pdfWidthPx
    : pdfWidthPx / pdfHeightPx;
  let best: PageSizeName = "A4";
  let bestDelta = Infinity;
  for (const name of Object.keys(PAGE_SIZES) as PageSizeName[]) {
    const preset = PAGE_SIZES[name];
    const delta = Math.abs(preset.width / preset.height - ratio);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = name;
    }
  }
  return { size: best, landscape };
};

/** `contain` fit of `inner` inside `outer`, centred. */
const fitContain = (
  innerWidth: number,
  innerHeight: number,
  outerWidth: number,
  outerHeight: number,
) => {
  const factor = Math.min(outerWidth / innerWidth, outerHeight / innerHeight);
  const width = innerWidth * factor;
  const height = innerHeight * factor;
  return {
    width,
    height,
    offsetX: (outerWidth - width) / 2,
    offsetY: (outerHeight - height) / 2,
  };
};

// ---------------------------------------------------------------------------
// options / results
// ---------------------------------------------------------------------------

export type PdfSource = File | Blob | ArrayBuffer | Uint8Array;

/**
 * How the page frame is sized.
 *
 * - `"preset"` (default) — snap to the nearest {@link PAGE_SIZES} preset and
 *   letterbox the raster inside it, centred. Every page in the document then
 *   has a known, uniform size, which is what the rest of the GoodNotes layer
 *   (paper templates, page sidebar, PDF export) assumes, and what GoodNotes
 *   itself does. Pays for it with thin empty margins when the PDF's aspect
 *   isn't exactly Letter/A4/Legal.
 * - `"exact"` — size the frame to the PDF page's true dimensions (converted
 *   72dpi → 96dpi CSS px). Pixel-faithful, at the cost of a document with
 *   mixed page sizes; `getPageSizeName()` then falls back to a best guess and
 *   paper templates may not line up. Use for slide decks and odd formats.
 */
export type PdfPageSizing = "preset" | "exact";

export interface ImportPdfOptions {
  /** Pages to import, 1-based. Omit for all pages. */
  pageNumbers?: readonly number[];
  /** Raster scale relative to the PDF's natural size. Default 2. */
  scale?: number;
  /** Frame sizing strategy. Default `"preset"`. */
  pageSizing?: PdfPageSizing;
  /** Raster encoding. JPEG (default) keeps scenes an order of magnitude smaller. */
  imageFormat?: "image/jpeg" | "image/png";
  /** JPEG quality, 0..1. Default 0.9. Ignored for PNG. */
  imageQuality?: number;
  /** Password for an encrypted PDF. */
  password?: string;
  /** Paper template recorded on the created page frames. Default `"blank"`. */
  template?: PaperTemplateId;
  /**
   * Also pull the page's text with `getTextContent()` and store it on the
   * frame's `customData` for future search. It is NEVER rendered and the page
   * stays a raster image. Default `false`.
   */
  extractText?: boolean;
  /** Called after each page is converted. */
  onProgress?: (completed: number, total: number) => void;
  /** Abort mid-import; rejects with `PdfImportError("cancelled")`. */
  signal?: AbortSignal;
  /** Name recorded in page provenance. Defaults to the File's name. */
  sourceName?: string;
}

export interface ImportPdfToElementsOptions extends ImportPdfOptions {
  /** The scene as it is now. */
  elements: readonly ExcalidrawElement[];
}

export interface ImportedPdfPage {
  frame: ExcalidrawFrameElement;
  image: ExcalidrawImageElement;
  /** 1-based page number in the source PDF. */
  pdfPageNumber: number;
}

export interface ImportPdfResult {
  /** The complete new element array (existing scene + imported pages). */
  elements: ExcalidrawElement[];
  /** Files to hand to `excalidrawAPI.addFiles` / merge into the scene. */
  files: BinaryFiles;
  pages: ImportedPdfPage[];
  /** 0-based index of the first imported page in the document. */
  firstPageIndex: number;
  /** Total pages in the source PDF (not just the imported ones). */
  sourcePageCount: number;
}

/** Provenance written to each imported frame's `customData`. */
export interface PdfImportCustomData {
  sourceName: string | null;
  pdfPageNumber: number;
  /** PDF page size in CSS px at 96dpi, before any preset snapping. */
  sourceWidth: number;
  sourceHeight: number;
  renderScale: number;
  importedAt: number;
  /**
   * Text extracted with `getTextContent()` when `extractText` was on.
   * METADATA ONLY — the canvas shows a raster, not this text.
   */
  text?: string;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

const throwIfAborted = (signal?: AbortSignal, pageNumber?: number) => {
  if (signal?.aborted) {
    throw new PdfImportError(
      "cancelled",
      "PDF import cancelled.",
      pageNumber ?? null,
    );
  }
};

const toUint8Array = async (source: PdfSource): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) {
    // copy: pdf.js transfers (neuters) the buffer it is given
    return new Uint8Array(source);
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }
  return new Uint8Array(await (source as Blob).arrayBuffer());
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  if (typeof document === "undefined") {
    throw new PdfImportError(
      "no-canvas",
      "PDF import needs a DOM canvas and there is no document here.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new PdfImportError(
                "render-failed",
                "The browser could not encode the rendered page.",
              ),
            ),
      type,
      quality,
    );
  });

/** Scale that keeps both canvas sides under {@link MAX_CANVAS_SIDE}. */
const clampScale = (
  requested: number,
  baseWidth: number,
  baseHeight: number,
): number => {
  const safe = Math.max(0.1, Math.min(8, requested || DEFAULT_RENDER_SCALE));
  const longest = Math.max(baseWidth, baseHeight);
  if (longest * safe <= MAX_CANVAS_SIDE) {
    return safe;
  }
  return Math.max(0.1, MAX_CANVAS_SIDE / longest);
};

const isPdfjsException = (error: unknown, name: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: string }).name === name;

/** Maps pdf.js's document-open failures onto {@link PdfImportError}. */
const toOpenError = (error: unknown): PdfImportError => {
  if (error instanceof PdfImportError) {
    return error;
  }
  if (isPdfjsException(error, "PasswordException")) {
    return new PdfImportError(
      "password-required",
      "This PDF is password-protected. Enter its password and try again.",
      null,
      error,
    );
  }
  if (
    isPdfjsException(error, "InvalidPDFException") ||
    isPdfjsException(error, "MissingPDFException") ||
    isPdfjsException(error, "UnexpectedResponseException")
  ) {
    return new PdfImportError(
      "invalid-pdf",
      "This file isn't a readable PDF — it may be corrupt or not a PDF at all.",
      null,
      error,
    );
  }
  return new PdfImportError(
    "invalid-pdf",
    `The PDF could not be opened: ${
      error instanceof Error ? error.message : String(error)
    }`,
    null,
    error,
  );
};

// ---------------------------------------------------------------------------
// core
// ---------------------------------------------------------------------------

/**
 * Rasterises a PDF into page frames + locked image elements and returns the
 * new scene arrays. Pure with respect to the editor: nothing is applied —
 * see {@link importPdfIntoScene} for the version that updates a live editor.
 *
 * @throws {PdfImportError} for a missing pdf.js, a corrupt or encrypted PDF,
 * an empty page selection, a render failure, or cancellation.
 */
export const importPdfToElements = async (
  source: PdfSource,
  options: ImportPdfToElementsOptions,
): Promise<ImportPdfResult> => {
  const {
    elements,
    pageNumbers,
    scale: requestedScale = DEFAULT_RENDER_SCALE,
    pageSizing = "preset",
    imageFormat = "image/jpeg",
    imageQuality = 0.9,
    password,
    template = "blank",
    extractText = false,
    onProgress,
    signal,
  } = options;

  const sourceName =
    options.sourceName ??
    (typeof File !== "undefined" && source instanceof File
      ? source.name
      : null);

  throwIfAborted(signal);

  const pdfjs = await loadPdfjs();
  const data = await toUint8Array(source);

  throwIfAborted(signal);

  const loadingTask = pdfjs.getDocument({
    data,
    password,
    // keep the import self-contained: no CDN fetches for fonts/cmaps
    isEvalSupported: false,
  });

  let doc: PdfDocumentLike;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    throw toOpenError(error);
  }

  try {
    const total = doc.numPages;
    const selected = (
      pageNumbers && pageNumbers.length
        ? [...pageNumbers]
        : Array.from({ length: total }, (_, i) => i + 1)
    )
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= total)
      .sort((a, b) => a - b);

    if (selected.length === 0) {
      throw new PdfImportError(
        "empty-selection",
        `No pages selected. This PDF has ${total} page${
          total === 1 ? "" : "s"
        }.`,
      );
    }

    const existingPages = getPages(elements);
    const firstPageIndex = existingPages.length;
    // Provisional y for each new frame: directly below the current stack.
    // `restackPages` re-asserts this at the end, so it is belt and braces —
    // but keeping the values sane means the image elements are built with
    // in-range coordinates too.
    let nextY =
      existingPages.length === 0 ? 0 : getStackHeight(existingPages) + PAGE_GAP;
    const newElements: ExcalidrawElement[] = [];
    const files: BinaryFiles = {};
    const imported: ImportedPdfPage[] = [];

    onProgress?.(0, selected.length);

    for (let i = 0; i < selected.length; i++) {
      const pdfPageNumber = selected[i];
      throwIfAborted(signal, pdfPageNumber);

      const page = await doc.getPage(pdfPageNumber);
      const base = page.getViewport({ scale: 1 });
      const effectiveScale = clampScale(
        requestedScale,
        base.width,
        base.height,
      );
      const viewport = page.getViewport({ scale: effectiveScale });

      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new PdfImportError(
          "no-canvas",
          "Could not get a 2D canvas context to render the PDF.",
          pdfPageNumber,
        );
      }
      // PDF pages are implicitly white; JPEG has no alpha, so paint it
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        background: "#ffffff",
      });
      const onAbort = () => task.cancel();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await task.promise;
      } catch (error) {
        if (signal?.aborted) {
          throw new PdfImportError(
            "cancelled",
            "PDF import cancelled.",
            pdfPageNumber,
          );
        }
        throw new PdfImportError(
          "render-failed",
          `Page ${pdfPageNumber} could not be rendered.`,
          pdfPageNumber,
          error,
        );
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }

      let text: string | undefined;
      if (extractText && typeof page.getTextContent === "function") {
        try {
          const content = await page.getTextContent();
          text = content.items
            .map((item) => item.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        } catch {
          // text extraction is best-effort metadata; never fail the import
          text = undefined;
        }
      }

      const blob = await canvasToBlob(
        canvas,
        imageFormat,
        Math.min(1, Math.max(0.1, imageQuality)),
      );
      // free the backing store eagerly: a 40-page import is a lot of bitmaps
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const fileName = `${sourceName ?? "import"}-p${pdfPageNumber}.${
        imageFormat === "image/png" ? "png" : "jpg"
      }`;
      const file =
        typeof File !== "undefined"
          ? new File([blob], fileName, { type: imageFormat })
          : (blob as File);
      const fileId = (await generateIdFromFile(file)) as FileId;
      const dataURL = (await getDataURL(file)) as DataURL;

      const now = Date.now();
      const fileData: BinaryFileData = {
        id: fileId,
        mimeType: imageFormat,
        dataURL,
        created: now,
        lastRetrieved: now,
      };
      files[fileId] = fileData;

      // --- geometry -----------------------------------------------------
      const sourceWidth = base.width * PDF_POINTS_TO_CSS_PX;
      const sourceHeight = base.height * PDF_POINTS_TO_CSS_PX;
      const { size, landscape } = matchClosestPageSize(
        sourceWidth,
        sourceHeight,
      );
      const preset = PAGE_SIZES[size];
      const frameWidth =
        pageSizing === "exact"
          ? sourceWidth
          : landscape
          ? preset.height
          : preset.width;
      const frameHeight =
        pageSizing === "exact"
          ? sourceHeight
          : landscape
          ? preset.width
          : preset.height;

      const pageIndex = firstPageIndex + i;
      const baseFrame = createPageFrame(pageIndex, size, { template });
      const provenance: PdfImportCustomData = {
        sourceName,
        pdfPageNumber,
        sourceWidth,
        sourceHeight,
        renderScale: effectiveScale,
        importedAt: now,
        ...(text ? { text } : {}),
      };
      const frame = newElementWith(baseFrame, {
        width: frameWidth,
        height: frameHeight,
        y: nextY,
        customData: {
          ...(baseFrame.customData as Record<string, unknown> | undefined),
          [PDF_IMPORT_CUSTOM_DATA_KEY]: provenance,
        },
      }) as NonDeleted<ExcalidrawFrameElement>;

      const fit = fitContain(
        sourceWidth,
        sourceHeight,
        frameWidth,
        frameHeight,
      );
      const image = newImageElement({
        type: "image",
        x: frame.x + fit.offsetX,
        y: frame.y + fit.offsetY,
        width: fit.width,
        height: fit.height,
        fileId,
        status: "saved",
        frameId: frame.id,
        // Locked: clicks fall through to the canvas, so the student can draw
        // straight on top and can never select, drag or resize the scan.
        locked: true,
        backgroundColor: "transparent",
      });

      // frame first, then its image: array order is z-order, so the raster
      // sits above the frame background and below every stroke added later.
      nextY += frameHeight + PAGE_GAP;

      newElements.push(frame, image);
      imported.push({ frame, image, pdfPageNumber });

      onProgress?.(i + 1, selected.length);
    }

    return {
      // restackPages gives the new frames their real y and `page:<n>` names,
      // and moves their images along with them.
      elements: restackPages([...elements, ...newElements]),
      files,
      pages: imported,
      firstPageIndex,
      sourcePageCount: total,
    };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* no-op */
    }
  }
};

/**
 * Counts the pages of a PDF without rendering anything — used by the dialog
 * to populate the page-range field as soon as a file is chosen.
 */
export const readPdfPageCount = async (
  source: PdfSource,
  options: { password?: string; signal?: AbortSignal } = {},
): Promise<number> => {
  throwIfAborted(options.signal);
  const pdfjs = await loadPdfjs();
  const data = await toUint8Array(source);
  const task = pdfjs.getDocument({ data, password: options.password });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (error) {
    throw toOpenError(error);
  }
  try {
    return doc.numPages;
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* no-op */
    }
  }
};

// ---------------------------------------------------------------------------
// applying to a live editor
// ---------------------------------------------------------------------------

export interface ImportPdfIntoSceneOptions extends ImportPdfOptions {
  /** Scroll the viewport to the first imported page. Default `true`. */
  scrollToFirstPage?: boolean;
}

/**
 * Imports a PDF straight into a running editor: renders it, registers the
 * rasters as scene files, appends the pages and (by default) scrolls to the
 * first one.
 *
 * Files are added BEFORE the elements so the image elements never exist in
 * the scene with a `fileId` the editor can't resolve — that ordering is what
 * keeps the pages from flashing as broken placeholders.
 */
export const importPdfIntoScene = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  source: PdfSource,
  options: ImportPdfIntoSceneOptions = {},
): Promise<ImportPdfResult> => {
  const { scrollToFirstPage = true, ...rest } = options;

  const result = await importPdfToElements(source, {
    ...rest,
    elements: excalidrawAPI.getSceneElements(),
  });

  excalidrawAPI.addFiles(Object.values(result.files));
  excalidrawAPI.updateScene({
    elements: result.elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  if (scrollToFirstPage && result.pages.length) {
    try {
      scrollToPage(excalidrawAPI, result.firstPageIndex);
    } catch {
      // navigation is a nicety; never fail an import over it
    }
  }

  return result;
};

/**
 * Callback-shaped entry point for a toolbar button.
 *
 * ```ts
 * const onImportPdf = createPdfImportHandler(excalidrawAPI, {
 *   onError: (message) => setToast({ message }),
 * });
 * ```
 *
 * The returned function takes the chosen file and resolves to the result, or
 * to `null` when the import failed (the error goes to `onError`) — so a
 * button handler never has to deal with a rejected promise.
 */
export const createPdfImportHandler = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  handlers: {
    onError?: (message: string, error: unknown) => void;
    onSuccess?: (result: ImportPdfResult) => void;
    defaults?: ImportPdfIntoSceneOptions;
  } = {},
) => {
  return async (
    source: PdfSource,
    options: ImportPdfIntoSceneOptions = {},
  ): Promise<ImportPdfResult | null> => {
    try {
      const result = await importPdfIntoScene(excalidrawAPI, source, {
        ...handlers.defaults,
        ...options,
      });
      handlers.onSuccess?.(result);
      return result;
    } catch (error) {
      handlers.onError?.(describePdfImportError(error), error);
      return null;
    }
  };
};
