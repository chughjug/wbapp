/**
 * The paged-view controller: locks the viewport to exactly one page.
 *
 * FRAMEWORK-FREE ON PURPOSE (`usePagedView` is a thin wrapper), so the page
 * flick recogniser in `goodnotes/input` and a bare test harness can drive it
 * without React.
 *
 * ── How the clamp works, and why it does not fight the user ────────────────
 * This fork's `excalidrawAPI.setViewport({ lock })` installs
 * `appState.scrollConstraints`, and the editor applies those constraints
 * itself inside `AppViewport.translate()` — the single funnel every user-
 * driven viewport change goes through (wheel, trackpad pan, space-drag,
 * pinch, the zoom pill, arrow-key scroll, minimap drag). So the clamp is
 * enforced *inside* the editor, synchronously, at the source:
 *
 *   - `lock.scroll` keeps the visible scene rect inside the page box (plus
 *     the inset margin). While the page is fitted the box is smaller than
 *     the viewport, so the page simply rests dead centre and cannot drift;
 *     once the user zooms in, the box is larger than the viewport and free
 *     panning *within the page* is exactly what the same clamp produces.
 *   - `lock.zoom` makes the fit zoom the minimum zoom, so no amount of
 *     zooming out can bring a neighbouring page into view.
 *   - `overscroll: PAGED_VIEW_OVERSCROLL_PX` gives a small, bounded
 *     rubberband past the clamp, which the editor springs back itself when
 *     the gesture ends. It is deliberately NOT slack: the resting viewport is
 *     still exactly the clamp. It exists because a rigid clamp made every
 *     navigation gesture a dead control at fit zoom — see the constant's
 *     docs for the measurement that forced the change.
 *
 * That is deliberately NOT a `onChange` → `updateScene` correction loop: we
 * never write the viewport in response to an ordinary pan or zoom, so there
 * is nothing to oscillate.
 *
 * `onChange` is used only as a *watchdog*, for the paths that bypass the
 * lock by replacing it — any other `setViewport` call clears
 * `scrollConstraints` (`getConstrainedTargetViewport` returns
 * `scrollConstraints: null` when no lock is requested). The page panel's
 * `scrollToPage`, "zoom to fit" and a host's `setViewport` all do this. The
 * watchdog:
 *
 *   1. is debounced until the viewport has been quiet for
 *      {@link SETTLE_MS} and no pointer is down, so it can never interrupt a
 *      gesture or an in-flight animation (every animation frame re-arms it);
 *   2. re-installs the lock only when the installed constraints differ from
 *      the ones the current page wants (box, insets, lock flags) — after our
 *      own re-install the comparison matches, so the second pass is a no-op.
 *      That is the loop-breaker;
 *   3. additionally carries a circuit breaker ({@link MAX_CORRECTION_BURST}):
 *      if the comparison somehow never settles, it backs off instead of
 *      hammering the editor.
 *
 * When the lock has been cleared by someone navigating elsewhere, the
 * watchdog *adopts* the page they landed on rather than yanking the view
 * back — which is how the page panel, page-number control and any host-level
 * navigation keep working without knowing paged mode exists.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  getPageIndexAtSceneY,
  getPages,
  isPageFrame,
  scrollToPage,
} from "../pages";

import { createPageMatte } from "./matte";
import {
  getEffectiveViewMode,
  saveViewMode,
  subscribeEffectiveViewMode,
  type ViewMode,
} from "./mode";
import {
  EMPTY_INSETS,
  PAGED_VIEW_OVERSCROLL_PX,
  PAGED_VIEW_PADDING,
  PAGED_VIEW_TRANSITION_MS,
  clampViewport,
  getPageRect,
  getPageScreenRect,
  getVisibleSceneRect,
  prefersReducedMotion,
  resolveInsets,
  type CanvasBox,
  type Insets,
  type Rect,
} from "./pagedView";

import type { Page } from "../types";

/** How long the viewport must be quiet before the watchdog may act, in ms. */
export const SETTLE_MS = 140;

