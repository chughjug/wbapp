/**
 * Image-backed pages.
 *
 * A page whose background is a user-supplied raster (a photo of a worksheet,
 * a scan, a template PNG). Three problems have to be solved and this file
 * solves all three:
 *
 * 1. **Storage.** `PaperTemplateId` (in `../types`) is owned by the
 *    integrator and has no `"image"` member, so we must not invent one. An
 *    image page therefore keeps a *real* template id in
 *    `customData.goodnotesPage.template` (normally `"blank"`, but any ruling
 *    works — the rulings are drawn ON TOP of the image, so "lined over a
 *    scan" is free) and records the image separately under our own key,
 *    {@link PAGE_IMAGE_CUSTOM_DATA_KEY}. `customData` is the sanctioned place
 *    for host data on an element and survives save / reload / collaboration.
 *    See `../pages/INTEGRATION.md` for the one union member we would like
 *    added to `types.ts` to make this prettier.
 *
 * 2. **Bytes.** The raster lives in the editor's own `BinaryFiles` store,
 *    keyed by the same SHA-1 `fileId` the rest of the app uses
 *    (`generateIdFromFile`), added through `excalidrawAPI.addFiles`. We store
 *    only the id, never the pixels, so the image is saved, de-duplicated and
 *    reloaded exactly like an `image` element's bytes.
 *
 * 3. **Synchronous rendering.** `renderPaper` is synchronous; image decode is
 *    not. This module owns a process-wide decoded-image cache keyed by
 *    `fileId`. {@link syncPageImageCache} kicks off decodes in the
 *    background; {@link getDecodedPageImage} is the synchronous lookup
 *    `renderPaper` uses; {@link onPageImageReady} lets a renderer repaint
 *    when a decode lands. Until then a neutral, theme-aware placeholder is
 *    drawn, so the first paint is never a surprising blank hole.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * `customData` key holding the image background of a page frame.
 *
 * Deliberately a SIBLING of the pages module's `goodnotesPage` key rather
 * than a field inside it: `goodnotesPage` is typed `PageCustomData` and is
 * rewritten wholesale by `setPageTemplate`, and keeping the two apart means
 * changing a page's ruling can never clobber its image.
 */
export const PAGE_IMAGE_CUSTOM_DATA_KEY = "goodnotesPageImage";

/** How the raster is mapped onto the page box. */
export type PageImageFit = "cover" | "contain" | "stretch";

/** The record we persist on a page frame's `customData`. */
export interface PageImageBackground {
  /** SHA-1 `fileId` into the editor's `BinaryFiles`. */
  fileId: string;
  /** Mime type of the stored file, for diagnostics / re-export. */
  mimeType?: string;
  /** Default `"cover"`. */
  fit?: PageImageFit;
  /** 0..1, default 1. Lets a template be used as a faint underlay. */
  opacity?: number;
  /** Original file name, shown in UI. Never used for lookup. */
  name?: string;
  /** Intrinsic pixel size, recorded at insert time (purely informational). */
  naturalWidth?: number;
  naturalHeight?: number;
}

type AnyElement = Pick<ExcalidrawElement, "customData">;

/** Reads the image background recorded on an element, if any. */
export const getPageImageBackground = (
  element: AnyElement | null | undefined,
): PageImageBackground | undefined => {
  const raw = (element?.customData as Record<string, unknown> | undefined)?.[
    PAGE_IMAGE_CUSTOM_DATA_KEY
  ];
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as PageImageBackground;
  return typeof value.fileId === "string" && value.fileId ? value : undefined;
};

/**
 * Returns a `customData` object with the image background set (or removed,
 * when `image` is `null`). Pure — the caller decides how to apply it.
 */
export const withPageImageBackground = (
  customData: Record<string, unknown> | undefined,
  image: PageImageBackground | null,
): Record<string, unknown> => {
  const next = { ...(customData ?? {}) };
  if (image) {
    next[PAGE_IMAGE_CUSTOM_DATA_KEY] = image;
  } else {
    delete next[PAGE_IMAGE_CUSTOM_DATA_KEY];
  }
  return next;
};

