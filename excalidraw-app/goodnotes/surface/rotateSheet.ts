/**
 * Rotate sheet — turn a page between portrait and landscape.
 *
 * WHAT IT DOES TO THE SHEET: swaps the page frame's `width` and `height`,
 * flips `customData.goodnotesPage.landscape`, and re-stacks the column so the
 * pages below move up or down and `PAGE_GAP` still holds
 * (`goodnotes/pages/pageModel.ts#restackPages` owns that, and owns moving
 * each page's children with its frame — this module does not reimplement it).
 *
 * WHAT IT DOES TO THE INK (the real decision): **nothing is ever clipped,
 * and nothing is scaled that did not have to be.**
 *
 *  1. The page's content bounding box is measured.
 *  2. If it still fits inside the rotated sheet, the ink is left EXACTLY
 *     where it is — same coordinates, same versions. A4 portrait → landscape
 *     with notes in the top-left is the common case and it costs nothing.
 *  3. If it only overhangs, the content is translated back inside by the
 *     smallest distance that works.
 *  4. Only if it genuinely cannot fit is it scaled down, uniformly, by the
 *     exact factor needed (`min(newW/w, newH/h)`), about the page origin, and
 *     then clamped inside.
 *
 * Why scale-to-fit rather than grow-the-page: growing the page would make
 * the sheet no longer A4 — and the whole point of a sheet is that it is a
 * known paper size that prints and exports as one PDF page. Why uniform
 * rather than stretch: handwriting that has been squashed on one axis is
 * ruined, and un-squashing it is not something undo-after-ten-edits can do
 * for you. Why "only when needed": a round trip (rotate, rotate back) is then
 * a no-op for every page whose ink fits both ways, instead of shrinking the
 * notes by 0.707 each time.
 *
 * Every change goes through `newElementWith`, which bumps
 * `version` / `versionNonce` / `updated` the way the editor does, and the
 * whole thing is committed in ONE `updateScene` with
 * `CaptureUpdateAction.IMMEDIATELY`, so it is a single ordinary Ctrl+Z.
 */

