/**
 * Fuzzy select — geometry.
 *
 * A "fuzzy select" is a freehand (lasso) region the user draws over the
 * canvas. This module owns the *geometry* half of the feature:
 *
 *   - capturing a freehand path in SCENE coordinates
 *   - closing / simplifying it
 *   - hit-testing scene elements against it
 *
 * ## Reuse of the editor's own lasso
 *
 * This fork's editor already ships a lasso tool
 * (`packages/excalidraw/lasso/`). Its selection core,
 * {@link getLassoSelectedElementIds}, is a *pure* function — path in,
 * element ids out — and it already handles the hard parts: frame clipping,
 * bound text, group completeness, non-zero winding point-in-polygon, and
 * segment/segment intersection. We call it rather than reimplementing any of
 * it. What lives here is only what the editor's `LassoTrail` class does NOT
 * give us:
 *
 *   - a headless path recorder (the editor's is welded to `App` and to its
 *     `AnimatedTrail` renderer, and it mutates `appState.selectedElementIds`
 *     as a side effect — we need a selection we can rasterize without
 *     touching editor state)
 *   - the image-overlap rule described below, which the editor has no
 *     concept of
 *
 * ## Containment rule
 *
 * Default is **full containment** (`"contain"`) for ordinary elements, with
 * an **overlap** exception for image elements.
 *
 * Why full containment for ink/shapes: the result of a fuzzy select is
 * rasterized and *masked to the lasso path*. An element that merely crosses
 * the lasso boundary would therefore be sliced in half in the output. For a
 * note-taking app that is almost never what the user meant — circling
 * roughly around a word should take the whole word, and a stroke you only
 * clipped the tail of should be left alone. "Contain" is also what the
 * editor's own lasso defaults to, so the behaviour matches the rest of the
 * app.
 *
 * Why images are the exception: the motivating use case is a student
 * circling one diagram on an imported worksheet. That worksheet is a single
 * huge image element which can never be fully contained by a small lasso, so
 * a strict rule would select nothing at all. Images are pixel data with no
 * meaningful "shape" to cut through, and the raster mask crops them to the
 * lasso anyway — so including an image the lasso overlaps gives exactly the
 * expected result. Set `includeOverlappingImages: false` to turn this off.
 *
 * Pass `mode: "intersect"` for classic "touch to select" behaviour on
 * everything.
 */

import { arrayToMap } from "@excalidraw/common";
import {
  doBoundsIntersect,
  getCommonBounds,
  getElementBounds,
  getElementLineSegments,
  isImageElement,
} from "@excalidraw/element";
import { getLassoSelectedElementIds } from "@excalidraw/excalidraw/lasso/utils";
import {
  pointFrom,
  polygonFromPoints,
  polygonIncludesPointNonZero,
} from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";
import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { GlobalPoint, LineSegment } from "@excalidraw/math/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A point in SCENE coordinates. */
export interface ScenePoint {
  x: number;
  y: number;
}

/**
 * A freehand lasso path in SCENE coordinates.
 *
 * Always treated as a closed ring: the last point is implicitly joined back
 * to the first. {@link closeLassoPath} makes that join explicit when you need
 * the literal polygon (e.g. for drawing or masking).
 */
export type LassoPath = readonly ScenePoint[];

/** Axis-aligned scene-space rectangle. */
export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LassoContainmentMode = "contain" | "intersect";

export interface LassoSelectionOptions {
  /**
   * `"contain"` — an element is selected only when it lies entirely inside
   * the lasso. `"intersect"` — touching is enough.
   *
   * @default "contain"
   */
  mode?: LassoContainmentMode;
  /**
   * Include image elements that merely *overlap* the lasso, even in
   * `"contain"` mode. See the module docblock for the rationale.
   *
   * Ignored in `"intersect"` mode (where overlap already selects).
   *
   * @default true
   */
  includeOverlappingImages?: boolean;
  /**
   * Douglas–Peucker tolerance, in scene units, applied before hit-testing.
   * Keeps a 2000-point freehand path from costing 2000 segment tests per
   * element. Pass `0` to disable.
   *
   * @default 2
   */
  simplifyDistance?: number;
}

export interface LassoSelectionResult {
  /** Selected, non-deleted elements, in scene order. */
  elements: NonDeletedExcalidrawElement[];
  /** Ids of {@link elements}, for convenience. */
  selectedElementIds: string[];
  /** Bounding box of the lasso path itself. `null` for a degenerate path. */
  lassoBounds: SceneRect | null;
  /**
   * Bounding box of the selected elements intersected with the lasso bounds —
   * i.e. the region actually worth rasterizing. `null` when nothing is
   * selected.
   */
  selectionBounds: SceneRect | null;
}

