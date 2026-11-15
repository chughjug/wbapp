/**
 * GoodNotes "fuzzy select" — public API.
 *
 * A freehand lasso over the canvas that selects what it loops around —
 * images and ink especially — and lets the user **copy** it to the system
 * clipboard as a PNG or **duplicate** it back into the page as a new image
 * element. Think GoodNotes' lasso plus a marquee-to-clipboard: circle a
 * diagram on an imported worksheet, drop a copy into your notes.
 *
 * ## Quick start
 *
 * Mount the overlay once, next to the editor (see INTEGRATION.md for the
 * exact `App.tsx` change and the layering rules):
 *
 * ```tsx
 * import { FuzzySelectOverlay } from "./goodnotes/fuzzy-select";
 *
 * <FuzzySelectOverlay excalidrawAPI={excalidrawAPI} />
 * ```
 *
 * …then turn it on from anywhere — including a taskbar built by another
 * module, which needs no React wiring, just the callback:
 *
 * ```tsx
 * import {
 *   activateFuzzySelect,
 *   toggleFuzzySelect,
 *   useFuzzySelectActive,
 * } from "./goodnotes/fuzzy-select";
 *
 * const active = useFuzzySelectActive();
 *
 * <button aria-pressed={active} onClick={toggleFuzzySelect}>
 *   Fuzzy select
 * </button>
 * ```
 *
 * The overlay is inert (`pointer-events: none`, no key handlers) whenever
 * the tool is off.
 *
 * ## Headless use
 *
 * The three stages are independent and usable without the component:
 *
 * ```ts
 * const selection = selectElementsWithLasso(path, api.getSceneElements());
 * const raster = await rasterizeLassoSelection({
 *   elements: selection.elements,
 *   files: api.getFiles(),
 *   path,
 *   region: selection.selectionBounds,
 * });
 * await copyPngToClipboard(raster.blob);
 * await duplicateRasterIntoScene({ excalidrawAPI: api, raster });
 * ```
 */

// ---------------------------------------------------------------------------
// Activation — the entry point a taskbar calls
// ---------------------------------------------------------------------------

/**
 * Callback-shaped switches for the app-wide tool. Hand `activateFuzzySelect`
 * (or `toggleFuzzySelect`) straight to a taskbar button's `onClick`.
 */
export {
  activateFuzzySelect,
  deactivateFuzzySelect,
  toggleFuzzySelect,
  isFuzzySelectActive,
} from "./activation";

/** The shared store behind those callbacks, for `subscribe()`-style wiring. */
export { fuzzySelectActivation } from "./activation";

/** Build an independent switch (tests, or a second editor on one page). */
export { createFuzzySelectActivation } from "./activation";

/** React binding: re-renders when the tool turns on/off (`aria-pressed`). */
export { useFuzzySelectActive } from "./activation";

export type { FuzzySelectActivation, FuzzySelectListener } from "./activation";

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * The overlay: marching-ants lasso while dragging, plus a floating
 * Copy / Duplicate / Dismiss toolbar once a selection exists. Mount it once.
 */
export { FuzzySelectOverlay } from "./FuzzySelectOverlay";
export type { FuzzySelectOverlayProps } from "./FuzzySelectOverlay";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Hit-tests a lasso path against scene elements. Delegates to the editor's
 * own `getLassoSelectedElementIds`, then adds the image-overlap rule
 * (an image the lasso merely overlaps is included, because the raster mask
 * crops it anyway — see `lasso.ts` for the full justification).
 */
export { selectElementsWithLasso } from "./lasso";

/** Headless freehand-path recorder (scene coordinates in, path out). */
export { createLassoRecorder } from "./lasso";

/** Path helpers: close the ring, measure it, test a point against it. */
export {
  closeLassoPath,
  getLassoArea,
  getLassoBounds,
  isUsableLassoPath,
  lassoContainsPoint,
} from "./lasso";

export type {
  LassoContainmentMode,
  LassoPath,
  LassoRecorder,
  LassoSelectionOptions,
  LassoSelectionResult,
  ScenePoint,
  SceneRect,
} from "./lasso";

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

/**
 * Renders the lassoed region with Excalidraw's own `exportScene` and masks
 * it to the lasso path, so the PNG is the selected *shape*, not its
 * bounding box. Transparent outside the mask.
 */
export { rasterizeLassoSelection } from "./rasterize";

/** Error carrying a user-facing reason a raster could not be produced. */
export { FuzzySelectRasterError } from "./rasterize";

export { DEFAULT_RASTER_SCALE, clampRasterScale } from "./rasterize";

export type { RasterizeLassoOptions, RasterizedSelection } from "./rasterize";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * Writes the raster to the system clipboard as an `image/png` ClipboardItem.
 * Always throws a {@link ClipboardCopyError} with an actionable message
 * rather than failing silently.
 */
export { copyPngToClipboard } from "./clipboard";

/** Up-front capability check, for disabling/relabelling the Copy button. */
export { canCopyImageToClipboard } from "./clipboard";

/** Fallback when the clipboard is unavailable: download the PNG. */
export { downloadRasterAsPng } from "./clipboard";

export { ClipboardCopyError } from "./clipboard";
export type { ClipboardCopyFailureReason } from "./clipboard";

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/**
 * Inserts the raster into the scene as a new `image` element offset from the
 * original, registering a correctly formed `BinaryFileData` (content-hashed
 * `fileId`, `mimeType`, `dataURL`, `created`/`lastRetrieved`) so the image
 * survives a reload.
 */
export { duplicateRasterIntoScene } from "./duplicate";

/** Builds just the `BinaryFileData` (content-hashed id) for a PNG blob. */
export { createBinaryFileDataFromPng } from "./duplicate";

export {
  DEFAULT_DUPLICATE_OFFSET,
  FuzzySelectDuplicateError,
} from "./duplicate";

export type {
  DuplicateSelectionOptions,
  DuplicateSelectionResult,
} from "./duplicate";
