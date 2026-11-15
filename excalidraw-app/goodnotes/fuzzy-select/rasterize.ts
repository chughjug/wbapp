/**
 * Fuzzy select — rasterization.
 *
 * Turns a lasso selection into a PNG whose shape is the lasso, not its
 * bounding box.
 *
 * Two steps:
 *
 *  1. **Export the region.** Excalidraw's own `exportScene({ type: "canvas" })`
 *     is given the selected elements plus an explicit scene-space rectangle
 *     (`x`/`y`/`width`/`height` with `fit: "none"`, `origin: "canvas"`,
 *     `padding: 0`). That renders exactly the lasso's bounding box at
 *     `scale` device pixels per scene unit, with the scene's own fonts,
 *     images and freedraw rendering — no reimplementation of the renderer.
 *     (`goodnotes/export/exportPdf.ts` uses the same entry point, there with
 *     `exportingFrame` instead of an explicit rect.)
 *
 *  2. **Mask to the path.** The lasso polygon is filled into an offscreen
 *     alpha mask and composited with `globalCompositeOperation =
 *     "destination-in"`, which keeps the exported pixels only where the mask
 *     is opaque. Using a filled (anti-aliased) mask rather than `ctx.clip()`
 *     gives a soft edge instead of a stair-stepped one.
 *
 * The output is transparent outside the lasso, so a duplicate dropped back
 * onto the page does not paint a white box over the paper underneath.
 */

import {
  exportScene,
  getNonDeletedElements,
  THEME,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement, Theme } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { closeLassoPath, getLassoBounds } from "./lasso";

import type { LassoPath, SceneRect } from "./lasso";

/** Default device pixels per scene unit. 2 keeps text/ink crisp. */
export const DEFAULT_RASTER_SCALE = 2;

/** Browsers refuse canvases beyond ~16k px on a side. */
const MAX_CANVAS_DIMENSION = 8192;

/** Below this the selection is treated as empty rather than exported. */
const MIN_REGION_SIZE = 1;

export interface RasterizeLassoOptions {
  /** The elements to draw — normally `LassoSelectionResult.elements`. */
  elements: readonly ExcalidrawElement[];
  /** The scene's binary files, so image elements can resolve their pixels. */
  files: BinaryFiles | null;
  /** Lasso path in scene coordinates. Need not be explicitly closed. */
  path: LassoPath;
  /**
   * Scene rectangle to export. Defaults to the lasso's bounding box; pass
   * `LassoSelectionResult.selectionBounds` to crop to the content instead.
   */
  region?: SceneRect | null;
  /** Scene settings (background colour etc.) — editor state is ignored. */
  appState?: Partial<AppState>;
  /** Device pixels per scene unit. @default 2 */
  scale?: number;
  /**
   * Rendering theme. Note this transforms element colours the way the editor
   * does, so a dark-theme scene copied as `"light"` comes out in its
   * light-theme colours. @default "light"
   */
  theme?: Theme;
  /**
   * Background painted inside the mask. `false` (default) keeps the raster
   * transparent outside the ink, which is what you want for both pasting
   * and duplicating.
   */
  backgroundColor?: string | false;
  /**
   * Skip the mask and keep the full bounding box. Useful for debugging, and
   * for callers that want a plain rectangular crop.
   * @default false
   */
  skipMask?: boolean;
}

export interface RasterizedSelection {
  /** The masked raster. */
  canvas: HTMLCanvasElement;
  /** PNG encoding of {@link canvas}. */
  blob: Blob;
  /** `data:image/png;base64,…` encoding of {@link canvas}. */
  dataURL: string;
  /**
   * The scene rectangle the raster covers. Its width/height are the natural
   * scene-space size of the image, independent of `scale`.
   */
  sceneRect: SceneRect;
  /** Device pixels per scene unit actually used (may be reduced to fit). */
  scale: number;
}

/** A rasterization that could not be produced, with a user-facing reason. */
export class FuzzySelectRasterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FuzzySelectRasterError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Clamps `scale` so neither canvas dimension exceeds the browser's limit.
 * Exported for tests.
 */
