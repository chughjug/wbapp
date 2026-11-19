/**
 * Rasterising another notebook's pages, for the reference pane.
 *
 * The pane shows a *second* document beside the one being written in —
 * the lecture PDF, last week's notes, the problem sheet. Reading material,
 * not a second editor.
 *
 * That distinction decides the implementation. Mounting a second
 * Excalidraw instance would give an editable pane, and would also give two
 * canvases competing for pointer events, two autosave loops, two undo
 * stacks, and two copies of the editor's memory on a tablet. For something
 * you only ever read, pages are rasterised with the export pipeline the
 * PDF and image exports already use, and the pane is a column of pictures.
 *
 * Pages render one at a time and on demand: a fifty-page PDF notebook
 * would otherwise rasterise fifty A4 canvases the moment the pane opened.
 */

import { createPageRenderer } from "../export/renderPage";
import { getScene } from "../library/store";

import type { DocScene } from "../types";

/** Raster scale for reference pages. */
export const REFERENCE_SCALE = 1.5;

export interface ReferenceDocument {
  docId: string;
  scene: DocScene;
  pageCount: number;
  /** Rasterise page `index` (0-based). Cached by the caller. */
  renderPage: (index: number) => Promise<HTMLCanvasElement | null>;
}

/**
 * Load a document and prepare a lazy page renderer for it.
 *
 * Returns null when the document has no saved scene — a notebook created
 * but never opened. The pane says so rather than showing an empty column
 * that looks like a failure.
 */
export const loadReference = async (
  docId: string,
): Promise<ReferenceDocument | null> => {
  const scene = await getScene(docId);
  if (!scene) {
    return null;
  }

  const renderer = await createPageRenderer({
    elements: scene.elements,
    files: scene.files ?? null,
    appState: scene.appState,
  });

  return {
    docId,
    scene,
    pageCount: renderer.frames.length,
    renderPage: async (index: number) => {
      const frame = renderer.frames[index];
      if (!frame) {
        return null;
      }
      return renderer.renderPage(frame, { scale: REFERENCE_SCALE });
    },
  };
};

/**
 * Clamp a split fraction to something usable.
 *
 * Below about a fifth the pane is too narrow to read a page in and the
 * handle becomes the only thing in it; above four fifths the notebook you
 * are actually writing in has nowhere to go. Exported so the bound is
 * testable rather than buried in a drag handler.
 */
export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;

export const clampSplit = (fraction: number): number =>
  Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction));

/**
 * Should the pane stack above the editor rather than sit beside it?
 *
 * Side by side needs enough width for two readable columns. Below that a
 * vertical split is the honest answer — two 180px columns are not a split
 * view, they are two unusable ones.
 */
export const SIDE_BY_SIDE_MIN_WIDTH = 720;

export const splitOrientationFor = (
  width: number,
): "side-by-side" | "stacked" =>
  width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "stacked";
