/**
 * AFFiNE / BlockSuite-inspired presentation mode over page frames.
 *
 * Walks the document's pages full-viewport (contain fit). Does not invent a
 * new frame type — notebook pages *are* frames already.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { scrollToPage } from "../pages/scrollToPage";

import type { Page } from "../types";

export interface PresentationState {
  active: boolean;
  index: number;
}

export const PRESENTATION_BODY_CLASS = "gn-presenting";

export const clampPresentationIndex = (
  index: number,
  pageCount: number,
): number => {
  if (pageCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(pageCount - 1, index));
};

export const goToPresentationPage = (
  api: ExcalidrawImperativeAPI | null | undefined,
  pages: readonly Page[],
  index: number,
): number => {
  if (!api || pages.length === 0) {
    return 0;
  }
  const next = clampPresentationIndex(index, pages.length);
  scrollToPage(api, next, { fit: "contain" });
  return next;
};

export const setPresentationChrome = (active: boolean) => {
  if (typeof document === "undefined") {
    return;
  }
  document.body.classList.toggle(PRESENTATION_BODY_CLASS, active);
  if (active) {
    void document.documentElement.requestFullscreen?.().catch(() => {
      // fullscreen is best-effort (iPad Safari often denies it)
    });
  } else if (document.fullscreenElement) {
    void document.exitFullscreen?.().catch(() => undefined);
  }
};
