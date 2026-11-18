/**
 * `goodnotes/surface` — what the document is made of, and which way up a
 * sheet is.
 *
 * Two features, one module, because they are the same question asked twice:
 * "is this thing paper, and if so, what shape of paper?".
 *
 * **Whiteboard mode** is a PER-DOCUMENT property, not a third `ViewMode`: a
 * whiteboard is a kind of document, not a way of looking at one. Turning it
 * on hides the page frames (`appState.frameRendering` off), gives the paper
 * layer an empty page list and pins the viewport to continuous — and writes
 * NOTHING to the scene, so a 40-page lecture survives the round trip
 * byte-identical.
 *
 * **Rotate sheet** swaps one page frame's width and height, re-stacks the
 * column below it (`goodnotes/pages`' `restackPages`), and never clips ink:
 * content that would fall outside is nudged in, and scaled down uniformly
 * only if it cannot fit. One `updateScene`, one Ctrl+Z.
 *
 * ```tsx
 * const surface = useSurface(excalidrawAPI);
 * <PaperBackgroundLayer … pages={surface.paperPages} />
 * <SurfaceControls {...surface.controlsProps} />
 * // or drive it yourself:
 * <button onClick={() => surface.rotate()}>Rotate sheet</button>
 * ```
 *
 * See `INTEGRATION.md` for copy-pasteable `App.tsx` changes.
 */

/** React entry point: surface mode + rotate, bound to a live editor. */
export { useSurface } from "./useSurface";
export type { UseSurfaceOptions, UseSurfaceResult } from "./useSurface";

/** The buttons + the `aria-live` region. Optional; the hook is headless. */
export { SurfaceControls } from "./SurfaceControls";
export type { SurfaceControlsProps } from "./SurfaceControls";

/** The per-document surface mode, persisted. Readable without React. */
export {
  DEFAULT_SURFACE_MODE,
  SURFACE_MODE_STORAGE_PREFIX,
  TRANSIENT_DOC_KEY,
  getCurrentDocId,
  hydrateSurfaceModeFromDoc,
  loadSurfaceMode,
  saveSurfaceMode,
  subscribeSurfaceMode,
  surfaceModeStorageKey,
} from "./surfaceMode";
export type { SurfaceMode } from "./surfaceMode";

/** Whiteboard mode, headless. */
export {
  PAPER_FRAME_RENDERING,
  WHITEBOARD_FRAME_RENDERING,
  WHITEBOARD_EXPORT_PADDING,
  WHITEBOARD_EXPORT_FRAME_NAME,
  applySurfaceMode,
  frameRenderingFor,
  getWhiteboardBounds,
  getWhiteboardContent,
  /** Scene the existing PDF/PNG exporters can take for a whiteboard. */
  getWhiteboardExportScene,
  paperPagesFor,
} from "./whiteboard";
export type { Rect } from "./whiteboard";

/** Rotate sheet: pure element maths, and the live-editor action. */
export {
  getCurrentSheetIndex,
  rotateAllSheetsElements,
  rotateSheet,
  rotateSheetElements,
  rotateSheetsElements,
} from "./rotateSheet";
export type { RotateSheetOptions, RotateSheetResult } from "./rotateSheet";