// ---------------------------------------------------------------------------
// Path capture
// ---------------------------------------------------------------------------

/**
 * Minimum distance (scene units) between consecutive recorded points. Drops
 * the pointer-event spam a high-frequency digitizer produces without
 * visibly changing the path.
 */
const DEFAULT_MIN_POINT_DISTANCE = 1;

/**
 * Headless recorder for a freehand path.
 *
 * Feed it SCENE coordinates (convert from pointer coordinates with
 * `viewportCoordsToSceneCoords` from `@excalidraw/common`). It is deliberately
 * dumb: no rendering, no editor state, no React.
 *
 * ```ts
 * const rec = createLassoRecorder();
 * rec.start({ x, y });
 * rec.add({ x, y });          // on every pointermove
 * const path = rec.finish();  // on pointerup
 * ```
 */
export interface LassoRecorder {
  start: (point: ScenePoint) => void;
  /** @returns `true` when the point was kept (i.e. the path changed). */
  add: (point: ScenePoint) => boolean;
  /** Current path, live (do not mutate). */
  getPath: () => LassoPath;
  isRecording: () => boolean;
  /** Stops recording and returns the final path. */
  finish: () => LassoPath;
  reset: () => void;
}

export const createLassoRecorder = (
  { minPointDistance = DEFAULT_MIN_POINT_DISTANCE } = {} as {
    minPointDistance?: number;
  },
): LassoRecorder => {
  let points: ScenePoint[] = [];
  let recording = false;

  return {
    start: (point) => {
      points = [{ x: point.x, y: point.y }];
      recording = true;
    },
    add: (point) => {
      if (!recording) {
        return false;
      }
      const last = points[points.length - 1];
      if (
        last &&
        Math.hypot(point.x - last.x, point.y - last.y) < minPointDistance
      ) {
        return false;
      }
      points.push({ x: point.x, y: point.y });
      return true;
    },
    getPath: () => points,
    isRecording: () => recording,
    finish: () => {
      recording = false;
      return points;
    },
    reset: () => {
      points = [];
      recording = false;
    },
  };
};

// ---------------------------------------------------------------------------
// Path geometry
// ---------------------------------------------------------------------------

/**
 * Explicitly closes the ring by repeating the first point at the end, unless
 * it is already (near enough) closed. Paths shorter than 3 points are
 * returned untouched — they enclose no area.
 */
export const closeLassoPath = (path: LassoPath): LassoPath => {
  if (path.length < 3) {
    return path;
  }
  const first = path[0];
  const last = path[path.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
    return path;
  }
  return [...path, { x: first.x, y: first.y }];
};

/** Bounding box of a path, or `null` when it has no points. */
export const getLassoBounds = (path: LassoPath): SceneRect | null => {
  if (path.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of path) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Shoelace area of the closed path, in scene units². Used to reject
 * accidental taps and hairline scribbles that enclose nothing.
 */
export const getLassoArea = (path: LassoPath): number => {
  if (path.length < 3) {
    return 0;
  }
  let twiceArea = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    twiceArea += (path[j].x + path[i].x) * (path[j].y - path[i].y);
  }
  return Math.abs(twiceArea) / 2;
};

/**
 * A path is usable as a selection region once it encloses a non-trivial
 * area. `minArea` is in scene units²; the overlay scales it by zoom so the
 * threshold feels the same at any magnification.
 */
export const isUsableLassoPath = (path: LassoPath, minArea = 16): boolean =>
  path.length >= 3 && getLassoArea(path) >= minArea;

/**
 * Point-in-polygon against the lasso, using the non-zero winding rule
 * (`@excalidraw/math`'s `polygonIncludesPointNonZero`) so a self-crossing
 * freehand loop — which hand-drawn lassos constantly are — still reads as
 * "inside" rather than punching holes in itself.
 */
export const lassoContainsPoint = (
  path: LassoPath,
  point: ScenePoint,
): boolean => {
  if (path.length < 3) {
    return false;
  }
  return polygonIncludesPointNonZero(
    pointFrom<GlobalPoint>(point.x, point.y),
    toPolygon(path),
  );
};

const toPolygon = (path: LassoPath) =>
  polygonFromPoints(
    path.map((p) => pointFrom<GlobalPoint>(p.x, p.y)) as GlobalPoint[],
  );

const toGlobalPoints = (path: LassoPath): GlobalPoint[] =>
  path.map((p) => pointFrom<GlobalPoint>(p.x, p.y));

const boundsToRect = ([minX, minY, maxX, maxY]: Bounds): SceneRect => ({
  x: minX,
  y: minY,
  width: maxX - minX,
  height: maxY - minY,
});

