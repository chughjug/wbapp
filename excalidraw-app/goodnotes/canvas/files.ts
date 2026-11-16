/**
 * Canvas files → notebooks.
 *
 * Two things this adds on top of `sync.importCanvasFileAsDocument`:
 *
 * 1. the imported document is **tagged with the Canvas file id**, so the
 *    browser can say "already imported" and offer to open it rather than
 *    silently making a second copy of a 40-page reading;
 * 2. a first-page preview, which deliberately shares the download path with
 *    the import — if the preview is blocked by the browser, so is the
 *    import, and the UI can say so *before* the student clicks.
 */

import { listDocs, updateDocMeta } from "../library";
import { loadPdfjs } from "../import-pdf";

import { getFile } from "./client";
import {
  CanvasDownloadError,
  canvasFileTag,
  importCanvasFileAsDocument,
} from "./sync";

import type { CanvasFile } from "./client";
import type { DocMeta } from "../types";

/** Does this file look like something we can turn into annotatable pages? */
export const isPdfFile = (file: CanvasFile): boolean => {
  const type = (file["content-type"] ?? "").toLowerCase();
  const name = file.display_name || file.filename || "";
  return type.includes("pdf") || /\.pdf$/i.test(name);
};

export const canvasFileName = (file: CanvasFile): string =>
  file.display_name || file.filename || `Canvas file ${file.id}`;

/** A short, honest label for a non-PDF: why its Import button is inert. */
export const describeUnsupportedFile = (file: CanvasFile): string => {
  const type = (file["content-type"] ?? "").toLowerCase();
  if (type.startsWith("image/")) {
    return "Image — can’t become annotatable pages yet";
  }
  if (type.includes("word") || /\.docx?$/i.test(canvasFileName(file))) {
    return "Word document — export it as a PDF in Canvas first";
  }
  if (type.startsWith("video/") || type.startsWith("audio/")) {
    return "Media file — nothing to annotate";
  }
  return "Not a PDF — only PDFs can be imported";
};

/** Map file id → the document already imported from it. */
export const loadImportedFileIndex = async (): Promise<
  Map<string, DocMeta>
> => {
  const docs = await listDocs();
  const index = new Map<string, DocMeta>();
  docs.forEach((doc) =>
    doc.tags.forEach((tag) => {
      if (tag.startsWith("canvas-file:")) {
        index.set(tag.slice("canvas-file:".length), doc);
      }
    }),
  );
  return index;
};

/**
 * Import a Canvas file and tag the result with its file id.
 *
 * Wraps {@link importCanvasFileAsDocument} (whose signature is fixed) — the
 * tag is applied afterwards, so an interrupted tagging leaves a perfectly
 * good document, just an untracked one.
 */
export const importCanvasFile = async (
  file: CanvasFile,
  options: {
    course?: string;
    onProgress?: (phase: string, done: number, total: number) => void;
  } = {},
): Promise<DocMeta> => {
  const doc = await importCanvasFileAsDocument(file, options);
  const tag = canvasFileTag(file.id);
  if (doc.tags.includes(tag)) {
    return doc;
  }
  return updateDocMeta(doc.id, { tags: [...doc.tags, tag] });
};

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PdfPreview {
  /** data: URL of page 1, sized to fit `maxWidth`. */
  dataUrl: string;
  pageCount: number;
  width: number;
  height: number;
}

/**
 * Fetch a Canvas file's bytes.
 *
 * Canvas returns a short-lived pre-signed URL that usually points at its
 * upload bucket. The relay will not forward arbitrary hosts (an open proxy
 * carrying a bearer token is exactly the thing to avoid), so this is a plain
 * browser fetch and CORS may refuse it. That refusal is reported as a
 * `CanvasDownloadError` with `canOpenInTab`, never swallowed.
 */
export const fetchCanvasFileBlob = async (
  file: CanvasFile,
  signal?: AbortSignal,
): Promise<{ blob: Blob; url: string }> => {
  const meta = file.url ? file : await getFile(file.id);
  const url = meta.url;
  if (!url) {
    throw new CanvasDownloadError(
      "Canvas gave no download link for this file.",
      false,
    );
  }
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    return { blob: await response.blob(), url };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new CanvasDownloadError(
      `Your browser blocked the download of “${canvasFileName(
        file,
      )}” from Canvas’s file host. Open it in a new tab and drop it into the app instead.`,
      true,
      url,
    );
  }
};

/** Render page 1 of a PDF blob to a data URL, plus its page count. */
export const renderPdfFirstPage = async (
  blob: Blob,
  maxWidth = 240,
  signal?: AbortSignal,
): Promise<PdfPreview> => {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.2, maxWidth / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error(
        "This browser would not give us a 2D canvas to draw the preview on.",
      );
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return {
      dataUrl: canvas.toDataURL("image/png"),
      pageCount: doc.numPages,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* no-op */
    }
  }
};

/** "3 pages · imports as 3 annotatable pages" */
export const describeImportOutcome = (pageCount: number): string => {
  const pages = `${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
  return `${pages} · imports as ${pageCount} annotatable ${
    pageCount === 1 ? "page" : "pages"
  }`;
};
