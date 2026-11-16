/**
 * Whiteboard mode: the same document, with the paper taken away.
 *
 * THE WHOLE TRICK IS THAT NOTHING IS DESTROYED. A whiteboard document is a
 * normal document whose page frames are not drawn, not clipping and not
 * backed by paper:
 *
 *  1. `appState.frameRendering` is switched off — the editor stops painting
 *     frame outlines and names AND stops clipping elements to their frame
 *     (`staticScene.ts` / `renderNewElementScene.ts` both gate the clip on
 *     `frameRendering.enabled && .clip`), so ink can run anywhere;
 *  2. the paper layer is handed an empty page list, so no sheet, ruling or
 *     page picture is painted;
 *  3. paged view is forced to behave as continuous (via the view-mode
 *     override in `goodnotes/paged`), so the viewport is Excalidraw's own
 *     infinite canvas — no fit, no clamp, no matte.
 *
 * Not one element is created, deleted, moved or re-versioned, so switching a
 * 40-page lecture to whiteboard and back is byte-identical by construction
 * (measured: identical ids, versions, versionNonces and centroid).
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  getCommonBounds,
  newElementWith,
  newFrameElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { isPageFrame } from "../pages";
import { setViewModeOverride } from "../paged";
import { PAGE_SIZES } from "../types";

import type { SurfaceMode } from "./surfaceMode";

/** `frameRendering` for a paper document — the editor's own default. */
export const PAPER_FRAME_RENDERING: AppState["frameRendering"] = {
  enabled: true,
  clip: true,
  name: true,
  outline: true,
};

/** `frameRendering` for a whiteboard: frames are there, but invisible. */
export const WHITEBOARD_FRAME_RENDERING: AppState["frameRendering"] = {
  enabled: false,
  clip: false,
  name: false,
  outline: false,
};

export const frameRenderingFor = (
  mode: SurfaceMode,
): AppState["frameRendering"] =>
  mode === "whiteboard" ? WHITEBOARD_FRAME_RENDERING : PAPER_FRAME_RENDERING;

/**
 * Puts a live editor into the given surface mode.
 *
 * `captureUpdate: NEVER` on purpose: this is a view change, not an edit. It
 * must not land on the undo stack (undoing "I turned the paper off" by
 * stepping back through the history would be baffling) and it must not mark
 * the document dirty.
 */
export const applySurfaceMode = (
  api: ExcalidrawImperativeAPI | null,
  mode: SurfaceMode,
): void => {
  // paged view is a paper idea; a whiteboard is always free canvas
  setViewModeOverride(mode === "whiteboard" ? "continuous" : null);

  if (!api || api.isDestroyed) {
    return;
  }
  api.updateScene({
    appState: { frameRendering: frameRenderingFor(mode) },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

/**
 * What to hand `<PaperBackgroundLayer pages={…} />`.
 *
 * `[]` in whiteboard mode (the layer paints nothing), `undefined` in paper
 * mode (the layer falls back to deriving pages from `elements`, exactly as
 * it does today).
 */
const NO_PAPER_PAGES: [] = [];

export const paperPagesFor = (mode: SurfaceMode): [] | undefined =>
  // a stable identity, so handing this to the layer every render does not
  // schedule a repaint every render
  mode === "whiteboard" ? NO_PAPER_PAGES : undefined;

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Breathing room around the ink on an exported whiteboard, in scene px. */
export const WHITEBOARD_EXPORT_PADDING = 48;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything that is not a page frame, i.e. what a whiteboard shows. */
export const getWhiteboardContent = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] =>
  elements.filter((element) => !element.isDeleted && !isPageFrame(element));

/**
 * The bounding box of a whiteboard's ink, padded. Falls back to one A4 sheet
 * at the origin when the board is empty, so "export an empty whiteboard"
 * produces a blank page instead of a zero-sized PDF.
 */
export const getWhiteboardBounds = (
  elements: readonly ExcalidrawElement[],
  padding = WHITEBOARD_EXPORT_PADDING,
): Rect => {
  const content = getWhiteboardContent(elements);
  if (content.length === 0) {
    return {
      x: 0,
      y: 0,
      width: PAGE_SIZES.A4.width,
      height: PAGE_SIZES.A4.height,
    };
  }
  const [minX, minY, maxX, maxY] = getCommonBounds(content);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
};

/** Frame id of the synthetic one-page frame built for a whiteboard export. */
export const WHITEBOARD_EXPORT_FRAME_NAME = "page:1";

/**
 * A scene the existing exporters can take unchanged: the whiteboard's ink,
 * unparented from the (hidden) page frames, plus ONE synthetic page frame
 * covering the used bounding box and named `page:1`.
 *
 * `goodnotes/export` finds pages by frame name and rasterises each with
 * `exportingFrame`, which selects elements by OVERLAP (`getElementsOverlappingFrame`),
 * not by `frameId` — so one big frame over the content is all a whiteboard
 * export needs, and `exportDocumentToPdf` / `exportDocumentToImages` work
 * with no change to that module at all.
 *
 * The result is a throwaway array: it is never written back to the editor.
 */
export const getWhiteboardExportScene = (
  elements: readonly ExcalidrawElement[],
  padding = WHITEBOARD_EXPORT_PADDING,
): {
  elements: ExcalidrawElement[];
  frame: NonDeleted<ExcalidrawFrameElement>;
  bounds: Rect;
} => {
  const bounds = getWhiteboardBounds(elements, padding);
  const content = getWhiteboardContent(elements).map((element) =>
    element.frameId ? newElementWith(element, { frameId: null }) : element,
  );
  const frame = newFrameElement({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    backgroundColor: "transparent",
    name: WHITEBOARD_EXPORT_FRAME_NAME,
  });
  return { elements: [...content, frame], frame, bounds };
};
