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
export type { ShelfProps, LibraryView } from "./Shelf";

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

// ---------------------------------------------------------------------------
// Filter model + the favourites convention
// ---------------------------------------------------------------------------

export {
  /** Reserved tag used as the starred flag (see filters.ts for the rationale). */
  FAVOURITE_TAG,
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
  DEFAULT_DOC_TITLE,
  SCENE_SAVE_DEBOUNCE_MS,
} from "./store";