// ---------------------------------------------------------------------------
// decoded-image cache
// ---------------------------------------------------------------------------

type Decoded = CanvasImageSource & { width: number; height: number };

const decoded = new Map<string, Decoded>();
const pending = new Map<string, Promise<Decoded | null>>();
const failed = new Set<string>();
const listeners = new Set<(fileId: string) => void>();

/**
 * Subscribe to "a page image finished decoding". Renderers that painted a
 * placeholder use this to schedule a repaint. Returns an unsubscribe fn.
 */
export const onPageImageReady = (
  listener: (fileId: string) => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emitReady = (fileId: string) => {
  for (const listener of [...listeners]) {
    try {
      listener(fileId);
    } catch {
      /* a broken subscriber must not break the decode pipeline */
    }
  }
};

/** Synchronous cache lookup. `null` when not decoded (yet) or failed. */
export const getDecodedPageImage = (
  fileId: string | null | undefined,
): Decoded | null => (fileId ? decoded.get(fileId) ?? null : null);

/** True when we have already tried and failed to decode this file. */
export const isPageImageBroken = (fileId: string): boolean =>
  failed.has(fileId);

/**
 * Decode one data URL into the cache. Idempotent and coalesced: concurrent
 * calls for the same `fileId` share one decode.
 */
export const decodePageImage = (
  fileId: string,
  dataURL: string,
): Promise<Decoded | null> => {
  const hit = decoded.get(fileId);
  if (hit) {
    return Promise.resolve(hit);
  }
  const inFlight = pending.get(fileId);
  if (inFlight) {
    return inFlight;
  }
  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }

  const promise = new Promise<Decoded | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      decoded.set(fileId, img as unknown as Decoded);
      failed.delete(fileId);
      pending.delete(fileId);
      emitReady(fileId);
      resolve(img as unknown as Decoded);
    };
    img.onerror = () => {
      failed.add(fileId);
      pending.delete(fileId);
      // still notify: a renderer showing "loading" should switch to "broken"
      emitReady(fileId);
      resolve(null);
    };
    img.src = dataURL;
  });

  pending.set(fileId, promise);
  return promise;
};

/** Drop a file from the cache (e.g. after it was removed from the scene). */
export const forgetPageImage = (fileId: string) => {
  decoded.delete(fileId);
  pending.delete(fileId);
  failed.delete(fileId);
};

/** Test seam: empty the whole cache. */
export const clearPageImageCache = () => {
  decoded.clear();
  pending.clear();
  failed.clear();
};

/** Every image background referenced by the scene, de-duplicated. */
export const collectPageImageBackgrounds = (
  elements: readonly ExcalidrawElement[] | null | undefined,
): PageImageBackground[] => {
  const seen = new Map<string, PageImageBackground>();
  for (const element of elements ?? []) {
    if (element.type !== "frame" || element.isDeleted) {
      continue;
    }
    const image = getPageImageBackground(element);
    if (image && !seen.has(image.fileId)) {
      seen.set(image.fileId, image);
    }
  }
  return [...seen.values()];
};

/**
 * Fire-and-forget: make sure every image background referenced by `elements`
 * is being decoded. Cheap to call on every scene change — already-cached and
 * already-in-flight ids are skipped.
 *
 * Wired into `usePages`, which the host already mounts, so image pages paint
 * without any extra host wiring.
 */
export const syncPageImageCache = (
  elements: readonly ExcalidrawElement[] | null | undefined,
  files: BinaryFiles | null | undefined,
): void => {
  if (!files) {
    return;
  }
  for (const image of collectPageImageBackgrounds(elements)) {
    if (decoded.has(image.fileId) || pending.has(image.fileId)) {
      continue;
    }
    const file = files[image.fileId as keyof BinaryFiles];
    if (file?.dataURL) {
      void decodePageImage(image.fileId, file.dataURL as unknown as string);
    }
  }
};

/**
 * Await every image background the scene needs. Use this before a
 * **synchronous** render that must not miss images — page thumbnails and PDF
 * export both do exactly this.
 */