const rectToBounds = (rect: SceneRect): Bounds => [
  rect.x,
  rect.y,
  rect.x + rect.width,
  rect.y + rect.height,
];

const intersectRects = (a: SceneRect, b: SceneRect): SceneRect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
};

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Does the lasso overlap this element's (axis-aligned) bounds at all?
 *
 * Cheap two-sided test:
 *   a) any lasso vertex inside the element's bounds — covers "lasso drawn on
 *      top of a big image"
 *   b) any bounds corner inside the lasso — covers "lasso swallows a small
 *      image"
 *
 * KNOWN GAP: a lasso that slices straight across an element without placing
 * any vertex inside it AND without enclosing a corner reads as "no overlap".
 * With a hand-drawn path sampled every pixel that is essentially
 * unreachable, and it is only ever used to *widen* the selection, so the
 * failure mode is a missing image, never a spurious one.
 */
const lassoOverlapsBounds = (
  path: LassoPath,
  globalPath: GlobalPoint[],
  bounds: Bounds,
): boolean => {
  const [minX, minY, maxX, maxY] = bounds;

  for (const p of path) {
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
      return true;
    }
  }

  const polygon = polygonFromPoints(globalPath);
  const corners: GlobalPoint[] = [
    pointFrom<GlobalPoint>(minX, minY),
    pointFrom<GlobalPoint>(maxX, minY),
    pointFrom<GlobalPoint>(maxX, maxY),
    pointFrom<GlobalPoint>(minX, maxY),
  ];

  return corners.some((corner) => polygonIncludesPointNonZero(corner, polygon));
};

/**
 * Selects the scene elements captured by a lasso path.
 *
 * Delegates the core decision to the editor's own
 * `getLassoSelectedElementIds`, then applies the image-overlap rule on top.
 *
 * @param path    lasso in scene coordinates (need not be explicitly closed)
 * @param elements the scene's elements (deleted ones are filtered out here)
 */
export const selectElementsWithLasso = (
  path: LassoPath,
  elements: readonly ExcalidrawElement[],
  options: LassoSelectionOptions = {},
): LassoSelectionResult => {
  const {
    mode = "contain",
    includeOverlappingImages = true,
    simplifyDistance = 2,
  } = options;

  const lassoBounds = getLassoBounds(path);

  const empty: LassoSelectionResult = {
    elements: [],
    selectedElementIds: [],
    lassoBounds,
    selectionBounds: null,
  };

  if (!isUsableLassoPath(path)) {
    return empty;
  }

  const candidates = elements.filter(
    (element): element is NonDeletedExcalidrawElement =>
      !element.isDeleted &&
      // frames would swallow the whole page; the user wants its contents
      element.type !== "frame" &&
      element.type !== "magicframe",
  );

  if (candidates.length === 0) {
    return empty;
  }

  const elementsMap = arrayToMap(candidates) as ElementsMap;
  const elementsSegments = new Map<string, LineSegment<GlobalPoint>[]>();
  for (const element of candidates) {
    elementsSegments.set(
      element.id,
      getElementLineSegments(element, elementsMap),
    );
  }

  const globalPath = toGlobalPoints(closeLassoPath(path));

  const { selectedElementIds } = getLassoSelectedElementIds({
    lassoPath: globalPath,
    elements: candidates,
    elementsMap,
    elementsSegments,
    intersectedElements: new Set<string>(),
    enclosedElements: new Set<string>(),
    simplifyDistance: simplifyDistance || undefined,
    // the editor calls the touch-to-select mode "overlap"
    mode: mode === "intersect" ? "overlap" : "contain",
  });

  const selected = new Set(selectedElementIds);

  if (mode === "contain" && includeOverlappingImages && lassoBounds) {
    const lassoAabb = rectToBounds(lassoBounds);
    for (const element of candidates) {
      if (selected.has(element.id) || !isImageElement(element)) {
        continue;
      }
      const bounds = getElementBounds(element, elementsMap);
      if (
        doBoundsIntersect(lassoAabb, bounds) &&
        lassoOverlapsBounds(path, globalPath, bounds)
      ) {
        selected.add(element.id);
      }
    }
  }

  const resultElements = candidates.filter((element) =>
    selected.has(element.id),
  );

  if (resultElements.length === 0) {
    return empty;
  }

  const elementsRect = boundsToRect(
    getCommonBounds(resultElements, elementsMap),
  );

  // Only the part of the content that falls inside the lasso can survive the
  // raster mask, so that is the region worth exporting.
  const selectionBounds = lassoBounds
    ? intersectRects(elementsRect, lassoBounds)
    : elementsRect;

  return {
    elements: resultElements,
    selectedElementIds: resultElements.map((element) => element.id),
    lassoBounds,
    selectionBounds,
  };
};
