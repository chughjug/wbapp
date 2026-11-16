/**
 * Turning a user-picked image File into a page background.
 *
 * The bytes go into the editor's own `BinaryFiles` store exactly the way the
 * rest of the app does it (`generateIdFromFile` → SHA-1 `fileId`,
 * `getDataURL`, `excalidrawAPI.addFiles`), which is what makes an image page
 * survive save / reload: `excalidraw-app`'s persistence writes `files`
 * alongside the elements, and `FileManager` re-hydrates them on load. We only
 * ever store the `fileId` on the page frame, never the pixels, so two pages
 * backed by the same scan share one blob.
 */

import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { PageImageBackground, PageImageFit } from "../paper/pageImages";

/** Mime types we accept for a page background. */
export const PAGE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

/** `accept` attribute for the dialog's file input. */
export const PAGE_IMAGE_ACCEPT = PAGE_IMAGE_MIME_TYPES.join(",");

/**
 * Soft cap on the source file. Pages are stored as data URLs inside the
 * document, so a 40 MB photo would bloat every save.
 */
export const PAGE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export class PageImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageImageError";
  }
}

export const isSupportedPageImage = (file: File): boolean =>
  (PAGE_IMAGE_MIME_TYPES as readonly string[]).includes(file.type) ||
  /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);

/** Intrinsic pixel size of a data URL, best-effort (never throws). */
const measure = (dataURL: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataURL;
  });

export interface PreparedPageImage {
  /** Ready to hand to `excalidrawAPI.addFiles([file])`. */
  file: BinaryFileData;
  /** Ready to store on a page frame's `customData`. */
  background: PageImageBackground;
}

/**
 * Hash + encode a File into a `BinaryFileData` and the matching
 * `PageImageBackground`. Does NOT touch the scene — see
 * {@link attachPageImageFile} for the editor-aware wrapper.
 */
export const preparePageImage = async (
  file: File,
  opts: { fit?: PageImageFit; opacity?: number } = {},
): Promise<PreparedPageImage> => {
  if (!isSupportedPageImage(file)) {
    throw new PageImageError(
      `"${file.name}" is not an image we can use as a page background. Try a PNG, JPEG, WebP, GIF or SVG.`,
    );
  }
  if (file.size > PAGE_IMAGE_MAX_BYTES) {
    throw new PageImageError(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(
        1,
      )} MB. Page backgrounds are limited to ${
        PAGE_IMAGE_MAX_BYTES / 1024 / 1024
      } MB so documents stay small.`,
    );
  }

  const fileId = await generateIdFromFile(file);
  const dataURL = (await getDataURL(file)) as DataURL;
  const { width, height } = await measure(dataURL as unknown as string);
  const now = Date.now();

  return {
    file: {
      id: fileId,
      mimeType: (file.type || "image/png") as BinaryFileData["mimeType"],
      dataURL,
      created: now,
      lastRetrieved: now,
    },
    background: {
      fileId: fileId as unknown as string,
      mimeType: file.type || "image/png",
      fit: opts.fit ?? "cover",
      ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
      name: file.name,
      ...(width && height
        ? { naturalWidth: width, naturalHeight: height }
        : {}),
    },
  };
};

/**
 * Prepare the image AND register it with the editor, so the `fileId` is
 * resolvable before any element references it. Returns the background record
 * to store on the page frame.
 *
 * Ordering matters and mirrors `goodnotes/import-pdf`: `addFiles` first, then
 * the element — never leave the scene holding a `fileId` the editor cannot
 * resolve.
 */
export const attachPageImageFile = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  file: File,
  opts: { fit?: PageImageFit; opacity?: number } = {},
): Promise<PageImageBackground> => {
  const prepared = await preparePageImage(file, opts);
  excalidrawAPI.addFiles([prepared.file]);
  return prepared.background;
};