/** Corrections within {@link CORRECTION_WINDOW_MS} before backing off. */
export const MAX_CORRECTION_BURST = 6;
export const CORRECTION_WINDOW_MS = 1000;
/** How long the watchdog stays out after tripping the circuit breaker. */
export const CORRECTION_BACKOFF_MS = 5000;

/** Why the page changed — handy for announcements and telemetry. */
export type PageChangeCause =
  | "api"
  | "keyboard"
  | "swipe"
  | "adopt"
  | "document"
  | "init";

export interface PagedViewState {
  mode: ViewMode;
  isPaged: boolean;
  /** 0-based index of the page the viewport is locked to; -1 when none. */
  pageIndex: number;
  pageCount: number;
  /** True while the user is zoomed in past the fit zoom (free panning). */
  isZoomedIn: boolean;
}

export interface GoToPageOptions {
  animate?: boolean;
  cause?: PageChangeCause;
}

export interface AttachPagedViewOptions {
  /** Breathing room around the page, in CSS px. @default PAGED_VIEW_PADDING */
  padding?: number;
  /** Install the keyboard shortcuts (arrows, PageUp/Down, Home/End). @default true */
  keyboard?: boolean;
  /**
   * Paint out everything around the current page (see `matte.ts`). Without
   * it, a portrait-ish canvas shows a sliver of the neighbouring page in the
   * slack above/below the fitted page. @default true
   */
  matte?: boolean;
  /** Called whenever {@link PagedViewState} changes. */
  onState?: (state: PagedViewState) => void;
  /** Called when the locked page changes (for `aria-live` announcements). */
  onPageChange?: (index: number, count: number, cause: PageChangeCause) => void;
  /** Resolves the editor container to observe for resizes. Test seam. */
  getContainer?: () => HTMLElement | null;
  /** Test seam. */
  document?: Document;
}

export interface PagedViewController {
  getState: () => PagedViewState;
  isPaged: () => boolean;
  setPaged: (paged: boolean) => void;
  togglePaged: () => void;
  getPageIndex: () => number;
  getPageCount: () => number;
  /** Navigate to a page. Returns false when the index does not exist. */
  goToPage: (index: number, opts?: GoToPageOptions) => boolean;
  next: (opts?: GoToPageOptions) => boolean;
  prev: (opts?: GoToPageOptions) => boolean;
  /** Re-run the fit for the current page (after a resize, say). */
  refit: (opts?: { animate?: boolean }) => void;
  destroy: () => void;
}

const near = (a: number, b: number, tolerance = 0.5) =>
  Math.abs(a - b) <= tolerance;

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

// ---------------------------------------------------------------------------
// the "who is in charge" registry
// ---------------------------------------------------------------------------

let activeController: PagedViewController | null = null;

/**
 * The paged-view controller currently attached to the editor, if any.
 *
 * `goodnotes/input`'s two-finger flick asks for this so that, in paged mode,
 * a swipe turns the *page* (animated, re-fitted, announced) instead of
 * free-scrolling the canvas. Returns `null` in continuous mode or before the
 * editor has mounted.
 */
export const getActivePagedView = (): PagedViewController | null =>
  activeController && activeController.isPaged() ? activeController : null;

/** The attached controller regardless of mode (continuous included). */
export const getAttachedPagedView = (): PagedViewController | null =>
  activeController;

// ---------------------------------------------------------------------------

