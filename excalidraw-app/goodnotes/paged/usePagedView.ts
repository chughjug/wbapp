/**
 * React binding for paged view.
 *
 * Thin on purpose: the controller (`controller.ts`) owns all of the
 * behaviour, the hook just mirrors its state into React and hands back
 * stable callbacks, so pointer moves and viewport churn never re-render the
 * host.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { attachPagedView } from "./controller";
import { loadViewMode } from "./mode";

import type {
  AttachPagedViewOptions,
  GoToPageOptions,
  PageChangeCause,
  PagedViewController,
  PagedViewState,
} from "./controller";
import type { ViewMode } from "./mode";

export interface UsePagedViewOptions
  extends Pick<
    AttachPagedViewOptions,
    "padding" | "keyboard" | "getContainer"
  > {
  /** Observe page changes (the hook already produces the `aria-live` text). */
  onPageChange?: (index: number, count: number, cause: PageChangeCause) => void;
  /** Build the screen-reader announcement. Defaults to "Page 2 of 7". */
  formatAnnouncement?: (index: number, count: number) => string;
}

export interface UsePagedViewResult {
  /** `"paged"` (one page fills the workspace) or `"continuous"` (free canvas). */
  mode: ViewMode;
  isPaged: boolean;
  setPaged: (paged: boolean) => void;
  togglePaged: () => void;

  /** 0-based index of the page in view; `-1` when the document has none. */
  pageIndex: number;
  /** 1-based, for display; `0` when there are no pages. */
  pageNumber: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  /** True when the user has zoomed in past the fit (free panning in-page). */
  isZoomedIn: boolean;

  goToPage: (index: number, opts?: GoToPageOptions) => boolean;
  next: (opts?: GoToPageOptions) => boolean;
  prev: (opts?: GoToPageOptions) => boolean;
  /** Re-fit the current page (after a layout change you know about). */
  refit: (opts?: { animate?: boolean }) => void;

  /**
   * Text for an `aria-live="polite"` region. Render it (or just use
   * {@link PagedViewControls}, which already does) so page changes are
   * announced — every route to a page, not only the gesture.
   */
  announcement: string;

  /** Spread onto `<PagedViewControls />`. */
  controlsProps: {
    mode: ViewMode;
    pageNumber: number;
    pageCount: number;
    canPrev: boolean;
    canNext: boolean;
    announcement: string;
    onPrev: () => void;
    onNext: () => void;
    onGoToPage: (pageNumber: number) => void;
    onToggleMode: () => void;
  };
}

const INITIAL_STATE = (): PagedViewState => ({
  mode: loadViewMode(),
  isPaged: loadViewMode() === "paged",
  pageIndex: -1,
  pageCount: 0,
  isZoomedIn: false,
});

const defaultAnnouncement = (index: number, count: number) =>
  count > 0 ? `Page ${index + 1} of ${count}` : "No pages";

/**
 * Locks the editor's viewport to one page at a time.
 *
 * `excalidrawAPI` may be `null` while the editor boots; the hook attaches as
 * soon as it arrives and detaches on unmount.
 */
export const usePagedView = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options: UsePagedViewOptions = {},
): UsePagedViewResult => {
  const [state, setState] = useState<PagedViewState>(INITIAL_STATE);
  const [announcement, setAnnouncement] = useState("");

  const controllerRef = useRef<PagedViewController | null>(null);

  // refs so the controller never has to be re-attached when a callback or a
  // tunable changes identity
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { padding, keyboard, getContainer } = options;

  useEffect(() => {
    if (!excalidrawAPI) {
      controllerRef.current = null;
      return;
    }
    const controller = attachPagedView(excalidrawAPI, {
      padding,
      keyboard,
      getContainer,
      onState: setState,
      onPageChange: (index, count, cause) => {
        const format =
          optionsRef.current.formatAnnouncement ?? defaultAnnouncement;
        setAnnouncement(format(index, count));
        optionsRef.current.onPageChange?.(index, count, cause);
      },
    });
    controllerRef.current = controller;
    setState(controller.getState());
    return () => {
      controllerRef.current = null;
      controller.destroy();
    };
  }, [excalidrawAPI, padding, keyboard, getContainer]);

  const goToPage = useCallback(
    (index: number, opts?: GoToPageOptions) =>
      controllerRef.current?.goToPage(index, opts) ?? false,
    [],
  );
  const next = useCallback(
    (opts?: GoToPageOptions) => controllerRef.current?.next(opts) ?? false,
    [],
  );
  const prev = useCallback(
    (opts?: GoToPageOptions) => controllerRef.current?.prev(opts) ?? false,
    [],
  );
  const refit = useCallback(
    (opts?: { animate?: boolean }) => controllerRef.current?.refit(opts),
    [],
  );
  const setPaged = useCallback(
    (paged: boolean) => controllerRef.current?.setPaged(paged),
    [],
  );
  const togglePaged = useCallback(
    () => controllerRef.current?.togglePaged(),
    [],
  );

  const pageNumber = state.pageIndex === -1 ? 0 : state.pageIndex + 1;
  const canPrev = state.pageIndex > 0;
  const canNext =
    state.pageIndex !== -1 && state.pageIndex < state.pageCount - 1;

  return useMemo<UsePagedViewResult>(
    () => ({
      mode: state.mode,
      isPaged: state.isPaged,
      setPaged,
      togglePaged,
      pageIndex: state.pageIndex,
      pageNumber,
      pageCount: state.pageCount,
      canPrev,
      canNext,
      isZoomedIn: state.isZoomedIn,
      goToPage,
      next,
      prev,
      refit,
      announcement,
      controlsProps: {
        mode: state.mode,
        pageNumber,
        pageCount: state.pageCount,
        canPrev,
        canNext,
        announcement,
        onPrev: () => prev(),
        onNext: () => next(),
        onGoToPage: (value: number) => goToPage(value - 1),
        onToggleMode: () => togglePaged(),
      },
    }),
    [
      state,
      pageNumber,
      canPrev,
      canNext,
      announcement,
      setPaged,
      togglePaged,
      goToPage,
      next,
      prev,
      refit,
    ],
  );
};
