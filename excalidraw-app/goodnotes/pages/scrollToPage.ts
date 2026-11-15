/**
 * Viewport navigation between pages.
 *
 * NOTE: this fork of Excalidraw no longer exposes `excalidrawAPI.scrollToContent`.
 * Its replacement is `excalidrawAPI.setViewport({ target, fit, animation, offsets })`
 * (see `packages/excalidraw/viewport.ts` → `SetViewportOptions`), which is what
 * we use here. `target` accepts element(s), an element id, or a scene-coordinate
 * box; `animation: false` jumps instantly, `{ duration }` eases.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getPages } from "./pageModel";

/** Default easing duration for a page jump, in ms. */
export const PAGE_SCROLL_DURATION = 350;

/** True when the user asked the OS for reduced motion. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ScrollToPageOptions {
  /**
   * - `"scale-down"` (default) — zoom out so the whole page fits, never past 100%
   * - `"contain"` — zoom so the page fills the viewport
   * - `"none"` — keep the current zoom, just centre the page
   */
  fit?: "scale-down" | "contain" | "none";
  /** Force animation on/off. Defaults to on, unless reduced motion is set. */
  animate?: boolean;
  /** Animation duration in ms. Defaults to {@link PAGE_SCROLL_DURATION}. */
  duration?: number;
}

/**
 * Smooth-scrolls the viewport to the page at `index` (0-based).
 *
 * Honours `prefers-reduced-motion: reduce` by jumping instantly — the CSS
 * media query cannot reach a JS-driven canvas animation, so it is checked here.
 *
 * @returns `true` if the page existed and the viewport was moved.
 */
export const scrollToPage = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  index: number,
  opts: ScrollToPageOptions = {},
): boolean => {
  const page = getPages(excalidrawAPI.getSceneElements())[index];
  if (!page) {
    return false;
  }

  const animate = opts.animate ?? !prefersReducedMotion();

  excalidrawAPI.setViewport({
    target: page.frame,
    fit: opts.fit ?? "scale-down",
    animation: animate
      ? { duration: opts.duration ?? PAGE_SCROLL_DURATION }
      : false,
    // leave room for the editor chrome (toolbar / sidebar) around the page
    offsets: { ui: { reserve: { sidebar: true, stylesPanel: true } } },
  });

  return true;
};

/** Scrolls to the page containing `elementId`, if it is on one. */
export const scrollToPageOfElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementId: string,
  opts?: ScrollToPageOptions,
): boolean => {
  const elements = excalidrawAPI.getSceneElements();
  const element = elements.find((candidate) => candidate.id === elementId);
  if (!element?.frameId) {
    return false;
  }
  const index = getPages(elements).findIndex(
    (page) => page.frame.id === element.frameId,
  );
  return index === -1 ? false : scrollToPage(excalidrawAPI, index, opts);
};