import {
  getCommonBounds,
  isFreeDrawElement,
  isLinearElement,
  isTextElement,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { LocalPoint } from "@excalidraw/math";

import {
  PAGE_CUSTOM_DATA_KEY,
  getPageIndexAtSceneY,
  getPageSizeName,
  getPageTemplate,
  getPages,
  isLandscapePage,
  restackPages,
} from "../pages";

import type { PageCustomData } from "../pages";

type Elements = readonly ExcalidrawElement[];

export interface RotateSheetResult {
  /** The new scene elements (always a new array). */
  elements: ExcalidrawElement[];
  /** `false` when the index addressed no page — nothing was changed. */
  rotated: boolean;
  /** 0-based indices of the pages that were turned. */
  indices: number[];
  /** Uniform factor applied to page contents; `1` when nothing had to shrink. */
  contentScale: number;
  /** Orientation of the (first) rotated page afterwards. */
  landscape: boolean;
}

/**
 * How much of the sheet to keep clear when ink has to be shrunk to fit a
 * rotated page, as a fraction of each side. Purely cosmetic: without it the
 * content box is fitted flush to the paper edge.
 */
const SHEET_FIT_MARGIN_RATIO = 0.03;

const unchanged = (elements: Elements): RotateSheetResult => ({
  elements: elements.slice(),
  rotated: false,
  indices: [],
  contentScale: 1,
  landscape: false,
});

/**
 * Scale an element about `(ox, oy)` by `s`, then translate by `(dx, dy)`.
 * Uniform only, so `angle` is preserved and nothing is sheared.
 *
 * `strokeWidth` is deliberately NOT scaled — the editor's own resize does not
 * scale it either, and a pen that changes nib width because the sheet turned
 * is a surprise.
 */
const transformElement = (
  element: ExcalidrawElement,
  ox: number,
  oy: number,
  s: number,
  dx: number,
  dy: number,
): ExcalidrawElement => {
  const base = {
    x: ox + (element.x - ox) * s + dx,
    y: oy + (element.y - oy) * s + dy,
    width: element.width * s,
    height: element.height * s,
  };

  if (s === 1) {
    // pure translation: points, font size and bound geometry are untouched
    return newElementWith(element, { x: base.x, y: base.y });
  }

  if (isTextElement(element)) {
    return newElementWith(element, {
      ...base,
      fontSize: element.fontSize * s,
    });
  }

  if (isFreeDrawElement(element) || isLinearElement(element)) {
    // points are relative to x/y, so only the magnitudes scale
    return newElementWith(element, {
      ...base,
      points: element.points.map((point) =>
        pointFrom<LocalPoint>(point[0] * s, point[1] * s),
      ),
    });
  }

  return newElementWith(element, base);
};

/**
 * Identity function pinning its argument to `PageCustomData` — the repo's
 * eslint parser cannot read the `satisfies` operator (see `pageModel.ts`).
 */
const asPageCustomData = (data: PageCustomData): PageCustomData => data;

/**
 * Rotates the pages at `indices` (ignoring ones that do not exist) and
 * re-stacks the whole column once at the end.
 */
export const rotateSheetsElements = (
  elements: Elements,
  indices: readonly number[],
): RotateSheetResult => {
  const pages = getPages(elements);
  const targets = [...new Set(indices)]
    .filter((index) => index >= 0 && index < pages.length)
    .sort((a, b) => a - b);

  if (targets.length === 0) {
    return unchanged(elements);
  }

  /** elementId -> transform to apply */
  const transforms = new Map<
    string,
    { ox: number; oy: number; s: number; dx: number; dy: number }
  >();
  /** frameId -> new geometry + customData */
  const frameUpdates = new Map<
    string,
    {
      width: number;
      height: number;
      landscape: boolean;
      frame: ExcalidrawFrameElement;
    }
  >();

  let minScale = 1;
  let lastLandscape = false;

  for (const index of targets) {
    const { frame } = pages[index];
    const newWidth = frame.height;
    const newHeight = frame.width;
    const landscape = !isLandscapePage(frame);
    lastLandscape = landscape;

    frameUpdates.set(frame.id, {
      width: newWidth,
      height: newHeight,
      landscape,
      frame,
    });

    const children = elements.filter(
      (element) => !element.isDeleted && element.frameId === frame.id,
    );
    if (children.length === 0) {
      continue;
    }

    const [minX, minY, maxX, maxY] = getCommonBounds(children);
    // frame-relative content box
    const relX = minX - frame.x;
    const relY = minY - frame.y;
    const boxWidth = Math.max(maxX - minX, 0);
    const boxHeight = Math.max(maxY - minY, 0);

    // Shrink only as much as it takes to make the box fit — inside a margin,
    // not flush to the paper edge. Fitting to the bare sheet put the topmost
    // stroke at y=0.00 and the lowest at exactly y=height, which reads as ink
    // sliced off by the page edge even though nothing is clipped. The margin
    // costs a few percent of scale and keeps the result looking like a page.
    const marginX = newWidth * SHEET_FIT_MARGIN_RATIO;
    const marginY = newHeight * SHEET_FIT_MARGIN_RATIO;
    const fitWidth = Math.max(newWidth - 2 * marginX, 1);
    const fitHeight = Math.max(newHeight - 2 * marginY, 1);

    const s = Math.min(
      1,
      boxWidth > fitWidth ? fitWidth / boxWidth : 1,
      boxHeight > fitHeight ? fitHeight / boxHeight : 1,
    );

    // …then nudge the (possibly scaled) box back inside the sheet. The margin
    // only constrains ink we actually had to shrink: a page whose ink already
    // fits must not be shuffled around just because it sits near an edge.
    const scaledX = relX * s;
    const scaledY = relY * s;
    const scaledWidth = boxWidth * s;
    const scaledHeight = boxHeight * s;
    const insetX = s < 1 ? marginX : 0;
    const insetY = s < 1 ? marginY : 0;

    let dx = 0;
    if (scaledX < insetX) {
      dx = insetX - scaledX;
    } else if (scaledX + scaledWidth > newWidth - insetX) {
      dx = newWidth - insetX - (scaledX + scaledWidth);
    }
    let dy = 0;
    if (scaledY < insetY) {
      dy = insetY - scaledY;
    } else if (scaledY + scaledHeight > newHeight - insetY) {
      dy = newHeight - insetY - (scaledY + scaledHeight);
    }

    minScale = Math.min(minScale, s);

    if (s === 1 && dx === 0 && dy === 0) {
      continue;
    }
    for (const child of children) {
      transforms.set(child.id, { ox: frame.x, oy: frame.y, s, dx, dy });
    }
  }

  const next = elements.map((element) => {
    const frameUpdate = frameUpdates.get(element.id);
    if (frameUpdate) {
      const { width, height, landscape, frame } = frameUpdate;
      return newElementWith(element, {
        width,
        height,
        customData: {
          ...(element.customData ?? {}),
          [PAGE_CUSTOM_DATA_KEY]: asPageCustomData({
            template: getPageTemplate(frame),
            size: getPageSizeName(frame),
            landscape,
          }),
        },
      });
    }
    const transform = transforms.get(element.id);
    if (transform) {
      const { ox, oy, s, dx, dy } = transform;
      return transformElement(element, ox, oy, s, dx, dy);
    }
    return element;
  });

  return {
    // pages below the rotated one move up/down so PAGE_GAP still holds
    elements: restackPages(next),
    rotated: true,
    indices: targets,
    contentScale: minScale,
    landscape: lastLandscape,
  };
};

/** Rotates a single page. */
export const rotateSheetElements = (
  elements: Elements,
  index: number,
): RotateSheetResult => rotateSheetsElements(elements, [index]);

/** Rotates every page in the document. */
export const rotateAllSheetsElements = (
  elements: Elements,
): RotateSheetResult =>
  rotateSheetsElements(
    elements,
    getPages(elements).map((page) => page.index),
  );

// ---------------------------------------------------------------------------
// live editor
// ---------------------------------------------------------------------------

/** 0-based index of the page under the viewport centre; `-1` when none. */
export const getCurrentSheetIndex = (
  api: ExcalidrawImperativeAPI | null,
): number => {
  if (!api || api.isDestroyed) {
    return -1;
  }
  const pages = getPages(api.getSceneElements());
  if (pages.length === 0) {
    return -1;
  }
  const appState = api.getAppState();
  const centreY = appState.height / 2 / appState.zoom.value - appState.scrollY;
  return getPageIndexAtSceneY(pages, centreY);
};

export interface RotateSheetOptions {
  /** 0-based page. Defaults to the page under the viewport centre. */
  index?: number;
  /** Rotate every page instead of one. */
  all?: boolean;
}

/**
 * Rotates a sheet in a live editor. Returns the result so a caller can
 * announce it; `rotated: false` means nothing was changed (no such page).
 *
 * One `updateScene`, `CaptureUpdateAction.IMMEDIATELY` → one undo step.
 */
export const rotateSheet = (
  api: ExcalidrawImperativeAPI | null,
  options: RotateSheetOptions = {},
): RotateSheetResult => {
  if (!api || api.isDestroyed) {
    return unchanged([]);
  }
  const elements = api.getSceneElementsIncludingDeleted();
  const index = options.index ?? getCurrentSheetIndex(api);
  const result = options.all
    ? rotateAllSheetsElements(elements)
    : rotateSheetElements(elements, index);

  if (result.rotated) {
    api.updateScene({
      elements: result.elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
  return result;
};
