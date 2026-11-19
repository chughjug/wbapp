/**
 * The single page rasteriser every export path goes through.
 *
 * PDF pages, PNG pages and the dialog's preview thumbnails are all produced
 * here, so what the preview shows, what the PNG contains and what lands in
 * the PDF cannot drift apart.
 *
 * One page = paper (sheet fill + rulings + background picture + border,
 * redrawn from `goodnotes/paper` because the on-screen paper layer is a DOM
 * canvas *behind* Excalidraw and is not part of the scene) with a
 * transparent ink raster composited on top.
 */

import {
  exportScene,
  getNonDeletedElements,
  THEME,
} from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { toLightExportAppState, toPrintableElements } from "../dark";
import {
  getPaperPageRects,
  preloadPageImages,
  renderPaperForFrame,
} from "../paper";
import { PAGE_CUSTOM_DATA_KEY } from "../pages";

import { getOrderedPageFrames } from "./pageFrames";

import type { PaperTemplateId } from "../types";

/** Raster multiplier used when a caller doesn't pick one. */
export const DEFAULT_SCALE = 2;
/** Guard against absurd canvases (browser canvas limits are ~16k px/side). */
export const MAX_SCALE = 8;

/** Clamp a user/stored scale into something a canvas can actually allocate. */
export const clampScale = (scale: number | undefined): number =>
  Math.min(
    MAX_SCALE,
    Math.max(
      0.01,
      typeof scale === "number" && Number.isFinite(scale)
        ? scale
        : DEFAULT_SCALE,
    ),
  );

export interface CreatePageRendererOptions {
  /** The whole scene. Page frames are discovered within it. */
  elements: readonly ExcalidrawElement[];
  /** Binary files (images) referenced by the scene. */
  files: BinaryFiles | null;
  /** Current app state; forced onto white-paper/black-ink before use. */
  appState?: Partial<AppState>;
  /**
   * Paper template for pages whose frame doesn't carry one
   * (e.g. plain `"page:2"`). @default "blank"
   */
  defaultPaperTemplate?: PaperTemplateId;
}

export interface RenderPageOptions {
  /** Raster multiplier. @default 2 */
  scale?: number;
  /** Composite the paper under the ink. @default true */
  includeBackground?: boolean;
}

export interface PageRenderer {
  /** Every page frame of the scene, in document order. */
  readonly frames: readonly NonDeleted<ExcalidrawFrameElement>[];
  /** The paper template that will be drawn for a given frame. */
  templateFor(frame: ExcalidrawFrameElement): PaperTemplateId;
  /** Rasterise one page. Always light theme — dark output is wrong on paper. */
  renderPage(
    frame: NonDeleted<ExcalidrawFrameElement>,
    options?: RenderPageOptions,
  ): Promise<HTMLCanvasElement>;
}

/**
 * Prepares a renderer for one scene: resolves each page's paper template and
 * awaits every page background picture's decode (page images used to export
 * blank because `renderPaperForFrame` is synchronous and the decode wasn't
 * primed).
 */
export const createPageRenderer = async ({
  elements,
  files,
  appState,
  defaultPaperTemplate = "blank",
}: CreatePageRendererOptions): Promise<PageRenderer> => {
  const sceneElements = getNonDeletedElements(elements);
  const frames = getOrderedPageFrames(sceneElements);

  // Per-frame paper template, in precedence order:
  //   1. the pages module's `customData` (canonical; frame names stay plain)
  //   2. a template encoded in the frame name ("page:3:lined")
  //   3. the caller's document default
  const templateByFrameId = new Map<string, PaperTemplateId>();
  for (const rect of getPaperPageRects(sceneElements)) {
    if (rect.template) {
      templateByFrameId.set(rect.id, rect.template);
    }
  }
  for (const frame of frames) {
    const stored = (frame.customData as Record<string, unknown> | undefined)?.[
      PAGE_CUSTOM_DATA_KEY
    ] as { template?: PaperTemplateId } | undefined;
    if (stored?.template) {
      templateByFrameId.set(frame.id, stored.template);
    }
  }

  // Page background pictures decode asynchronously; renderPaperForFrame is
  // synchronous, so prime the decode cache before rendering any page.
  await preloadPageImages(elements, files ?? null);

  // White paper / black ink, whatever the editor is showing. The ink layer
  // itself is exported with `canvasBackgroundColor: false` so the paper
  // composited underneath shows through, but the appState still has to be
  // light or dark-mode element colours leak into the raster.
  const exportAppState = toLightExportAppState({ ...(appState ?? {}) });

  // Forcing the theme fixes ink the student never chose; it cannot fix ink
  // they chose *because* the page was dark. White-on-dark is a reasonable
  // thing to pick while writing and a blank sheet once printed, so the last
  // step before rasterising lifts any stroke that cannot be seen against
  // the paper up to a 3:1 contrast, hue intact. Highlighters and images are
  // left alone — see `toPrintableElements`.
  const printableElements = toPrintableElements(sceneElements);

  const templateFor = (frame: ExcalidrawFrameElement): PaperTemplateId =>
    templateByFrameId.get(frame.id) ?? defaultPaperTemplate;

  const renderPage = async (
    frame: NonDeleted<ExcalidrawFrameElement>,
    { scale, includeBackground = true }: RenderPageOptions = {},
  ): Promise<HTMLCanvasElement> => {
    const effectiveScale = clampScale(scale);

    // Ink layer: transparent background, clipped by Excalidraw to exactly the
    // frame's bounds with zero padding, frame name/outline hidden.
    const inkCanvas = await exportScene({
      type: "canvas",
      data: {
        elements: printableElements,
        appState: exportAppState,
        files: files ?? undefined,
      },
      config: {
        exportingFrame: frame,
        theme: THEME.LIGHT,
        canvasBackgroundColor: false,
        scale: effectiveScale,
      },
    });

    if (!includeBackground) {
      return inkCanvas;
    }

    const composite = document.createElement("canvas");
    composite.width = inkCanvas.width;
    composite.height = inkCanvas.height;
    const ctx = composite.getContext("2d");
    if (!ctx) {
      throw new Error("could not get a 2d canvas context");
    }
    ctx.save();
    ctx.scale(inkCanvas.width / frame.width, inkCanvas.height / frame.height);
    // renderPaperForFrame, not renderPaper: a page's background picture hangs
    // off the frame, so passing only a template id gave the image no channel
    // and image pages exported blank.
    renderPaperForFrame(ctx, frame, {
      theme: "light",
      sheet: true,
      defaultTemplate: templateFor(frame),
    });
    ctx.restore();
    ctx.drawImage(inkCanvas, 0, 0);
    return composite;
  };

  return { frames, templateFor, renderPage };
};

/** `canvas.toBlob` as a promise, with a real error instead of a null blob. */
export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`could not encode the page as ${type}`));
        }
      },
      type,
      quality,
    );
  });
