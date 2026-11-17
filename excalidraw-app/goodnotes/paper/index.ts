/**
 * GoodNotes paper templates — public API.
 *
 * Draws ruled / grid / dotted / Cornell / staff page backgrounds behind the
 * Excalidraw canvas. Nothing here mutates the Excalidraw scene; the layer is
 * presentational only and never intercepts pointer input.
 *
 * Quick start (see ./INTEGRATION.md for the exact App.tsx diff):
 *
 *   <PaperBackgroundLayer
 *     elements={elements}
 *     scrollX={appState.scrollX}
 *     scrollY={appState.scrollY}
 *     zoom={appState.zoom.value}
 *     theme={appState.theme}
 *     defaultTemplate={template}
 *   />
 */

export {
  /** React layer that paints every page's paper behind Excalidraw. */
  PaperBackgroundLayer,
  /** Derive page rects from frames whose name starts with PAGE_FRAME_PREFIX. */
  getPaperPageRects,
} from "./PaperBackgroundLayer";
export type {
  PaperBackgroundLayerProps,
  PaperPageRect,
} from "./PaperBackgroundLayer";

export {
  /** Accessible radiogroup for choosing a template, with live previews. */
  PaperPicker,
  /** A single mini-preview swatch, drawn from the real template functions. */
  PaperPreview,
} from "./PaperPicker";
export type {
  PaperPickerProps,
  PaperPickerOption,
  PaperPreviewProps,
} from "./PaperPicker";

export {
  /** All templates keyed by id. */
  PAPER_TEMPLATES,
  /** Templates in display order. */
  PAPER_TEMPLATE_LIST,
  /** Template ids in display order. */
  PAPER_TEMPLATE_ORDER,
  /** Lookup by id, falling back to `blank`. */
  getPaperTemplate,
  /** Theme-aware palette (paper, rule, accent, border). */
  getPaperPalette,
  /** Draw sheet + (image) + rulings + border into an already-placed ctx. */
  renderPaper,
  /** Zoom → ruling opacity (Quickdraw-style fade). */
  rulingOpacityForZoom,
  /** `renderPaper` that reads ruling AND image background off a page frame. */
  renderPaperForFrame,
  /** Geometry constants, exported for callers that need to align to them. */
  LINE_SPACING,
  GRID_SPACING,
  DOT_SPACING,
  DOT_RADIUS,
  PAGE_PADDING,
} from "./templates";
export type { PaperTheme, RenderPaperOptions } from "./templates";

// ---------------------------------------------------------------------------
// image-backed pages
// ---------------------------------------------------------------------------

export {
  /** `customData` key holding a page's image background. */
  PAGE_IMAGE_CUSTOM_DATA_KEY,
  /** Read a frame's image background, if it has one. */
  getPageImageBackground,
  /** Pure helper: `customData` with the image background set / removed. */
  withPageImageBackground,
  /** Every image background referenced by a scene, de-duplicated. */
  collectPageImageBackgrounds,
  /** Fire-and-forget decode of every page image a scene references. */
  syncPageImageCache,
  /** Await every page image — call before a synchronous render. */
  preloadPageImages,
  /** Decode one data URL into the shared cache (coalesced, idempotent). */
  decodePageImage,
  /** Synchronous cache lookup used by `renderPaper`. */
  getDecodedPageImage,
  /** True when a decode has already been attempted and failed. */
  isPageImageBroken,
  /** Subscribe to "a page image finished decoding" (repaint hook). */
  onPageImageReady,
  /** Draw a page image into an already-placed ctx (sync; placeholder-safe). */
  drawPageImageBackground,
  /** Cache eviction / test seams. */
  forgetPageImage,
  clearPageImageCache,
} from "./pageImages";
export type { PageImageBackground, PageImageFit } from "./pageImages";