export const clampRasterScale = (region: SceneRect, scale: number): number => {
  const longest = Math.max(region.width, region.height);
  if (longest <= 0) {
    return scale;
  }
  return Math.min(scale, MAX_CANVAS_DIMENSION / longest);
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(
          new FuzzySelectRasterError(
            "The browser could not encode the selection as a PNG.",
          ),
        );
      }
    }, "image/png");
  });

/**
 * Paints the lasso polygon as a white silhouette on a transparent canvas of
 * the given pixel size, mapping scene coordinates into it.
 */
const createMaskCanvas = (
  path: LassoPath,
  region: SceneRect,
  pixelWidth: number,
  pixelHeight: number,
  scale: number,
): HTMLCanvasElement => {
  const mask = document.createElement("canvas");
  mask.width = pixelWidth;
  mask.height = pixelHeight;
  const ctx = mask.getContext("2d");
  if (!ctx) {
    throw new FuzzySelectRasterError(
      "The browser did not provide a 2D canvas context for the selection mask.",
    );
  }

  const ring = closeLassoPath(path);
  ctx.beginPath();
  ring.forEach((point, index) => {
    const x = (point.x - region.x) * scale;
    const y = (point.y - region.y) * scale;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = "#fff";
  // non-zero winding, matching the hit-test rule in lasso.ts, so a
  // self-crossing freehand loop stays solid instead of punching holes
  ctx.fill("nonzero");
  // widen the silhouette by half a stroke so the mask does not eat the
  // outermost pixel row of content sitting right on the path
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1, scale);
  ctx.lineJoin = "round";
  ctx.stroke();

  return mask;
};

/**
 * Renders the lassoed region of the scene to a PNG masked to the lasso
 * shape.
 *
 * @throws {FuzzySelectRasterError} when the region is empty or the browser
 * refuses a canvas/encode.
 */
export const rasterizeLassoSelection = async ({
  elements,
  files,
  path,
  region,
  appState,
  scale = DEFAULT_RASTER_SCALE,
  theme = THEME.LIGHT,
  backgroundColor = false,
  skipMask = false,
}: RasterizeLassoOptions): Promise<RasterizedSelection> => {
  if (elements.length === 0) {
    throw new FuzzySelectRasterError("Nothing is selected.");
  }

  const sceneRect = region ?? getLassoBounds(path);

  if (
    !sceneRect ||
    sceneRect.width < MIN_REGION_SIZE ||
    sceneRect.height < MIN_REGION_SIZE
  ) {
    throw new FuzzySelectRasterError(
      "The selected region is too small to copy. Draw a larger loop.",
    );
  }

  const effectiveScale = clampRasterScale(
    sceneRect,
    Math.max(0.1, Number.isFinite(scale) ? scale : DEFAULT_RASTER_SCALE),
  );

  let exported: HTMLCanvasElement;
  try {
    exported = await exportScene({
      type: "canvas",
      data: {
        elements: getNonDeletedElements(elements),
        appState,
        files: files ?? undefined,
      },
      config: {
        // exactly the lasso's bounding box, in scene coordinates, uncropped
        // and unscaled-to-fit
        x: sceneRect.x,
        y: sceneRect.y,
        width: sceneRect.width,
        height: sceneRect.height,
        fit: "none",
        origin: "canvas",
        padding: 0,
        scale: effectiveScale,
        theme,
        canvasBackgroundColor: backgroundColor,
        // a selection is content, not page furniture
        frames: { name: false, outline: false, clip: false },
      },
    });
  } catch (error) {
    throw new FuzzySelectRasterError(
      `The selection could not be rendered: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  let result = exported;

  if (!skipMask) {
    const masked = document.createElement("canvas");
    masked.width = exported.width;
    masked.height = exported.height;
    const ctx = masked.getContext("2d");
    if (!ctx) {
      throw new FuzzySelectRasterError(
        "The browser did not provide a 2D canvas context for the selection.",
      );
    }

    const mask = createMaskCanvas(
      path,
      sceneRect,
      exported.width,
      exported.height,
      effectiveScale,
    );

    ctx.drawImage(exported, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    result = masked;
  }

  const blob = await canvasToPngBlob(result);

  return {
    canvas: result,
    blob,
    dataURL: result.toDataURL("image/png"),
    sceneRect,
    scale: effectiveScale,
  };
};