export const preloadPageImages = async (
  elements: readonly ExcalidrawElement[] | null | undefined,
  files: BinaryFiles | null | undefined,
): Promise<void> => {
  if (!files) {
    return;
  }
  await Promise.all(
    collectPageImageBackgrounds(elements).map((image) => {
      if (decoded.has(image.fileId)) {
        return Promise.resolve(null);
      }
      const file = files[image.fileId as keyof BinaryFiles];
      return file?.dataURL
        ? decodePageImage(image.fileId, file.dataURL as unknown as string)
        : Promise.resolve(null);
    }),
  );
};

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

/** Source rect / destination rect for a fit mode. */
const fitRect = (
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  fit: PageImageFit,
) => {
  if (fit === "stretch" || sw <= 0 || sh <= 0) {
    return { sx: 0, sy: 0, sw, sh, dx: 0, dy: 0, dw, dh };
  }
  if (fit === "contain") {
    const scale = Math.min(dw / sw, dh / sh);
    const w = sw * scale;
    const h = sh * scale;
    return {
      sx: 0,
      sy: 0,
      sw,
      sh,
      dx: (dw - w) / 2,
      dy: (dh - h) / 2,
      dw: w,
      dh: h,
    };
  }
  // cover: crop the source so the page box is completely filled
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  return {
    sx: (sw - w) / 2,
    sy: (sh - h) / 2,
    sw: w,
    sh: h,
    dx: 0,
    dy: 0,
    dw,
    dh,
  };
};

/**
 * Placeholder painted while a page image is still decoding (or when it could
 * not be decoded at all). Low-contrast and theme-aware, so it reads as "this
 * page has a picture coming" rather than as content.
 */
const drawPlaceholder = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: "light" | "dark",
  broken: boolean,
) => {
  const light = theme === "light";
  ctx.save();
  ctx.fillStyle = light
    ? "rgba(27, 27, 31, 0.045)"
    : "rgba(227, 227, 232, 0.06)";
  ctx.fillRect(0, 0, width, height);

  // a simple centred "picture" glyph: frame + horizon + sun
  const s = Math.max(24, Math.min(width, height) * 0.16);
  const cx = width / 2;
  const cy = height / 2;
  ctx.strokeStyle = light
    ? "rgba(27, 27, 31, 0.22)"
    : "rgba(227, 227, 232, 0.26)";
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.lineJoin = "round";
  ctx.strokeRect(cx - s, cy - s * 0.75, s * 2, s * 1.5);

  if (broken) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.45);
    ctx.moveTo(cx + s * 0.6, cy - s * 0.45);
    ctx.lineTo(cx - s * 0.6, cy + s * 0.45);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.85, cy + s * 0.5);
    ctx.lineTo(cx - s * 0.2, cy - s * 0.15);
    ctx.lineTo(cx + s * 0.25, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.55, cy);
    ctx.lineTo(cx + s * 0.85, cy + s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.45, cy - s * 0.4, s * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

/**
 * Draw a page's image background into an already-placed, page-local context
 * (origin at the page's top-left, 1 unit = 1 page CSS px).
 *
 * Fully synchronous: it draws the decoded bitmap when the cache has it and a
 * placeholder when it does not. Returns `true` when the real image was drawn.
 */
export const drawPageImageBackground = (
  ctx: CanvasRenderingContext2D,
  image: PageImageBackground,
  width: number,
  height: number,
  theme: "light" | "dark",
): boolean => {
  const bitmap = getDecodedPageImage(image.fileId);
  if (!bitmap) {
    drawPlaceholder(ctx, width, height, theme, isPageImageBroken(image.fileId));
    return false;
  }

  const sw = Number(bitmap.width) || width;
  const sh = Number(bitmap.height) || height;
  const r = fitRect(sw, sh, width, height, image.fit ?? "cover");

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const opacity = image.opacity;
  if (typeof opacity === "number" && opacity >= 0 && opacity < 1) {
    ctx.globalAlpha = opacity;
  }
  try {
    ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  } catch {
    // a tainted or zero-sized source: fall back to the placeholder
    ctx.globalAlpha = 1;
    drawPlaceholder(ctx, width, height, theme, true);
    ctx.restore();
    return false;
  }
  ctx.restore();
  return true;
};
