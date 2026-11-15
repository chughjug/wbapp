/**
 * React binding between the page model and a live Excalidraw editor.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { Page, PageSizeName, PaperTemplateId } from "../types";

import {
  addPage as addPageToElements,
  deletePage as deletePageInElements,
  ensureFirstPage,
  getPageIndexAtSceneY,
  getPages,
  movePage as movePageInElements,
  setPageTemplate as setPageTemplateInElements,
} from "./pageModel";
import { scrollToPage as scrollViewportToPage } from "./scrollToPage";

export interface UsePagesResult {
  /** Every page in the document, in document order. */
  pages: Page[];
  /** Index of the page under the viewport centre; `-1` when there are none. */
  activePageIndex: number;
  /** Scroll the viewport to a page (smooth unless reduced motion is on). */
  goToPage: (index: number) => void;
  /** Insert a page (default: at the end) and scroll to it. */
  addPage: (opts?: {
    at?: number;
    size?: PageSizeName;
    template?: PaperTemplateId;
    scrollTo?: boolean;
  }) => void;
  /** Delete a page and everything on it. */
  deletePage: (index: number) => void;
  /** Reorder a page; content travels with it. */
  movePage: (from: number, to: number) => void;
  /** Convenience wrappers around {@link UsePagesResult.movePage}. */
  movePageUp: (index: number) => void;
  movePageDown: (index: number) => void;
  /** Change a page's paper template. */
  setPageTemplate: (index: number, template: PaperTemplateId) => void;
  /** Create page 1 if the document has none. Safe to call repeatedly. */
  seedFirstPage: (opts?: {
    size?: PageSizeName;
    template?: PaperTemplateId;
  }) => void;
}

/**
 * Tracks the document's pages and exposes the page actions, applying every
 * change through `excalidrawAPI.updateScene`.
 *
 * The page list is recomputed only when the set of page frames actually
 * changes (cheap identity signature), so ordinary drawing does not re-render
 * the sidebar. The active index is recomputed on every viewport change but is
 * only committed to state when it changes value.
 */
export const usePages = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): UsePagesResult => {
  const [pages, setPages] = useState<Page[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(-1);

  // kept in a ref so the action callbacks have a stable identity
  const pagesRef = useRef<Page[]>(pages);
  pagesRef.current = pages;

  useEffect(() => {
    if (!excalidrawAPI) {
      setPages([]);
      setActivePageIndex(-1);
      return;
    }

    let signature = "";

    const sync = () => {
      const elements = excalidrawAPI.getSceneElements();
      const next = getPages(elements);
      const nextSignature = next
        .map((page) => `${page.frame.id}:${page.frame.version}`)
        .join("|");

      if (nextSignature !== signature) {
        signature = nextSignature;
        setPages(next);
        pagesRef.current = next;
      }

      const appState = excalidrawAPI.getAppState();
      const sceneCentreY =
        appState.height / 2 / appState.zoom.value - appState.scrollY;
      setActivePageIndex((current) => {
        const index = getPageIndexAtSceneY(pagesRef.current, sceneCentreY);
        return index === current ? current : index;
      });
    };

    sync();
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  const apply = useCallback(
    (
      produce: (
        elements: readonly ExcalidrawElement[],
      ) => readonly ExcalidrawElement[],
    ) => {
      if (!excalidrawAPI) {
        return;
      }
      excalidrawAPI.updateScene({
        elements: produce(excalidrawAPI.getSceneElementsIncludingDeleted()),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [excalidrawAPI],
  );

  const goToPage = useCallback(
    (index: number) => {
      if (excalidrawAPI) {
        scrollViewportToPage(excalidrawAPI, index);
      }
    },
    [excalidrawAPI],
  );

  const addPage = useCallback<UsePagesResult["addPage"]>(
    (opts = {}) => {
      if (!excalidrawAPI) {
        return;
      }
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const result = addPageToElements(elements, opts);
      excalidrawAPI.updateScene({
        elements: result.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      if (opts.scrollTo !== false) {
        // after the scene has committed
        requestAnimationFrame(() => {
          scrollViewportToPage(excalidrawAPI, result.index);
        });
      }
    },
    [excalidrawAPI],
  );

  const deletePage = useCallback(
    (index: number) => apply((elements) => deletePageInElements(elements, index)),
    [apply],
  );

  const movePage = useCallback(
    (from: number, to: number) =>
      apply((elements) => movePageInElements(elements, from, to)),
    [apply],
  );

  const movePageUp = useCallback(
    (index: number) => movePage(index, index - 1),
    [movePage],
  );

  const movePageDown = useCallback(
    (index: number) => movePage(index, index + 1),
    [movePage],
  );

  const setPageTemplate = useCallback(
    (index: number, template: PaperTemplateId) =>
      apply((elements) =>
        setPageTemplateInElements(elements, index, template),
      ),
    [apply],
  );

  const seedFirstPage = useCallback<UsePagesResult["seedFirstPage"]>(
    (opts) => {
      if (!excalidrawAPI) {
        return;
      }
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const next = ensureFirstPage(elements, opts);
      if (next !== elements) {
        excalidrawAPI.updateScene({
          elements: next,
          // seeding is scene initialisation, not a user edit
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    },
    [excalidrawAPI],
  );

  return useMemo(
    () => ({
      pages,
      activePageIndex,
      goToPage,
      addPage,
      deletePage,
      movePage,
      movePageUp,
      movePageDown,
      setPageTemplate,
      seedFirstPage,
    }),
    [
      pages,
      activePageIndex,
      goToPage,
      addPage,
      deletePage,
      movePage,
      movePageUp,
      movePageDown,
      setPageTemplate,
      seedFirstPage,
    ],
  );
};
