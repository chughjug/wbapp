/**
 * GoodNotes-style discrete pages for Excalidraw, implemented on top of the
 * editor's native `frame` element.
 *
 * One scene holds every page. A page is a fixed-size frame named
 * `page:<n>` (see `PAGE_FRAME_PREFIX` in `../types`); frames are stacked in a
 * single vertical column separated by `PAGE_GAP`. Frames already clip their
 * contents, carry a name and can be exported individually, so pages get
 * clipping, naming and per-page export for free.
 *
 * Typical host wiring:
 *
 * ```tsx
 * const { seedFirstPage } = usePages(excalidrawAPI);
 * useEffect(() => { seedFirstPage(); }, [seedFirstPage]);
 * // …
 * <Sidebar name="pages" docked>
 *   <Sidebar.Header />
 *   <PageSidebar excalidrawAPI={excalidrawAPI} />
 * </Sidebar>
 * ```
 *
 * See `INTEGRATION.md` in this folder for copy-pasteable App.tsx changes.
 */

export {
  /** Page frames in document order, with their index and paper template. */
  getPages,
  /** Number of (non-deleted) page frames in the scene. */
  getPageCount,
  /** A single page by index, or `null`. */
  getPageAt,
  /** Non-deleted elements parented to a page frame. */
  getPageChildren,
  /** Type guard for "this frame is a document page". */
  isPageFrame,
  /** Paper template id stored on a page frame (in `customData`). */
  getPageTemplate,
  /** Paper template of the page at an index — for `templateForPage`. */
  getTemplateForPage,
  /** Page-size preset of a page frame. */
  getPageSizeName,
  /** Builds (does not insert) the frame element backing a page. */
  createPageFrame,
  /** Canonical `page:<n>` name for a 0-based index. */
  pageFrameName,
  /** Inserts a page; returns the new elements array, frame and index. */
  addPage,
  /** Soft-deletes a page and its contents, then restacks. */
  deletePage,
  /** Reorders a page; its contents travel with it. */
  movePage,
  /** Sets a page's paper template (stored in the frame's `customData`). */
  setPageTemplate,
  /** Sets (or clears) a page's image background. */
  setPageImage,
  /** A page's image background, if it has one. */
  getPageImage,
  /** Whether a page frame is landscape. */
  isLandscapePage,
  /** Size-preset geometry, honouring orientation. */
  getPageDimensions,
  /** Re-lays out the whole column: positions, names and child offsets. */
  restackPages,
  /** Creates page 1 when the document has none. Idempotent. */
  ensureFirstPage,
  /** `y` a page should sit at, given the pages above it. */
  getPageTop,
  /** Total height of the page column, gaps included. */
  getStackHeight,
  /** Index of the page nearest a scene-space y (used for "current page"). */
  getPageIndexAtSceneY,
  /** Constants describing the column's origin and `customData` key. */
  PAGE_ORIGIN_X,
  PAGE_ORIGIN_Y,
  PAGE_CUSTOM_DATA_KEY,
} from "./pageModel";

export type {
  AddPageOptions,
  AddPageResult,
  PageCustomData,
} from "./pageModel";

// ---------------------------------------------------------------------------
// the "new page" flow: format picker + remembered choice + image pages
// ---------------------------------------------------------------------------

/**
 * React hook owning the whole add-a-page flow. Gives you a bare `open()`
 * callback for any button (nav bar, page panel, shortcut), the `dialog` to
 * render once, and a headless `addPageWithChoice()`.
 */
export { useNewPage } from "./useNewPage";
export type {
  UseNewPageOptions,
  UseNewPageResult,
  NewPageRequest,
} from "./useNewPage";

/** The dialog itself, if you would rather drive the open state yourself. */
export { NewPageDialog, IMAGE_FORMAT_ID } from "./NewPageDialog";
export type {
  NewPageDialogProps,
  NewPageSubmission,
  NewPageFormatId,
} from "./NewPageDialog";

/** Per-document memory of the last chosen format. */
export {
  loadNewPageChoice,
  readNewPageChoice,
  writeNewPageChoice,
  getCurrentDocId,
  DEFAULT_NEW_PAGE_CHOICE,
} from "./newPageChoice";
export type { NewPageChoice } from "./newPageChoice";

/** Turning a picked `File` into page-background bytes in `BinaryFiles`. */
export {
  attachPageImageFile,
  preparePageImage,
  isSupportedPageImage,
  PageImageError,
  PAGE_IMAGE_ACCEPT,
  PAGE_IMAGE_MIME_TYPES,
  PAGE_IMAGE_MAX_BYTES,
} from "./pageImageFile";
export type { PreparedPageImage } from "./pageImageFile";

/** React hook: live page list, active page index and page actions. */
export { usePages } from "./usePages";
export type { UsePagesResult } from "./usePages";

/**
 * Viewport navigation. NOTE: this fork exposes `setViewport`, not
 * `scrollToContent`; `scrollToPage` wraps it and honours reduced motion.
 */
export {
  scrollToPage,
  scrollToPageOfElement,
  prefersReducedMotion,
  PAGE_SCROLL_DURATION,
} from "./scrollToPage";
export type { ScrollToPageOptions } from "./scrollToPage";

/** The page-thumbnail navigator strip. */
export { PageSidebar } from "./PageSidebar";
export type { PageSidebarProps } from "./PageSidebar";
