/**
 * The fit maths behind "one page fills the workspace".
 *
 * FRAMEWORK-FREE AND SIDE-EFFECT-FREE ON PURPOSE: everything here is a pure
 * function of a page rect, the editor's canvas box and the insets taken up by
 * overlaid UI. The controller (`controller.ts`) does the talking to the
 * editor; this file is what makes the numbers testable.
 *
 * ── Why these formulas look the way they do ─────────────────────────────────
 * They are deliberate mirrors of the editor's own viewport maths so that the
 * zoom/scroll we predict is bit-for-bit the one `setViewport` lands on:
 *
 *  - {@link computeFit} mirrors `zoomToFitBounds` + `centerScrollOn`
 *    (`packages/excalidraw/viewport.ts`), including the slightly surprising
 *    way `centerScrollOn` folds the offsets in (`(width - right + left) / 2`).
 *  - {@link clampViewport} mirrors `constrainScrollAxis` /
 *    `constrainScrollState` — the clamp the editor itself applies to every
 *    pan and zoom once `appState.scrollConstraints` is installed.
 *
 * The clamp is duplicated here, not re-used, for two reasons: it lets us
 * assert "the viewport is where it should be" without reaching into the
 * editor's internals, and it gives the controller a fallback for the (rare)
 * code paths that move the viewport without going through the editor's
 * `translate()`.
 */

import { MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";

import { PAGE_GAP, type Page } from "../types";

/** A box in scene coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CSS-pixel insets of the usable area inside the canvas box. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The editor's canvas box, in CSS px (`appState.width` / `.height`). */
export interface CanvasBox {
  width: number;
  height: number;
}

/** The three numbers that fully describe where the viewport is. */
export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * Breathing room between the fitted page and the edge of the usable area,
 * in CSS px. Small on purpose: the page is meant to *fill* the workspace.
 */
export const PAGED_VIEW_PADDING = 16;

/**
 * Hard ceiling on the vertical padding, as a fraction of {@link PAGE_GAP}.
 *
 * Pages are stacked vertically with `PAGE_GAP` scene px between them, so any
 * vertical slack wider than that gap would show a sliver of the neighbouring
 * page — exactly the "PDF scroll" look we are getting rid of. The padding is
 * therefore capped at `PAGE_GAP * this * zoom` CSS px (see
 * {@link resolveInsets}).
 */
export const PAGED_VIEW_GAP_CLEARANCE = 0.85;

/** Page-change transition, in ms (skipped under `prefers-reduced-motion`). */
export const PAGED_VIEW_TRANSITION_MS = 260;

export const EMPTY_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** Mirrors the editor's `getNormalizedZoom`. */
export const normaliseZoom = (zoom: number): number =>
  clampNumber(
    Math.round((zoom + Number.EPSILON) * 1e6) / 1e6,
    MIN_ZOOM,
    MAX_ZOOM,
  );

/** The scene-space box of a page (the backing frame's rect). */
export const getPageRect = (page: Page): Rect => ({
  x: page.frame.x,
  y: page.frame.y,
  width: page.frame.width,
  height: page.frame.height,
});

export const addInsets = (a: Insets, b: Insets): Insets => ({
  top: a.top + b.top,
  right: a.right + b.right,
  bottom: a.bottom + b.bottom,
  left: a.left + b.left,
});

/** Usable area of the canvas box once the insets are taken off. */
export const getUsableBox = (box: CanvasBox, insets: Insets): CanvasBox => ({
  width: Math.max(1, box.width - insets.left - insets.right),
  height: Math.max(1, box.height - insets.top - insets.bottom),
});

/**
 * The zoom at which `rect` exactly fills the usable area — the editor's
 * `fit: "contain"`. Unlike `"scale-down"` it is allowed to go past 100%, so a
 * small page on a big screen still fills the workspace.
 */
export const getFitZoom = (
  rect: Rect,
  box: CanvasBox,
  insets: Insets = EMPTY_INSETS,
): number => {
  const usable = getUsableBox(box, insets);
  return normaliseZoom(
    Math.min(usable.width / rect.width, usable.height / rect.height),
  );
};

/**
 * Scroll that centres `rect` in the usable area at `zoom`.
 * Mirrors `centerScrollOn` in `packages/excalidraw/viewport.ts`.
 */
export const getCentredScroll = (
  rect: Rect,
  box: CanvasBox,
  insets: Insets,
  zoom: number,
): Pick<Viewport, "scrollX" | "scrollY"> => ({
  scrollX:
    (box.width - insets.right + insets.left) / 2 / zoom -
    (rect.x + rect.width / 2),
  scrollY:
    (box.height - insets.bottom + insets.top) / 2 / zoom -
    (rect.y + rect.height / 2),
});

/** Zoom + scroll that make `rect` fill and centre in the usable area. */
export const computeFit = (
  rect: Rect,
  box: CanvasBox,
  insets: Insets = EMPTY_INSETS,
): Viewport => {
  const zoom = getFitZoom(rect, box, insets);
  return { ...getCentredScroll(rect, box, insets, zoom), zoom };
};

/**
 * Final insets for a page: the measured editor-UI insets plus padding, with
 * the *vertical* padding capped so the neighbouring pages stay off-screen
 * (see {@link PAGED_VIEW_GAP_CLEARANCE}).
 *
 * The cap is resolved by a short fixed-point iteration because the padding
 * changes the zoom and the zoom changes the cap. Two rounds are plenty:
 * shrinking the padding only ever raises the zoom, which only ever raises the
 * cap, so the sequence converges upward and monotonically.
 */
export const resolveInsets = (
  rect: Rect,
  box: CanvasBox,
  uiInsets: Insets = EMPTY_INSETS,
  padding: number = PAGED_VIEW_PADDING,
  gap: number = PAGE_GAP,
): Insets => {
  const basePadding = Math.max(0, padding);
  let verticalPadding = basePadding;

  for (let round = 0; round < 3; round++) {
    const insets = addInsets(uiInsets, {
      top: verticalPadding,
      bottom: verticalPadding,
      left: basePadding,
      right: basePadding,
    });
    const zoom = getFitZoom(rect, box, insets);
    const cap = gap * PAGED_VIEW_GAP_CLEARANCE * zoom;
    const next = Math.min(basePadding, Math.max(0, cap));
    if (Math.abs(next - verticalPadding) < 0.5) {
      verticalPadding = next;
      break;
    }
    verticalPadding = next;
  }

  return addInsets(uiInsets, {
    top: verticalPadding,
    bottom: verticalPadding,
    left: basePadding,
    right: basePadding,
  });
};

/**
 * One axis of the clamp. Mirrors `constrainScrollAxis` in
 * `packages/excalidraw/viewport.ts`, including its two regimes:
 *
 *  - the box is *bigger* than what fits on screen (the user has zoomed in):
 *    the viewport may pan freely, but only inside the box (+ the inset
 *    margin, which is what lets you reach the very edge of the page);
 *  - the box is *smaller* (we are at, or below, fit zoom): there is nothing
 *    to pan to, so the box rests dead centre.
 */
const clampAxis = (
  scroll: number,
  boxStart: number,
  boxSize: number,
  visibleSize: number,
  insetStart: number,
  insetEnd: number,
  give: number,
): number => {
  const max = -boxStart + insetStart;
  const min = visibleSize - (boxStart + boxSize) - insetEnd;
  if (min > max) {
    const centre = (min + max) / 2;
    return clampNumber(scroll, centre - give, centre + give);
  }
  return clampNumber(scroll, min - give, max + give);
};

/**
 * Clamps a viewport so it can never leave `rect`.
 *
 * `zoom` is clamped from below at the fit zoom (the editor's `lock.zoom`), so
 * the user can zoom *in* and pan around the page but can never zoom out far
 * enough to see its neighbours.
 *
 * @param overscroll rubberband give in CSS px. 0 (the default) is a rigid
 *   clamp, which is what paged mode installs.
 */
export const clampViewport = (
  viewport: Viewport,
  rect: Rect,
  box: CanvasBox,
  insets: Insets = EMPTY_INSETS,
  overscroll = 0,
): Viewport => {
  const zoom = normaliseZoom(
    clampNumber(viewport.zoom, getFitZoom(rect, box, insets), MAX_ZOOM),
  );
  const give = Math.max(0, overscroll) / zoom;
  return {
    zoom,
    scrollX: clampAxis(
      viewport.scrollX,
      rect.x,
      rect.width,
      box.width / zoom,
      insets.left / zoom,
      insets.right / zoom,
      give,
    ),
    scrollY: clampAxis(
      viewport.scrollY,
      rect.y,
      rect.height,
      box.height / zoom,
      insets.top / zoom,
      insets.bottom / zoom,
      give,
    ),
  };
};

/** The scene-space rectangle currently visible in the canvas box. */
export const getVisibleSceneRect = (
  viewport: Viewport,
  box: CanvasBox,
): Rect => ({
  x: -viewport.scrollX,
  y: -viewport.scrollY,
  width: box.width / viewport.zoom,
  height: box.height / viewport.zoom,
});

/**
 * Where a page's rect lands on screen, in CSS px relative to the canvas box.
 * Used by the page-fills-the-workspace assertions.
 */
export const getPageScreenRect = (
  rect: Rect,
  viewport: Viewport,
): { left: number; top: number; width: number; height: number } => ({
  left: (rect.x + viewport.scrollX) * viewport.zoom,
  top: (rect.y + viewport.scrollY) * viewport.zoom,
  width: rect.width * viewport.zoom,
  height: rect.height * viewport.zoom,
});

/** True when the viewport shows nothing outside `rect` (+ inset margin). */
export const isViewportInsidePage = (
  viewport: Viewport,
  rect: Rect,
  box: CanvasBox,
  insets: Insets = EMPTY_INSETS,
  tolerance = 1,
): boolean => {
  const clamped = clampViewport(viewport, rect, box, insets);
  return (
    Math.abs(clamped.scrollX - viewport.scrollX) * viewport.zoom <= tolerance &&
    Math.abs(clamped.scrollY - viewport.scrollY) * viewport.zoom <= tolerance &&
    viewport.zoom >= getFitZoom(rect, box, insets) - 1e-6
  );
};

/** True when the user has zoomed in past the fit zoom (free panning). */
export const isZoomedIn = (
  viewport: Viewport,
  rect: Rect,
  box: CanvasBox,
  insets: Insets = EMPTY_INSETS,
): boolean => viewport.zoom > getFitZoom(rect, box, insets) + 1e-4;

/** True when the OS asks for reduced motion. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
