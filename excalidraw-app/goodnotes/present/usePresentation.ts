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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, prev, stop]);

  useEffect(() => () => setPresentationChrome(false), []);

  return { active, index, start, stop, next, prev };
};
