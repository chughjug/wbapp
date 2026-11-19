/**
 * Vertical strip of page thumbnails — the GoodNotes page navigator.
 *
 * Thumbnails are composited: the page's paper template (`renderPaper` from
 * `../paper`) is painted first, then the page's ink is exported on a
 * transparent raster and drawn over it.
 *
 * Accessibility notes:
 *  - the strip is a `listbox`-flavoured list of real `<button>`s; the active
 *    page carries `aria-current="page"`,
 *  - ArrowUp/ArrowDown move roving focus between pages (Home/End jump),
 *    Enter/Space activate — the native button behaviour,
 *  - every icon-only control has a text accessible name,
 *  - focus rings are visible (`:focus-visible`) and never removed,
 *  - `prefers-reduced-motion: reduce` disables the CSS transitions here and
 *    the canvas easing in `scrollToPage`.
 */

import { exportScene, getNonDeletedElements } from "@excalidraw/excalidraw";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { requestUndo } from "../input/history";

import { renderPaper } from "../paper";
import { getPageImageBackground, preloadPageImages } from "../paper/pageImages";

import { getPageChildren } from "./pageModel";
import { usePages } from "./usePages";
import { useNewPage } from "./useNewPage";

import "./PageSidebar.scss";

import type { Page } from "../types";

/** Width of a rendered thumbnail, in CSS px. */
const THUMBNAIL_WIDTH = 132;
/** Bitmaps are rendered at this multiple of the CSS size, for crispness. */
const THUMBNAIL_PIXEL_RATIO = 2;
/** How long to wait after the last scene change before re-rendering thumbs. */
const THUMBNAIL_DEBOUNCE_MS = 400;
/**
 * Above this many pages we stop rendering bitmaps and fall back to numbered
 * placeholders. Each thumbnail is a full off-screen canvas render of a page,
 * which is too expensive to do for a large document on every change.
 */
const THUMBNAIL_PAGE_LIMIT = 60;

export interface PageSidebarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Render page bitmaps. Defaults to true. */
  thumbnails?: boolean;
  /**
   * "+ Add page" behaviour. `"picker"` (default) opens the format dialog —
   * template, size, orientation, or an image background — and remembers the
   * choice; `"repeat"` silently re-uses the last remembered choice.
   *
   * Pass `onAddPage` to take the action over entirely (e.g. when the host
   * owns one shared `useNewPage` instance for both this panel and the nav
   * bar — see INTEGRATION.md).
   */
  addPageMode?: "picker" | "repeat";
  /** Overrides `addPageMode` and this component's own dialog. */
  onAddPage?: () => void;
  /** Document id for the remembered new-page choice. Default: from the URL. */
  docId?: string | null;
  className?: string;
}