export const attachPagedView = (
  api: ExcalidrawImperativeAPI,
  options: AttachPagedViewOptions = {},
): PagedViewController => {
  const doc = options.document ?? document;
  const win = doc.defaultView ?? window;
  const padding = options.padding ?? PAGED_VIEW_PADDING;
  const getContainer =
    options.getContainer ??
    // `.excalidraw-container` is the editor's own box — the one
    // `appState.width/height` measures. Several shell surfaces (nav bar, page
    // panel, tab bar) also carry the bare `.excalidraw` class for styling, so
    // querying for that alone would observe the wrong element.
    (() =>
      doc.querySelector<HTMLElement>(".excalidraw-container") ??
      doc.querySelector<HTMLElement>(".excalidraw"));

  const matte =
    options.matte === false ? null : createPageMatte(doc, getContainer);

  let mode: ViewMode = getEffectiveViewMode();
  let destroyed = false;
  /** The frame we are following. Survives reorder; index is derived from it. */
  let currentFrameId: string | null = null;
  let lastIndex = 0;
  let lastCount = 0;
  let lastZoomedIn = false;

  /** What the last `applyLock` asked for — the watchdog's reference. */
  let installed: { rect: Rect; insets: Insets; box: CanvasBox } | null = null;

  let settleTimer: number | undefined;
  let pointerDown = 0;
  let corrections: number[] = [];
  let backoffUntil = 0;
  let warnedAboutBackoff = false;

  // --- reading the editor --------------------------------------------------

  const pagesNow = (): Page[] =>
    api.isDestroyed ? [] : getPages(api.getSceneElements());

  const canvasBox = (): CanvasBox => {
    const appState = api.getAppState();
    return { width: appState.width, height: appState.height };
  };

  const measureUiInsets = (): Insets => {
    try {
      // padding 0: we add our own (and cap it, see `resolveInsets`)
      const offsets = api.getViewportOffsets({ padding: 0 });
      return {
        top: offsets.top ?? 0,
        right: offsets.right ?? 0,
        bottom: offsets.bottom ?? 0,
        left: offsets.left ?? 0,
      };
    } catch {
      return EMPTY_INSETS;
    }
  };

  const insetsFor = (rect: Rect, box: CanvasBox): Insets =>
    resolveInsets(rect, box, measureUiInsets(), padding);

  const indexOfCurrent = (pages: readonly Page[]): number => {
    if (pages.length === 0) {
      return -1;
    }
    if (currentFrameId) {
      const index = pages.findIndex((page) => page.frame.id === currentFrameId);
      if (index !== -1) {
        return index;
      }
    }
    return Math.min(Math.max(lastIndex, 0), pages.length - 1);
  };

  const pageIndexAtViewportCentre = (pages: readonly Page[]): number => {
    const appState = api.getAppState();
    const centreY =
      appState.height / 2 / appState.zoom.value - appState.scrollY;
    return getPageIndexAtSceneY(pages, centreY);
  };

  /**
   * Repaints the matte from the live viewport. Called on EVERY change (not
   * on the watchdog's debounce), because it has to track the page frame by
   * frame while the user pans or a page transition animates. It is a pure
   * DOM write guarded by a signature check, so a no-op costs nothing.
   */
  const updateMatte = () => {
    if (!matte) {
      return;
    }
    if (destroyed || api.isDestroyed || mode !== "paged") {
      matte.hide();
      return;
    }
    // the LOCKED rect, not a fresh `getPages()` scan: this runs on every
    // render (including every frame of a stroke), and `installed.rect` is
    // kept in step with the document by the watchdog
    let rect = installed?.rect ?? null;
    if (!rect) {
      const pages = pagesNow();
      const index = indexOfCurrent(pages);
      if (index === -1) {
        matte.hide();
        return;
      }
      rect = getPageRect(pages[index]);
    }
    const appState = api.getAppState();
    matte.update(
      getPageScreenRect(rect, {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      }),
      appState.viewBackgroundColor,
      appState.theme === "dark" ? "dark" : "light",
    );
  };

  // --- state broadcast -----------------------------------------------------

  const computeZoomedIn = (): boolean => {
    if (!installed) {
      return false;
    }
    const appState = api.getAppState();
    const constraints = appState.scrollConstraints;
    return !!constraints && appState.zoom.value > constraints.zoom + 1e-4;
  };

  const currentIndex = (pages: readonly Page[]): number => {
    if (pages.length === 0) {
      return -1;
    }
    // in continuous mode nothing is locked, so "current" is whatever page the
    // viewport is centred on — same definition the page panel uses
    return mode === "paged"
      ? indexOfCurrent(pages)
      : pageIndexAtViewportCentre(pages);
  };

  const getState = (): PagedViewState => {
    const pages = pagesNow();
    return {
      mode,
      isPaged: mode === "paged",
      pageIndex: currentIndex(pages),
      pageCount: pages.length,
      isZoomedIn: lastZoomedIn,
    };
  };

  const notify = (cause?: PageChangeCause) => {
    const pages = pagesNow();
    const index = currentIndex(pages);
    const zoomedIn = computeZoomedIn();
    const pageChanged = index !== lastIndex;
    const changed =
      pageChanged || pages.length !== lastCount || zoomedIn !== lastZoomedIn;

    lastIndex = index === -1 ? lastIndex : index;
    lastCount = pages.length;
    lastZoomedIn = zoomedIn;

    if (changed) {
      options.onState?.(getState());
    }
    if ((pageChanged || cause === "init") && index !== -1) {
      options.onPageChange?.(index, pages.length, cause ?? "document");
    }
  };

  // --- installing the lock -------------------------------------------------

  const applyLock = (
    index: number,
    opts: {
      animate?: boolean;
      cause?: PageChangeCause;
      /** true when the watchdog (not the user) asked for this. */
      correction?: boolean;
    } = {},
  ): boolean => {
    if (destroyed || api.isDestroyed || mode !== "paged") {
      return false;
    }
    const pages = pagesNow();
    const page = pages[index];
    if (!page) {
      return false;
    }
    const box = canvasBox();
    if (box.width < 2 || box.height < 2) {
      // editor not laid out yet — try again once it is
      schedule();
      return false;
    }

    const rect = getPageRect(page);
    const insets = insetsFor(rect, box);

    currentFrameId = page.frame.id;
    installed = { rect, insets, box };
    if (opts.correction) {
      // only watchdog re-installs feed the circuit breaker; a user flipping
      // through pages quickly is not a feedback loop
      noteCorrection();
    }

    const animate = (opts.animate ?? false) && !prefersReducedMotion();

    api.setViewport({
      target: rect,
      // "contain" (not "scale-down"): the page must FILL the workspace even
      // when that means zooming past 100%.
      fit: "contain",
      // `overscroll` is a bounded rubberband, NOT slack in the clamp: the
      // editor springs it back to the clamp the moment the gesture ends
      // (`AppViewport.releaseOverscroll`). It is what keeps a navigation
      // gesture — wheel, space-drag, HAND TOOL — from being a dead control
      // while the page is fitted. See `PAGED_VIEW_OVERSCROLL_PX`.
      lock: { scroll: true, zoom: true, overscroll: PAGED_VIEW_OVERSCROLL_PX },
      offsets: insets,
      animation: animate ? { duration: PAGED_VIEW_TRANSITION_MS } : false,
    });

    notify(opts.cause);
    updateMatte();
    return true;
  };

  const clearLock = () => {
    installed = null;
    if (!api.isDestroyed) {
      // `setViewport(null)` drops `scrollConstraints` without moving the view
      api.setViewport(null);
    }
  };

  // --- the watchdog --------------------------------------------------------

  const noteCorrection = () => {
    const now = performance.now();
    corrections = corrections.filter(
      (time) => now - time < CORRECTION_WINDOW_MS,
    );
    corrections.push(now);
    if (corrections.length > MAX_CORRECTION_BURST) {
      backoffUntil = now + CORRECTION_BACKOFF_MS;
      corrections = [];
      if (!warnedAboutBackoff) {
        warnedAboutBackoff = true;
        console.warn(
          "[goodnotes/paged] viewport lock was re-installed repeatedly; " +
            "backing off for a moment. Paged mode still works, but something " +
            "else is competing for the viewport.",
        );
      }
    }
  };

  /**
   * Is the lock currently installed in the editor the one this page wants?
   *
   * NOTE it compares the *installed constraints* against freshly computed
   * values — it deliberately says nothing about the canvas box, which is
   * not part of `scrollConstraints`. A resize changes the fit zoom without
   * changing the constraints, so the box is compared separately against
   * `installed.box` (what the box was when we last fitted).
   */
  const lockMatches = (reference: { rect: Rect; insets: Insets }): boolean => {
    const constraints = api.getAppState().scrollConstraints;
    if (!constraints || !constraints.lockScroll || !constraints.lockZoom) {
      return false;
    }
    const offsets = constraints.offsets ?? EMPTY_INSETS;
    return (
      near(constraints.x, reference.rect.x) &&
      near(constraints.y, reference.rect.y) &&
      near(constraints.width, reference.rect.width) &&
      near(constraints.height, reference.rect.height) &&
      near(offsets.top ?? 0, reference.insets.top) &&
      near(offsets.right ?? 0, reference.insets.right) &&
      near(offsets.bottom ?? 0, reference.insets.bottom) &&
      near(offsets.left ?? 0, reference.insets.left)
    );
  };

  /** Has the canvas box changed since the last fit (resize, panel toggle)? */
  const boxUnchanged = (box: CanvasBox): boolean =>
    !!installed &&
    near(installed.box.width, box.width) &&
    near(installed.box.height, box.height);

  const reconcile = () => {
    if (destroyed || api.isDestroyed) {
      return;
    }
    if (mode !== "paged") {
      // continuous mode: no lock to maintain, just keep the page number and
      // the state subscribers honest
      notify();
      return;
    }
    if (pointerDown > 0) {
      // never correct mid-gesture; come back when the finger lifts
      schedule();
      return;
    }
    if (performance.now() < backoffUntil) {
      return;
    }

    const pages = pagesNow();
    if (pages.length === 0) {
      currentFrameId = null;
      installed = null;
      notify();
      return;
    }

    const box = canvasBox();
    if (box.width < 2 || box.height < 2) {
      return;
    }

    let index = indexOfCurrent(pages);
    const rect = getPageRect(pages[index]);
    const insets = insetsFor(rect, box);
    const reference = { rect, insets };

    if (lockMatches(reference) && boxUnchanged(box)) {
      // the lock in place is exactly the one this page wants: nothing to do.
      // THIS is the loop-breaker — the common case costs no state write.
      notify();
      return;
    }

    const hadNoLock = !api.getAppState().scrollConstraints;
    const sameGeometry =
      !!installed &&
      near(installed.rect.x, rect.x) &&
      near(installed.rect.y, rect.y) &&
      near(installed.rect.width, rect.width) &&
      near(installed.rect.height, rect.height) &&
      boxUnchanged(box);

    if (hadNoLock && sameGeometry) {
      // somebody else navigated (page panel, zoom-to-fit, a host
      // `setViewport`): follow them to whichever page they landed on instead
      // of dragging the view back
      const adopted = pageIndexAtViewportCentre(pages);
      if (adopted !== -1 && adopted !== index) {
        index = adopted;
        applyLock(index, {
          animate: false,
          cause: "adopt",
          correction: true,
        });
        return;
      }
    }

    applyLock(index, { animate: false, correction: true });
  };

  const schedule = () => {
    if (destroyed) {
      return;
    }
    win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(reconcile, SETTLE_MS);
  };

  // --- public navigation ---------------------------------------------------

  const goToPage = (index: number, opts: GoToPageOptions = {}): boolean => {
    if (api.isDestroyed) {
      return false;
    }
    const pages = pagesNow();
    if (index < 0 || index >= pages.length) {
      return false;
    }
    if (mode !== "paged") {
      // continuous mode: plain scroll, so the public API navigates either way
      currentFrameId = pages[index].frame.id;
      lastIndex = index;
      const moved = scrollToPage(api, index, {
        animate: opts.animate ?? true,
      });
      if (moved) {
        options.onPageChange?.(index, pages.length, opts.cause ?? "api");
        options.onState?.(getState());
      }
      return moved;
    }
    return applyLock(index, {
      animate: opts.animate ?? true,
      cause: opts.cause ?? "api",
    });
  };

  const step = (delta: number, opts: GoToPageOptions = {}): boolean => {
    const pages = pagesNow();
    const index = indexOfCurrent(pages);
    if (index === -1) {
      return false;
    }
    return goToPage(index + delta, opts);
  };

  // --- mode ----------------------------------------------------------------

  const applyMode = (next: ViewMode, { persist }: { persist: boolean }) => {
    if (persist) {
      // record the user's preference first; the effective mode may still be
      // pinned to "continuous" by a whiteboard document's override
      saveViewMode(next);
    }
    const effective = getEffectiveViewMode();
    if (mode === effective) {
      return;
    }
    mode = effective;
    if (mode === "paged") {
      const pages = pagesNow();
      const centred =
        pages.length === 0 ? -1 : pageIndexAtViewportCentre(pages);
      const index = centred !== -1 ? centred : indexOfCurrent(pages);
      if (index !== -1) {
        applyLock(index, { animate: false, cause: "init" });
      }
    } else {
      clearLock();
    }
    updateMatte();
    options.onState?.(getState());
  };

  const unsubscribeMode = subscribeEffectiveViewMode((next) =>
    applyMode(next, { persist: false }),
  );

  // --- listeners -----------------------------------------------------------

  const onChange = () => {
    updateMatte();
    schedule();
  };

  const unsubscribeChange = api.onChange(onChange);

  const onPointerDown = () => {
    pointerDown++;
  };
  const onPointerUp = () => {
    pointerDown = Math.max(0, pointerDown - 1);
    if (pointerDown === 0) {
      schedule();
    }
  };
  const onBlur = () => {
    pointerDown = 0;
  };

  const pointerOpts = { capture: true, passive: true } as const;
  doc.addEventListener("pointerdown", onPointerDown, pointerOpts);
  doc.addEventListener("pointerup", onPointerUp, pointerOpts);
  doc.addEventListener("pointercancel", onPointerUp, pointerOpts);
  win.addEventListener("blur", onBlur);

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      destroyed ||
      mode !== "paged" ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    // only when the canvas (or the editor shell) has focus
    const target = event.target;
    const insideEditor =
      target === doc.body ||
      (target instanceof Element && !!target.closest(".excalidraw"));
    if (!insideEditor) {
      return;
    }
    // …but a popup or dialog on top owns the keyboard, even though it is
    // inside the editor by DOM. The "+" popover is portalled onto
    // `.excalidraw` (so it inherits the editor's theme tokens), which
    // satisfies the check above; without this, page navigation ate Home and
    // End there and the menu's own jump-to-first/last did nothing. Same
    // rule the lasso overlay follows.
    if (
      target instanceof Element &&
      target.closest('[role="menu"], [role="dialog"]')
    ) {
      return;
    }
    const appState = api.getAppState();
    if (appState.editingTextElement || appState.openDialog) {
      return;
    }

    const pages = pagesNow();
    if (pages.length === 0) {
      return;
    }

    // Arrow keys nudge the selection in the editor, so we yield to a real
    // selection. A selected PAGE FRAME is the exception: nudging one would
    // shove a page out of the column (and the restack pass would fight it),
    // so "turn the page" wins there.
    const selectedIds = Object.keys(appState.selectedElementIds);
    const elements = api.getSceneElements();
    const hasSelection =
      selectedIds.length > 0 &&
      !selectedIds.every((id) => {
        const element = elements.find((candidate) => candidate.id === id);
        return !!element && isPageFrame(element);
      });

    let delta: number | null = null;
    let absolute: number | null = null;

    switch (event.key) {
      case "PageDown":
        delta = 1;
        break;
      case "PageUp":
        delta = -1;
        break;
      case "Home":
        absolute = 0;
        break;
      case "End":
        absolute = pages.length - 1;
        break;
      case "ArrowRight":
      case "ArrowDown":
        // arrows nudge the selection in the editor: only claim them when
        // there is nothing selected to nudge
        if (hasSelection) {
          return;
        }
        delta = 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        if (hasSelection) {
          return;
        }
        delta = -1;
        break;
      default:
        return;
    }

    const moved =
      absolute !== null
        ? goToPage(absolute, { cause: "keyboard" })
        : step(delta ?? 0, { cause: "keyboard" });

    if (moved) {
      // CAPTURE PHASE + stopPropagation, deliberately: the editor's own
      // document-level handler scrolls the canvas with the arrow keys (and
      // would run first, mark the event handled and leave us looking at a
      // `defaultPrevented` event). Claiming the key here keeps "arrow =
      // turn the page" true in paged mode, and only for the keys and
      // conditions checked above — everything else passes straight through.
      event.preventDefault();
      event.stopPropagation();
    }
  };

  if (options.keyboard !== false) {
    doc.addEventListener("keydown", onKeyDown, true);
  }

  // resize: the fit depends on the canvas box, so re-fit when it changes
  const onResize = () => {
    updateMatte();
    schedule();
  };
  win.addEventListener("resize", onResize);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    const container = getContainer();
    if (container) {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);
    }
  }

  // --- boot ----------------------------------------------------------------

  const boot = () => {
    if (destroyed || mode !== "paged") {
      return;
    }
    const pages = pagesNow();
    if (pages.length === 0) {
      schedule();
      return;
    }
    const index = pageIndexAtViewportCentre(pages);
    applyLock(index === -1 ? 0 : index, { animate: false, cause: "init" });
  };

  // after the first layout pass, so `appState.width/height` and the UI
  // offsets are real measurements rather than zeros
  const bootTimer = win.setTimeout(boot, 0);

  const controller: PagedViewController = {
    getState,
    isPaged: () => mode === "paged",
    setPaged: (paged) =>
      applyMode(paged ? "paged" : "continuous", { persist: true }),
    togglePaged: () =>
      applyMode(mode === "paged" ? "continuous" : "paged", { persist: true }),
    getPageIndex: () => indexOfCurrent(pagesNow()),
    getPageCount: () => pagesNow().length,
    goToPage,
    next: (opts) => step(1, opts),
    prev: (opts) => step(-1, opts),
    refit: (opts) => {
      const pages = pagesNow();
      const index = indexOfCurrent(pages);
      if (index !== -1) {
        applyLock(index, { animate: opts?.animate ?? false });
      }
    },
    destroy: () => {
      destroyed = true;
      const scope = win as unknown as Record<string, unknown>;
      if (
        (scope.__goodnotesPagedView as { controller?: unknown } | undefined)
          ?.controller === controller
      ) {
        delete scope.__goodnotesPagedView;
      }
      win.clearTimeout(settleTimer);
      win.clearTimeout(bootTimer);
      unsubscribeChange();
      unsubscribeMode();
      doc.removeEventListener("pointerdown", onPointerDown, pointerOpts);
      doc.removeEventListener("pointerup", onPointerUp, pointerOpts);
      doc.removeEventListener("pointercancel", onPointerUp, pointerOpts);
      doc.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      matte?.destroy();
      if (activeController === controller) {
        activeController = null;
      }
    },
  };

  activeController = controller;

  /**
   * Debug handle, deliberately tiny: paged mode's whole correctness argument
   * is "the watchdog settles", and this is how a harness (or a bug report)
   * can see that it did. Read-only.
   */
  (win as unknown as Record<string, unknown>).__goodnotesPagedView = {
    getState,
    getInstalled: () => installed,
    getCorrectionCount: () => corrections.length,
    getVisibleSceneRect: () => {
      const appState = api.getAppState();
      return getVisibleSceneRect(
        {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
        },
        canvasBox(),
      );
    },
    clampViewport,
    controller,
  };

  return controller;
};
