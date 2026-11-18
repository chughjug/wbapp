import { useCallback, useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { goToPresentationPage, setPresentationChrome } from "./presentation";

import type { Page } from "../types";

export interface UsePresentationResult {
  active: boolean;
  index: number;
  start: (fromIndex?: number) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
}

export const usePresentation = (
  api: ExcalidrawImperativeAPI | null,
  pages: readonly Page[],
): UsePresentationResult => {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  const start = useCallback(
    (fromIndex = 0) => {
      setPresentationChrome(true);
      setActive(true);
      setIndex(goToPresentationPage(api, pages, fromIndex));
    },
    [api, pages],
  );

  const stop = useCallback(() => {
    setPresentationChrome(false);
    setActive(false);
  }, []);

  const next = useCallback(() => {
    setIndex((current) => goToPresentationPage(api, pages, current + 1));
  }, [api, pages]);

  const prev = useCallback(() => {
    setIndex((current) => goToPresentationPage(api, pages, current - 1));
  }, [api, pages]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return; // someone is typing
      }
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        prev();
      }
    };
    // CAPTURE, on `window`.
    //
    // The floating bar deliberately stays visible and focusable while
    // presenting (see `PresentationOverlay.scss`), and closing the "+" menu
    // returns focus to its trigger — a bar button. The bar's roving-focus
    // handler claims Left/Right in the capture phase on `document` and calls
    // `stopPropagation`, so in a bubble listener here the arrow keys never
    // arrived: they moved focus along the hidden bar instead of changing
    // slide, and a presentation could not be advanced or stepped back from
    // the keyboard at all. `window` capture runs before `document` capture,
    // so presenting — which is a modal mode — now wins.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, next, prev, stop]);

  useEffect(() => () => setPresentationChrome(false), []);

  return { active, index, start, stop, next, prev };
};
