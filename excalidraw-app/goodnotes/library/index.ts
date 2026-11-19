/**
 * GoodNotes document library — public API.
 *
 * This module owns the multi-document layer that replaces Excalidraw's single
 * `excalidraw` localStorage scene: a document *manager* home screen (sidebar
 * filters, course folders, grid/list views) plus the IndexedDB persistence
 * behind it.
 *
 * Typical integration (see INTEGRATION.md for the exact App.tsx diff) is
 * unchanged from before:
 *
 * ```tsx
 * const [docId, setDocId] = useState<string | null>(null);
 * if (!docId) {
 *   return <Shelf theme={appTheme} onOpenDocument={(doc) => setDocId(doc.id)} />;
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Full-screen home screen (sidebar + folders + grid/list). */
export { Shelf } from "./Shelf";
export type { ShelfProps, LibraryView, ShelfSortKey } from "./Shelf";

/** Due-state helpers and the relative-time formatters the cards use. */
export {
  getDueUrgency,
  formatDueDate,
  formatUpdatedAt,
  formatShortDate,
  formatBytes,
} from "./format";
export type { DueUrgency } from "./format";

/** Building blocks, exported so a host can compose its own home screen. */
export { Sidebar } from "./Sidebar";
export type { SidebarProps, SidebarCourse } from "./Sidebar";
export { CourseFolders } from "./CourseFolders";
export type { CourseFoldersProps, CourseFolder } from "./CourseFolders";
export { DocumentCard } from "./DocumentCard";
export { DocumentRow } from "./DocumentRow";
export type { DocumentItemProps } from "./DocumentEditor";
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
export { PromptDialog } from "./PromptDialog";
export type { PromptDialogProps } from "./PromptDialog";
export { SelectionBar } from "./SelectionBar";
export type { SelectionBarProps } from "./SelectionBar";

// ---------------------------------------------------------------------------
// Filter model + the favourites convention
// ---------------------------------------------------------------------------

export {
  /** Reserved tag used as the starred flag (see filters.ts for the rationale). */
  FAVOURITE_TAG,
  /** Reserved tag: hidden everywhere but the Archived filter. */
  ARCHIVED_TAG,
  /** Reserved tag: sorts to the top of the shelf. */
  PINNED_TAG,
  RESERVED_TAGS,
  isReservedTag,
  tagKey,
  isArchived,
  isPinned,
  hasUserTag,
  isHiddenByArchive,
  /** filter + archive visibility: the single predicate the shelf applies. */
  isInView,
  RECENT_WINDOW_MS,
  FILTER_ALL,
  isFavourite,
  /** A document's tags minus the reserved favourite flag. */
  visibleTags,
  isDueThisWeek,
  isRecent,
  endOfDueWeek,
  matchesFilter,
  matchesQuery,
  filterId,
  filterLabel,
  filtersEqual,
} from "./filters";
export type { LibraryFilter } from "./filters";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export {
  buildTagIndex,
  countDocsWithTag,
  suggestTags,
  addTagToList,
  removeTagFromList,
  renameTagInList,
} from "./tags";
export type { TagCount } from "./tags";

// ---------------------------------------------------------------------------
// Nested courses (path-style, see coursePath.ts for the model rationale)
// ---------------------------------------------------------------------------

export {
  COURSE_SEPARATOR,
  COURSE_SEPARATOR_DISPLAY,
  MAX_COURSE_DEPTH,
  splitCoursePath,
  joinCoursePath,
  normalizeCoursePath,
  formatCoursePath,
  coursePathLabel,
  coursePathParent,
  coursePathDepth,
  coursePathAncestors,
  isDescendantCourse,
  isInCourseTree,
  rewriteCoursePath,
  buildCourseTree,
  flattenCourseTree,
} from "./coursePath";
export type { CourseNode } from "./coursePath";

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

export { useSelection } from "./selection";
export type { UseSelectionResult } from "./selection";

// ---------------------------------------------------------------------------
// React state
// ---------------------------------------------------------------------------