export const PageSidebar: React.FC<PageSidebarProps> = ({
  excalidrawAPI,
  thumbnails = true,
  addPageMode = "picker",
  onAddPage,
  docId,
  className,
}) => {
  const {
    pages,
    activePageIndex,
    goToPage,
    deletePage,
    movePageUp,
    movePageDown,
  } = usePages(excalidrawAPI);

  /**
   * The page just deleted, and a way back.
   *
   * Deleting a page of handwritten notes is one tap from a 24px target
   * that sat two pixels from "Move down". `Ctrl+Z` always restored it,
   * but on a tablet with no keyboard the only undo was an unlabelled
   * icon in the far corner of the editor, so for most users the delete
   * read as final. This is the visible way back.
   */
  const [deleted, setDeleted] = useState<{ page: number } | null>(null);
  const deletedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (deletedTimer.current) {
        clearTimeout(deletedTimer.current);
      }
    },
    [],
  );

  const onDeletePage = useCallback(
    (index: number) => {
      deletePage(index);
      setDeleted({ page: index + 1 });
      if (deletedTimer.current) {
        clearTimeout(deletedTimer.current);
      }
      // long enough to notice and reach, short enough not to become
      // permanent furniture in a narrow panel
      deletedTimer.current = setTimeout(() => setDeleted(null), 9000);
    },
    [deletePage],
  );

  const undoDelete = useCallback(() => {
    if (deletedTimer.current) {
      clearTimeout(deletedTimer.current);
    }
    setDeleted(null);
    requestUndo();
  }, []);

  // The format picker. Owned here so the panel works standalone; a host that
  // wants ONE flow shared with the nav bar passes `onAddPage` instead.
  const newPage = useNewPage(excalidrawAPI, { docId });

  const handleAddPage = useCallback(() => {
    if (onAddPage) {
      onAddPage();
    } else if (addPageMode === "repeat") {
      void newPage.repeatLastChoice();
    } else {
      newPage.open();
    }
  }, [onAddPage, addPageMode, newPage]);

  const thumbs = usePageThumbnails(
    excalidrawAPI,
    pages,
    thumbnails && pages.length <= THUMBNAIL_PAGE_LIMIT,
  );

  const listRef = useRef<HTMLUListElement>(null);
  // roving tabindex: only one page button is tabbable at a time
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (activePageIndex >= 0) {
      setFocusIndex(activePageIndex);
    }
  }, [activePageIndex]);

  const focusPageButton = useCallback((index: number) => {
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-page-index="${index}"] .goodnotes-page__open`,
    );
    button?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      let next: number | null = null;
      if (event.key === "ArrowDown") {
        next = Math.min(focusIndex + 1, pages.length - 1);
      } else if (event.key === "ArrowUp") {
        next = Math.max(focusIndex - 1, 0);
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = pages.length - 1;
      }
      if (next !== null && next !== focusIndex) {
        event.preventDefault();
        setFocusIndex(next);
        focusPageButton(next);
      } else if (next !== null) {
        event.preventDefault();
      }
    },
    [focusIndex, pages.length, focusPageButton],
  );

  // keep the active thumbnail in view in the strip
  useEffect(() => {
    if (activePageIndex < 0) {
      return;
    }
    const item = listRef.current?.querySelector(
      `[data-page-index="${activePageIndex}"]`,
    );
    // `?.` on the method too: jsdom has no scrollIntoView, and the repo
    // guards it the same way elsewhere
    item?.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotionCSS() ? "auto" : "smooth",
    });
  }, [activePageIndex]);

  return (
    <nav
      className={`goodnotes-pages ${className ?? ""}`}
      aria-label="Pages"
      data-testid="goodnotes-page-sidebar"
    >
      <ul className="goodnotes-pages__list" ref={listRef} onKeyDown={onKeyDown}>
        {pages.map((page, index) => {
          const isActive = index === activePageIndex;
          const label = `Page ${index + 1} of ${pages.length}`;
          return (
            <li
              className="goodnotes-page"
              key={page.frame.id}
              data-page-index={index}
              data-active={isActive || undefined}
            >
              <button
                type="button"
                className="goodnotes-page__open"
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                tabIndex={index === focusIndex ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => goToPage(index)}
              >
                <span className="goodnotes-page__thumb" aria-hidden="true">
                  {thumbs.get(page.frame.id) ? (
                    <img
                      src={thumbs.get(page.frame.id)}
                      alt=""
                      draggable={false}
                    />
                  ) : (
                    <span className="goodnotes-page__placeholder">
                      {index + 1}
                    </span>
                  )}
                </span>
                <span className="goodnotes-page__number" aria-hidden="true">
                  {index + 1}
                </span>
              </button>

              <div className="goodnotes-page__actions">
                <button
                  type="button"
                  className="goodnotes-page__action"
                  aria-label={`Move page ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => movePageUp(index)}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="goodnotes-page__action"
                  aria-label={`Move page ${index + 1} down`}
                  disabled={index === pages.length - 1}
                  onClick={() => movePageDown(index)}
                >
                  <ChevronDownIcon />
                </button>
                <button
                  type="button"
                  className="goodnotes-page__action goodnotes-page__action--danger"
                  aria-label={`Delete page ${index + 1}`}
                  disabled={pages.length <= 1}
                  onClick={() => onDeletePage(index)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {deleted && (
        <div className="goodnotes-pages__snack" role="status">
          <span>Page {deleted.page} deleted.</span>
          <button type="button" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      <div className="goodnotes-pages__footer">
        <button
          type="button"
          className="goodnotes-pages__add"
          onClick={handleAddPage}
          aria-haspopup={
            !onAddPage && addPageMode === "picker" ? "dialog" : undefined
          }
        >
          <PlusIcon />
          <span>Add page</span>
        </button>
      </div>
      {!onAddPage && newPage.dialog}
    </nav>
  );
};

// ---------------------------------------------------------------------------
// thumbnails
// ---------------------------------------------------------------------------

const prefersReducedMotionCSS = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Renders one page thumbnail: the page's paper template painted first, then
 * the page's ink composited on top.
 *
 * The ink raster MUST be transparent or it would hide the paper, hence
 * `canvasBackgroundColor: false` (without it the export fills the canvas with
 * `appState.viewBackgroundColor` and the paper would never be visible). The
 * frame is passed as `exportingFrame`, so the export is clipped to the page
 * and its canvas is exactly the page box — no frame name or outline drawn.
 *
 * Exported for testing; not part of the module's public API (`index.ts`).
 */
export const renderPageThumbnail = async ({
  page,
  children,
  files,
  theme,
}: {
  page: Page;
  children: ExcalidrawElement[];
  files: BinaryFiles;
  theme: "light" | "dark";
}): Promise<string> => {
  const { width: pageWidth, height: pageHeight } = page.frame;
  const scale = (THUMBNAIL_WIDTH / pageWidth) * THUMBNAIL_PIXEL_RATIO;
  const canvasWidth = Math.max(1, Math.round(pageWidth * scale));
  const canvasHeight = Math.max(1, Math.round(pageHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("no 2d context");
  }

  // 1. the paper (sheet fill + rulings + border), in page-local coordinates
  ctx.save();
  ctx.scale(canvasWidth / pageWidth, canvasHeight / pageHeight);
  renderPaper(ctx, page.template, pageWidth, pageHeight, {
    theme,
    sheet: true,
    // image-backed pages: the bitmap has already been awaited by the caller
    // (`preloadPageImages`), so this synchronous draw gets the real pixels
    image: getPageImageBackground(page.frame),
  });
  ctx.restore();

  // 2. the ink, on a transparent raster, composited over the paper
  const ink = await exportScene({
    type: "canvas",
    data: {
      elements: getNonDeletedElements([...children, page.frame]),
      files,
    },
    config: {
      exportingFrame: page.frame as NonDeleted<ExcalidrawFrameElement>,
      padding: 0,
      theme,
      // transparent — otherwise this raster would paint over the paper
      canvasBackgroundColor: false,
      scale,
    },
  });
  ctx.drawImage(ink, 0, 0, canvasWidth, canvasHeight);

  return canvas.toDataURL("image/png");
};

/**
 * Debounced, cached page thumbnails.
 *
 * Each page is rendered with `exportScene({ type: "canvas", … })` using the
 * frame as `exportingFrame`, which clips the export to the page exactly as
 * the editor would. Renders are keyed on the page's content version, so only
 * pages that actually changed are re-rendered.
 *
 * Each thumbnail is the page's paper template (from `../paper`'s
 * `renderPaper`) with the ink composited on top — see
 * {@link renderPageThumbnail} — so a lined page looks lined in the strip.
 *
 * FALLBACK (documented): when `enabled` is false — e.g. the document has more
 * pages than {@link THUMBNAIL_PAGE_LIMIT} — the strip shows numbered
 * placeholders instead (no paper either). Rendering dozens of full-page
 * canvases on every edit is not worth the main-thread cost.
 */
const usePageThumbnails = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  pages: Page[],
  enabled: boolean,
) => {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const cacheRef = useRef(new Map<string, { key: string; url: string }>());

  // content signature per page: frame version + versions of its children
  const signature = useMemo(() => {
    if (!excalidrawAPI || !enabled) {
      return "";
    }
    const elements = excalidrawAPI.getSceneElements();
    const theme = excalidrawAPI.getAppState().theme;
    return `${theme}#${pages
      .map((page) => {
        const children = getPageChildren(elements, page.frame.id);
        let sum = page.frame.version;
        for (const child of children) {
          sum += child.version;
        }
        return `${page.frame.id}:${page.template}:${children.length}:${sum}`;
      })
      .join("|")}`;
    // `pages` identity changes whenever a page frame changes; we additionally
    // re-read children on every render of this hook's owner (cheap filter).
  }, [excalidrawAPI, pages, enabled]);

  useEffect(() => {
    if (!excalidrawAPI || !enabled) {
      setThumbs(new Map());
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const elements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      const theme = appState.theme === "dark" ? "dark" : "light";
      const next = new Map<string, string>();

      // `renderPaper` is synchronous; decode every page image FIRST so an
      // image page's thumbnail is the picture, not the placeholder.
      await preloadPageImages(elements, files);
      if (cancelled) {
        return;
      }

      for (const page of pages) {
        if (cancelled) {
          return;
        }
        const children = getPageChildren(elements, page.frame.id);
        let sum = page.frame.version;
        for (const child of children) {
          sum += child.version;
        }
        const image = getPageImageBackground(page.frame);
        const key = `${children.length}:${sum}:${page.frame.width}x${
          page.frame.height
        }:${page.template}:${image?.fileId ?? "-"}:${
          image?.fit ?? "-"
        }:${theme}`;
        const cached = cacheRef.current.get(page.frame.id);
        if (cached?.key === key) {
          next.set(page.frame.id, cached.url);
          continue;
        }
        try {
          const url = await renderPageThumbnail({
            page,
            children,
            files,
            theme,
          });
          cacheRef.current.set(page.frame.id, { key, url });
          next.set(page.frame.id, url);
        } catch {
          // a failed render just leaves the numbered placeholder in place
        }
      }

      if (!cancelled) {
        // drop cache entries for pages that no longer exist
        const live = new Set(pages.map((page) => page.frame.id));
        for (const id of [...cacheRef.current.keys()]) {
          if (!live.has(id)) {
            cacheRef.current.delete(id);
          }
        }
        setThumbs(next);
      }
    }, THUMBNAIL_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, enabled, signature]);

  return thumbs;
};

// ---------------------------------------------------------------------------
// icons (decorative — every control has a text accessible name)
// ---------------------------------------------------------------------------

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

const ChevronUpIcon = () => (
  <svg {...iconProps}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg {...iconProps}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TrashIcon = () => (
  <svg {...iconProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default PageSidebar;
