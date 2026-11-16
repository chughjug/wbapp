/**
 * `goodnotes/paged` — one page at a time, filling the workspace.
 *
 * THE PROBLEM THIS SOLVES: pages live in the scene as frames stacked
 * vertically with `PAGE_GAP` between them (see `goodnotes/pages`), which made
 * the editor read like a PDF scroll — you could drift between two pages and
 * never be on one. The scene model is *not* changed here (the paper layer,
 * PDF export, thumbnails and PDF import all derive their geometry from that
 * stacking). What changes is the VIEW:
 *
 *  - the viewport is locked to exactly one page, zoomed so the page fills the
 *    real canvas box (the editor's own box: the left page panel and the top
 *    bands are outside it, and overlaid editor UI is measured, not guessed);
 *  - panning and scrolling cannot reach the neighbouring page while fitted;
 *  - once the user zooms in past the fit, panning *within* the page is free;
 *  - changing page animates and re-fits;
 *  - every route changes the page: the two-finger flick, the arrow keys /
 *    PageUp / PageDown / Home / End, the page panel, the shell's bar, and any
 *    host code calling `goToPage` / `next` / `prev`.
 *
 * THERE IS NO LONGER A PERMANENT PAGE BAR. {@link PagedViewControls} renders
 * only the `aria-live` region by default (pass `controls` for the old visible
 * strip), and the paged/continuous switch lives in Settings → View mode.
 *
 * HOW THE CLAMP IS ENFORCED: not by correcting the viewport from `onChange`,
 * but by this fork's native scroll lock —
 * `setViewport({ lock: { scroll, zoom } })` installs
 * `appState.scrollConstraints`, which the editor applies inside its own
 * `translate()` for every wheel, drag, pinch and zoom-pill change. `onChange`
 * is only a debounced watchdog that re-installs the lock when some other
 * navigation replaces it (and adopts the page that navigation landed on).
 * See `controller.ts` for the full argument, including the loop-breaker.
 *
 * ```tsx
 * const paged = usePagedView(excalidrawAPI);
 * // page changes, announced — no visible bar unless you ask for one
 * <PagedViewControls {...paged.controlsProps} />
 * // the shell's bar / the page overlay drive the same controller:
 * <button onClick={() => paged.next()}>Next page</button>
 * ```
 *
 * See `INTEGRATION.md` for copy-pasteable `App.tsx` changes.
 */

/** React entry point. Attaches the controller to a live editor. */
export { usePagedView } from "./usePagedView";
export type { UsePagedViewOptions, UsePagedViewResult } from "./usePagedView";

/** Framework-free entry point (same behaviour, no React). */
export { attachPagedView } from "./controller";
export type {
  AttachPagedViewOptions,
  GoToPageOptions,
  PageChangeCause,
  PagedViewController,
  PagedViewState,
} from "./controller";

/**
 * The controller currently attached, when paged mode is on — how
 * `goodnotes/input`'s page flick turns a page instead of free-scrolling.
 * `getAttachedPagedView` returns it regardless of mode.
 */
export { getActivePagedView, getAttachedPagedView } from "./controller";

/** Watchdog tunables (documented in `controller.ts`). */
export {
  SETTLE_MS,
  MAX_CORRECTION_BURST,
  CORRECTION_WINDOW_MS,
  CORRECTION_BACKOFF_MS,
} from "./controller";

/**
 * The `aria-live` region that announces page changes (and, behind the opt-in
 * `controls` prop, the old visible prev / page / next strip).
 */
export { PagedViewControls } from "./PagedViewControls";
export type { PagedViewControlsProps } from "./PagedViewControls";

/** The paged/continuous switch, persisted. Readable without React. */
export {
  DEFAULT_VIEW_MODE,
  VIEW_MODE_STORAGE_KEY,
  loadViewMode,
  saveViewMode,
  subscribeViewMode,
  resetViewModeCache,
} from "./mode";

/**
 * The override a non-paper document installs (see `goodnotes/surface`): the
 * controller follows `getEffectiveViewMode()`, while Settings keeps reading
 * and writing the stored preference above.
 */
export {
  getEffectiveViewMode,
  getViewModeOverride,
  setViewModeOverride,
  subscribeEffectiveViewMode,
} from "./mode";
export type { ViewMode } from "./mode";

/**
 * The fit maths and the clamp, as pure functions — exported so they can be
 * asserted against, and reused by a host that wants to place its own UI.
 */
export {
  PAGED_VIEW_PADDING,
  PAGED_VIEW_GAP_CLEARANCE,
  PAGED_VIEW_OVERSCROLL_PX,
  PAGED_VIEW_TRANSITION_MS,
  EMPTY_INSETS,
  addInsets,
  clampViewport,
  computeFit,
  getCentredScroll,
  getFitZoom,
  getPageRect,
  getPageScreenRect,
  getUsableBox,
  getVisibleSceneRect,
  isViewportInsidePage,
  isZoomedIn,
  normaliseZoom,
  prefersReducedMotion,
  resolveInsets,
} from "./pagedView";
export type { CanvasBox, Insets, Rect, Viewport } from "./pagedView";