/** Hook exposing the document list plus stable mutation actions. */
export { useDocuments } from "./useDocuments";
export type { UseDocumentsResult, DocumentActions } from "./useDocuments";

/** Hook + store for per-course colour and emoji (separate IndexedDB db). */
export {
  useCourseStyles,
  listCourseStyles,
  setCourseStyle,
  resetCourseStyle,
  subscribeCourseStyles,
  resolveCourseStyle,
  defaultCourseColor,
  normalizeHex,
  hexToRgbChannels,
  describeColor,
  COURSE_COLOR_PRESETS,
  COURSE_EMOJI_PRESETS,
  renameCourseStyleTree,
} from "./courses";
export type {
  CourseStyle,
  CourseStyleMap,
  UseCourseStylesResult,
} from "./courses";

// ---------------------------------------------------------------------------
// Persistence (use directly from the editor side: load/save a document)
// ---------------------------------------------------------------------------

export {
  /** All document metadata, newest-updated first. Never loads scenes. */
  listDocs,
  /** One document's metadata, or null. */
  getDoc,
  /** One document's scene payload (elements/appState/files), or null. */
  getScene,
  /** Create a document from a partial metadata seed. */
  createDoc,
  /** Merge a metadata patch; bumps updatedAt. */
  updateDocMeta,
  /** Persist a scene; bumps updatedAt and derives pageCount. */
  saveScene,
  /** Coalesced variant of saveScene, keyed per document. */
  saveSceneDebounced,
  /** Force-write anything saveSceneDebounced is still holding. */
  flushSceneSaves,
  /** Scene writes that failed with nobody left waiting on them. */
  subscribeSaveError,
  /** Record the version this tab is editing a document from. */
  noteSceneBaseline,
  /** Drop a document's watermark when it is closed or deleted. */
  forgetSceneBaseline,
  /** Notified when a save folded in another tab's concurrent work. */
  subscribeSceneMerged,
  /** Store a page-1 PNG data URL preview. */
  setThumbnail,
  /** Stamp lastOpenedAt. */
  touchDoc,
  /** Copy metadata + scene under a new id. */
  duplicateDoc,
  /** Delete metadata + scene. */
  deleteDoc,
  /** Subscribe to any library mutation. Returns an unsubscribe fn. */
  subscribe,
  /** Coalesce many writes into one change notification. */
  runBatched,
  /** Bulk metadata patch across many documents (one notification). */
  updateManyDocs,
  deleteManyDocs,
  duplicateManyDocs,
  /** Add/remove one tag across many documents — also how flags are written. */
  setTagOnMany,
  /** Rename a tag across the whole library. */
  renameTagEverywhere,
  deleteTagEverywhere,
  /** Rename a course node *and every course nested below it*. */
  renameCourseTree,
  clearCourseTree,
  DEFAULT_DOC_TITLE,
  SCENE_SAVE_DEBOUNCE_MS,
} from "./store";
export type { DocPatch } from "./store";

// ---------------------------------------------------------------------------
// home screen (see INTEGRATION.md §11)
// ---------------------------------------------------------------------------

/** The horizontal chip rail that replaced the resident sidebar. */
export { FilterRail } from "./FilterRail";
export type { FilterRailProps, RailCourse } from "./FilterRail";

/** The modal drawer the sidebar and the course folders moved into. */
export { BrowseDrawer } from "./BrowseDrawer";
export type { BrowseDrawerProps } from "./BrowseDrawer";

/** The one popup primitive: anchored, portalled, Escape-closable. */
export { Popover, MenuButton, MenuItem, MenuGroup } from "./Popover";
export type { PopoverProps } from "./Popover";

/** The theme a portalled surface re-declares, since it leaves the subtree. */
export { ShelfThemeContext, useShelfTheme } from "./theme";
export type { ShelfTheme } from "./theme";

/**
 * Cover generation. Nothing in the app produced a `DocMeta.thumbnail` before
 * this; `Shelf` queues these for what is on screen. See thumbnails.ts.
 */
export {
  renderThumbnail,
  queueThumbnails,
  needsThumbnail,
  THUMBNAIL_MAX_PX,
} from "./thumbnails";
