/**
 * The home screen: the notebooks, and almost nothing else.
 *
 * Layout
 *   [ title                          search  ⋯  + New ]   one 52px bar
 *   [ All · Recent · MATH 221 · … · Browse ]              only when non-empty
 *   [ the notebooks — first one double-size, "Continue" ]
 *
 * WHAT MOVED, AND WHY NOTHING WAS LOST
 * The previous screen rendered, permanently: a 15rem sidebar (five smart
 * filters with counters, a COURSES section, a TAGS section, a storage meter),
 * a title row, a view toggle, a New button, a search field, a Sort select, a
 * Course select, a row of course folder cards, and six action buttons on
 * every card. On a first run — one untitled notebook, nothing tagged, no
 * courses — most of that was empty-state prose about features the student has
 * never used, and the notebooks themselves got under a tenth of the screen.
 *
 * So: the sidebar and the course folders moved into the Browse drawer
 * (`BrowseDrawer`, which renders the very same `Sidebar` and `CourseFolders`
 * components, unchanged); sort, view, PDF import and "select several" moved
 * into one ⋯ popover; the Course select was dropped as a duplicate of the
 * course chips and the drawer; the six per-card buttons became one ⋯ menu per
 * card; and the filter rail only renders chips that would actually select
 * something, so a first run shows no rail at all.
 *
 * The default order is now *recently opened*, and the first card is rendered
 * double-size and badged "Continue", because the single most common reason a
 * student opens this screen is to get back into the notebook they were just
 * in.
 *
 * Accessibility contract honoured here:
 *  - the sidebar is a real list of buttons; the active one has aria-current
 *  - folder cards and document cards/rows are real focusable controls with
 *    composed accessible names; colour is never the only signal
 *  - roving tabindex across the document container, with Arrow/Home/End
 *    navigation whose row step is MEASURED from the live responsive layout
 *    (so it is correct in both grid and list, where the step is 1)
 *  - every icon-only button carries an accessible name
 *  - visible focus rings; `prefers-reduced-motion: reduce` honoured in SCSS
 *  - delete goes through an in-app modal, never `window.confirm`
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDocuments } from "./useDocuments";
import { useCourseStyles } from "./courses";
import {
  FILTER_ALL,
  filterLabel,
  isArchived,
  isDueThisWeek,
  isFavourite,
  hasUserTag,
  isInView,
  isPinned,
  isRecent,
  matchesQuery,
  visibleTags,
} from "./filters";
import {
  coursePathLabel,
  formatCoursePath,
  isInCourseTree,
  normalizeCoursePath,
} from "./coursePath";
import { useSelection } from "./selection";
import { queueThumbnails } from "./thumbnails";
import { SelectionBar } from "./SelectionBar";
import { PromptDialog } from "./PromptDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { DocumentCard } from "./DocumentCard";
import { fromDateInputValue } from "./DocumentEditor";
import { DocumentRow } from "./DocumentRow";
import { BrowseDrawer } from "./BrowseDrawer";
import { FilterRail } from "./FilterRail";
import { MenuButton, MenuGroup, MenuItem } from "./Popover";
import { ShelfThemeContext } from "./theme";
import {
  Icon,
  ICON_CHECK,
  ICON_LIST,
  ICON_MORE,
  ICON_PLUS,
  ICON_SEARCH,
} from "./icons";

import "./Shelf.scss";
import "./Home.scss";

import type { RailCourse } from "./FilterRail";
import type { CourseFolder } from "./CourseFolders";
import type { LibraryFilter } from "./filters";
import type { PromptDialogProps } from "./PromptDialog";
import type { SidebarCourse } from "./Sidebar";
import type { DocMeta, SortKey } from "../types";

// re-exported for API compatibility with the previous Shelf module
export { getDueUrgency, formatDueDate, formatUpdatedAt } from "./format";
export type { DueUrgency } from "./format";

export type LibraryView = "grid" | "list";

/**
 * The shelf's own sort keys. `SortKey` (goodnotes/types.ts) is the shared
 * contract and is not ours to widen, so the one order this screen actually
 * defaults to — *recently opened*, which is the whole point of a home screen
 * — is added locally. Nothing outside this module sees it: the sort lives in
 * component state and never reaches the store.
 */
export type ShelfSortKey = SortKey | "lastOpenedAt";

const VIEW_STORAGE_KEY = "goodnotes-library-view";
const SORT_STORAGE_KEY = "goodnotes-library-sort";

export interface ShelfProps {
  /** Called when the user activates a card or creates a document. */
  onOpenDocument: (doc: DocMeta) => void;
  /** Drives the dark-theme CSS custom properties. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Optional slot rendered at the far right of the header (e.g. a menu). */
  headerExtra?: React.ReactNode;
  className?: string;
  /** Initial view. Otherwise the last used view is restored. */
  defaultView?: LibraryView;
  /**
   * Extra controls for the ⋯ popover — host features that are neither the
   * library's business nor worth a permanent slot in the bar (the Canvas
   * connect invitation is the one in the app today). Rendered last, under a
   * separator.
   */
  menuExtra?: React.ReactNode;
}

const SORT_OPTIONS: { value: ShelfSortKey; label: string }[] = [
  { value: "lastOpenedAt", label: "Recently opened" },
  { value: "updatedAt", label: "Last edited" },
  { value: "dueDate", label: "Due date" },
  { value: "title", label: "Title" },
  { value: "course", label: "Course" },
];

/** When was this notebook last in front of the student? */
const lastTouched = (doc: DocMeta): number => doc.lastOpenedAt ?? doc.updatedAt;

/**
 * Pinned documents come first in every sort order — that is what pinning
 * means — and ties inside the pinned block fall through to the chosen sort.
 */
const comparePinnedFirst = (
  a: DocMeta,
  b: DocMeta,
  sortKey: ShelfSortKey,
): number => {
  const pinDelta = Number(isPinned(b)) - Number(isPinned(a));
  return pinDelta !== 0 ? pinDelta : compareDocs(a, b, sortKey);
};

const compareDocs = (a: DocMeta, b: DocMeta, sortKey: ShelfSortKey): number => {
  switch (sortKey) {
    case "lastOpenedAt":
      return lastTouched(b) - lastTouched(a);
    case "dueDate": {
      // documents without a due date sink to the bottom
      if (a.dueDate == null && b.dueDate == null) {
        return b.updatedAt - a.updatedAt;
      }
      if (a.dueDate == null) {
        return 1;
      }
      if (b.dueDate == null) {
        return -1;
      }
      return a.dueDate - b.dueDate;
    }
    case "title":
      return a.title.localeCompare(b.title);
    case "course": {
      const ac = a.course ?? "";
      const bc = b.course ?? "";
      if (ac === bc) {
        return a.title.localeCompare(b.title);
      }
      if (!ac) {
        return 1;
      }
      if (!bc) {
        return -1;
      }
      return ac.localeCompare(bc);
    }
    case "updatedAt":
    default:
      return b.updatedAt - a.updatedAt;
  }
};

/** Which one-field dialog is open, if any. */
type PromptState =
  | { kind: "bulk-course" }
  | { kind: "bulk-add-tag" }
  | { kind: "bulk-remove-tag" }
  | { kind: "bulk-due" }
  | { kind: "rename-tag"; tag: string }
  | { kind: "rename-course"; course: string };

/** Which destructive action is waiting on its single confirmation. */
type ConfirmState =
  | { kind: "delete-docs"; ids: string[] }
  | { kind: "delete-tag"; tag: string; count: number }
  | { kind: "remove-course"; course: string; count: number };

/** Copy + field configuration for each one-field dialog. */
const promptConfig = (
  state: PromptState,
  count: number,
  courseSuggestions: readonly string[],
  tagSuggestions: readonly string[],
  selectedTagSuggestions: readonly string[],
): Omit<PromptDialogProps, "onConfirm" | "onCancel"> => {
  const noun = `${count} ${count === 1 ? "document" : "documents"}`;
  switch (state.kind) {
    case "bulk-course":
      return {
        title: `Move ${noun} to a course`,
        label: "Course",
        description:
          "Use “ / ” to nest, e.g. MATH 221 / Problem sets. Leave empty to remove the course.",
        placeholder: "e.g. MATH 221 / Problem sets",
        suggestions: courseSuggestions,
        confirmLabel: "Move",
        allowEmpty: true,
      };
    case "bulk-add-tag":
      return {
        title: `Add a tag to ${noun}`,
        label: "Tag",
        placeholder: "e.g. exam",
        suggestions: tagSuggestions,
        confirmLabel: "Add tag",
      };
    case "bulk-remove-tag":
      return {
        title: `Remove a tag from ${noun}`,
        label: "Tag",
        suggestions: selectedTagSuggestions,
        confirmLabel: "Remove tag",
      };
    case "bulk-due":
      return {
        title: `Set a due date on ${noun}`,
        label: "Due date",
        description: "Leave empty to clear the due date.",
        kind: "date",
        confirmLabel: "Set due date",
        allowEmpty: true,
      };
    case "rename-tag":
      return {
        title: `Rename the tag “${state.tag}”`,
        label: "New tag name",
        description:
          "Every document carrying this tag is updated. Renaming onto an existing tag merges the two.",
        initialValue: state.tag,
        suggestions: tagSuggestions,
        confirmLabel: "Rename tag",
      };
    case "rename-course":
    default: {
      const course = (state as { course: string }).course;
      return {
        title: `Rename “${formatCoursePath(course)}”`,
        label: "Course path",
        description:
          "Sub-courses move with it: renaming a parent updates every nested course and every document inside them.",
        initialValue: formatCoursePath(course),
        suggestions: courseSuggestions,
        confirmLabel: "Rename course",
      };
    }
  }
};

const readStoredView = (fallback: LibraryView): LibraryView => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "grid" || stored === "list" ? stored : fallback;
  } catch {
    return fallback;
  }
};

const readStoredSort = (): ShelfSortKey => {
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_OPTIONS.some((it) => it.value === stored)
      ? (stored as ShelfSortKey)
      : "lastOpenedAt";
  } catch {
    return "lastOpenedAt";
  }
};

// ---------------------------------------------------------------------------

export const Shelf = ({
  onOpenDocument,
  theme = "light",
  headerExtra,
  className,
  defaultView = "grid",
  menuExtra,
}: ShelfProps) => {
  const { documents, loading, error, courses, courseTree, tags, actions } =
    useDocuments();
  const courseStyles = useCourseStyles();
  const selection = useSelection();

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ShelfSortKey>(readStoredSort);
  const [filter, setFilter] = useState<LibraryFilter>(FILTER_ALL);
  const [view, setView] = useState<LibraryView>(() =>
    readStoredView(defaultView),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocMeta | null>(null);
  /** One confirmation for a whole destructive action, however many rows. */
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  /** Last bulk action, announced politely once it has been applied. */
  const [announcement, setAnnouncement] = useState("");

  const controlsId = useId();
  const gridRef = useRef<HTMLUListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  // id of a card that should take DOM focus once it renders
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* private mode: the view simply does not persist */
    }
  }, [view]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, sortKey);
    } catch {
      /* private mode: the sort simply does not persist */
    }
  }, [sortKey]);

  // Search is revealed, not resident — so it needs a keyboard way in that is
  // as fast as the pointer one. "/" is the web-wide convention; Cmd/Ctrl+F is
  // what the rest of the app's users will reach for first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const wantsFind = (event.metaKey || event.ctrlKey) && event.key === "f";
      if (
        !wantsFind &&
        (typing || event.metaKey || event.ctrlKey || event.altKey)
      ) {
        return;
      }
      if (event.key === "/" || wantsFind) {
        event.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // one clock read per documents-change keeps every badge mutually consistent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [documents]);

  const counts = useMemo(
    () => ({
      all: documents.length,
      favourites: documents.filter(isFavourite).length,
      recent: documents.filter((doc) => isRecent(doc, now)).length,
      dueWeek: documents.filter((doc) => isDueThisWeek(doc, now)).length,
      archived: documents.filter(isArchived).length,
    }),
    [documents, now],
  );

  const courseRows = useMemo(() => {
    return courses.map((name) => {
      const docs = documents.filter((doc) => doc.course === name);
      return {
        name,
        count: docs.length,
        dueSoonCount: docs.filter((doc) => isDueThisWeek(doc, now)).length,
        style: courseStyles.styleOf(name),
      };
    });
  }, [courses, documents, now, courseStyles]);

  const sidebarCourses: SidebarCourse[] = courseRows;
  const folders: CourseFolder[] = courseRows;

  /**
   * Stable style object per course for this render pass — `styleOf` builds a
   * fresh object on every call, which would defeat `React.memo` on the cards.
   */
  const styleFor = useMemo(() => {
    const map = new Map(courseRows.map((row) => [row.name, row.style]));
    return (course: string | null) =>
      course ? map.get(course) ?? courseStyles.styleOf(course) : null;
  }, [courseRows, courseStyles]);

  // A filter whose subject disappeared (last document moved, tag deleted)
  // resets. For courses this must test the whole sub-tree, not the exact
  // string: "MATH 221" is a real, selectable node even when every document
  // lives in "MATH 221 / Problem sets".
  useEffect(() => {
    if (
      filter.kind === "course" &&
      !documents.some((doc) => isInCourseTree(doc.course, filter.course))
    ) {
      setFilter(FILTER_ALL);
    }
    if (
      filter.kind === "tag" &&
      !documents.some((doc) => hasUserTag(doc, filter.tag))
    ) {
      setFilter(FILTER_ALL);
    }
  }, [filter, documents]);

  const visible = useMemo(() => {
    return documents
      .filter(
        (doc) => matchesQuery(doc, query.trim()) && isInView(doc, filter, now),
      )
      .sort((a, b) => comparePinnedFirst(a, b, sortKey));
  }, [documents, query, filter, sortKey, now]);

  // Covers are generated here, from the scenes the library already owns,
  // because nothing else in the app ever generated one — see thumbnails.ts.
  // Only for what is on screen, one at a time, during idle time.
  useEffect(() => {
    if (loading || visible.length === 0) {
      return undefined;
    }
    return queueThumbnails(visible.slice(0, 40));
  }, [visible, loading]);

  /** Visible ids in visual order — the basis of every range selection. */
  const visibleIds = useMemo(() => visible.map((doc) => doc.id), [visible]);

  // a document that leaves the view (archived, moved, deleted) leaves the
  // selection with it, so a bulk action can never hit something off-screen
  useEffect(() => {
    selection.retain(visibleIds);
  }, [visibleIds, selection]);

  const selectedDocs = useMemo(
    () => visible.filter((doc) => selection.selected.has(doc.id)),
    [visible, selection],
  );
  const selectedIds = useMemo(
    () => selectedDocs.map((doc) => doc.id),
    [selectedDocs],
  );

  // keep the roving-tabindex anchor pointing at something that still exists
  useEffect(() => {
    if (visible.length === 0) {
      if (activeId !== null) {
        setActiveId(null);
      }
      return;
    }
    if (!activeId || !visible.some((doc) => doc.id === activeId)) {
      setActiveId(visible[0].id);
    }
  }, [visible, activeId]);

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id) {
      pendingFocusRef.current = null;
      cardRefs.current.get(id)?.focus();
    }
  });

  const registerRef = useCallback(
    (id: string, node: HTMLButtonElement | null) => {
      if (node) {
        cardRefs.current.set(id, node);
      } else {
        cardRefs.current.delete(id);
      }
    },
    [],
  );

  const focusByIndex = useCallback(
    (index: number, extendSelection = false) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, index));
      const doc = visible[clamped];
      if (!doc) {
        return;
      }
      setActiveId(doc.id);
      cardRefs.current.get(doc.id)?.focus();
      if (extendSelection) {
        // Shift+Arrow grows the selection from the anchor, like every file
        // manager; without an anchor the moved-to item becomes it.
        if (!selection.anchor) {
          selection.setAnchor(doc.id);
        }
        selection.extendRange(doc.id, visibleIds);
      }
    },
    [visible, visibleIds, selection],
  );

  /**
   * Columns actually rendered, read back from layout. The grid is responsive
   * (`auto-fill`) and the list is a single column, so this one measurement
   * gives the correct ArrowUp/ArrowDown step in both views.
   */
  const getColumnCount = useCallback((): number => {
    const grid = gridRef.current;
    if (!grid) {
      return 1;
    }
    // Counting items that share the first row stopped being correct once the
    // "Continue" card spans two tracks, so read the track count itself: it is
    // exact in both views (the list is not a grid, hence a step of 1) and
    // immune to any future item that spans.
    const style = window.getComputedStyle(grid);
    if (style.display !== "grid") {
      return 1;
    }
    const tracks = style.gridTemplateColumns
      .split(" ")
      .filter((it) => it && it !== "none").length;
    return Math.max(1, tracks);
  }, []);

  const onGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const target = event.target as HTMLElement;
      // don't hijack typing inside the inline detail editor
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "a" || event.key === "A")
      ) {
        event.preventDefault();
        selection.selectAll(visibleIds);
        setAnnouncement(
          `${visibleIds.length} ${
            visibleIds.length === 1 ? "document" : "documents"
          } selected`,
        );
        return;
      }
      if (event.key === "Escape" && selection.count > 0) {
        event.preventDefault();
        selection.clear();
        setAnnouncement("Selection cleared");
        return;
      }
      const currentIndex = visible.findIndex((doc) => doc.id === activeId);
      if (currentIndex < 0) {
        return;
      }
      const columns = getColumnCount();
      let next: number | null = null;
      switch (event.key) {
        case "ArrowRight":
          next = currentIndex + 1;
          break;
        case "ArrowLeft":
          next = currentIndex - 1;
          break;
        case "ArrowDown":
          next = currentIndex + columns;
          break;
        case "ArrowUp":
          next = currentIndex - columns;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = visible.length - 1;
          break;
        default:
          return;
      }
      if (next == null || next < 0 || next >= visible.length) {
        // keep focus where it is rather than wrapping unexpectedly
        event.preventDefault();
        return;
      }
      event.preventDefault();
      focusByIndex(next, event.shiftKey);
    },
    [visible, activeId, getColumnCount, focusByIndex, selection, visibleIds],
  );

  const handleCreate = useCallback(async () => {
    const init: Partial<DocMeta> =
      filter.kind === "course" ? { course: filter.course } : {};
    const doc = await actions.create(init);
    await actions.touch(doc.id);
    onOpenDocument(doc);
  }, [actions, onOpenDocument, filter]);

  const handleOpen = useCallback(
    (doc: DocMeta) => {
      void actions.touch(doc.id);
      onOpenDocument(doc);
    },
    [actions, onOpenDocument],
  );

  const handleDuplicate = useCallback(
    (doc: DocMeta) => {
      void actions.duplicate(doc.id).then((copy) => {
        pendingFocusRef.current = copy.id;
        setActiveId(copy.id);
      });
    },
    [actions],
  );

  const handleRequestDelete = useCallback((doc: DocMeta) => {
    setPendingDelete(doc);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    const doc = pendingDelete;
    setPendingDelete(null);
    if (!doc) {
      return;
    }
    const index = visible.findIndex((it) => it.id === doc.id);
    const neighbour = visible[index + 1] ?? visible[index - 1] ?? null;
    void actions.remove(doc.id).then(() => {
      if (neighbour) {
        pendingFocusRef.current = neighbour.id;
        setActiveId(neighbour.id);
      }
    });
    if (editingId === doc.id) {
      setEditingId(null);
    }
  }, [actions, visible, editingId, pendingDelete]);

  const handleRename = useCallback(
    (id: string, title: string) => {
      void actions.rename(id, title);
    },
    [actions],
  );
  const handleSetCourse = useCallback(
    (id: string, course: string | null) => {
      void actions.setCourse(id, course);
    },
    [actions],
  );
  const handleSetDueDate = useCallback(
    (id: string, dueDate: number | null) => {
      void actions.setDueDate(id, dueDate);
    },
    [actions],
  );
  const handleAddTag = useCallback(
    (id: string, tag: string) => {
      void actions.addTag(id, tag);
    },
    [actions],
  );
  const handleRemoveTag = useCallback(
    (id: string, tag: string) => {
      void actions.removeTag(id, tag);
    },
    [actions],
  );
  const handleToggleFavourite = useCallback(
    (doc: DocMeta) => {
      void actions.toggleFavourite(doc.id);
    },
    [actions],
  );
  const handleFocusCard = useCallback((id: string) => {
    setActiveId(id);
  }, []);
  const handleStopEdit = useCallback(() => setEditingId(null), []);

  const handleSetCourseColor = useCallback(
    (course: string, color: string) => {
      void courseStyles.setColor(course, color);
    },
    [courseStyles],
  );
  const handleSetCourseEmoji = useCallback(
    (course: string, emoji: string | null) => {
      void courseStyles.setEmoji(course, emoji);
    },
    [courseStyles],
  );
  const handleOpenCourse = useCallback((course: string) => {
    setFilter((current) =>
      current.kind === "course" && current.course === course
        ? FILTER_ALL
        : { kind: "course", course },
    );
  }, []);

  // ------------------------------------------------------------- selection

  const handleToggleSelect = useCallback(
    (id: string, modifiers: { shift: boolean; meta: boolean }) => {
      if (modifiers.shift) {
        selection.selectRange(id, visibleIds);
      } else if (modifiers.meta) {
        selection.toggle(id);
      } else {
        selection.selectOnly(id);
      }
      setActiveId(id);
    },
    [selection, visibleIds],
  );

  const handleSelectAll = useCallback(() => {
    selection.selectAll(visibleIds);
    setAnnouncement(
      `${visibleIds.length} ${
        visibleIds.length === 1 ? "document" : "documents"
      } selected`,
    );
  }, [selection, visibleIds]);

  const handleClearSelection = useCallback(() => {
    selection.clear();
    setAnnouncement("Selection cleared");
  }, [selection]);

  const bulkNoun = (count: number) =>
    `${count} ${count === 1 ? "document" : "documents"}`;

  const runBulk = useCallback(
    async (message: (count: number) => string, work: Promise<unknown>) => {
      const count = selectedIds.length;
      await work;
      setAnnouncement(message(count));
    },
    [selectedIds],
  );

  const handleBulkFavourite = useCallback(
    (next: boolean) => {
      void runBulk(
        (count) =>
          `${next ? "Added" : "Removed"} ${bulkNoun(count)} ${
            next ? "to" : "from"
          } favourites`,
        actions.bulkSetFavourite(selectedIds, next),
      );
    },
    [actions, runBulk, selectedIds],
  );

  const handleBulkPinned = useCallback(
    (next: boolean) => {
      void runBulk(
        (count) => `${next ? "Pinned" : "Unpinned"} ${bulkNoun(count)}`,
        actions.bulkSetPinned(selectedIds, next),
      );
    },
    [actions, runBulk, selectedIds],
  );

  const handleBulkArchived = useCallback(
    (next: boolean) => {
      void runBulk(
        (count) => `${next ? "Archived" : "Unarchived"} ${bulkNoun(count)}`,
        actions.bulkSetArchived(selectedIds, next),
      );
    },
    [actions, runBulk, selectedIds],
  );

  const handleBulkDuplicate = useCallback(() => {
    void runBulk(
      (count) => `Duplicated ${bulkNoun(count)}`,
      actions.bulkDuplicate(selectedIds),
    );
  }, [actions, runBulk, selectedIds]);

  const handleTogglePinned = useCallback(
    (doc: DocMeta) => {
      void actions.togglePinned(doc.id);
    },
    [actions],
  );

  const handleToggleArchived = useCallback(
    (doc: DocMeta) => {
      void actions.toggleArchived(doc.id).then((next) => {
        setAnnouncement(
          `${next.title} ${isArchived(next) ? "archived" : "unarchived"}`,
        );
      });
    },
    [actions],
  );

  const handleSelectTag = useCallback((tag: string) => {
    setFilter({ kind: "tag", tag });
  }, []);

  // ------------------------------------------------------- dialog plumbing

  const tagSuggestions = useMemo(() => tags.map((row) => row.tag), [tags]);
  const courseSuggestions = useMemo(
    () => courses.map((course) => formatCoursePath(course)),
    [courses],
  );
  /** Tags present on the current selection — the "remove tag" candidates. */
  const selectedTagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const doc of selectedDocs) {
      for (const tag of visibleTags(doc)) {
        set.add(tag);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [selectedDocs]);

  const handlePromptConfirm = useCallback(
    (value: string) => {
      const state = prompt;
      setPrompt(null);
      if (!state) {
        return;
      }
      const count = selectedIds.length;
      switch (state.kind) {
        case "bulk-course": {
          const course = normalizeCoursePath(value);
          void actions.bulkSetCourse(selectedIds, course).then(() => {
            setAnnouncement(
              course
                ? `Moved ${bulkNoun(count)} to ${formatCoursePath(course)}`
                : `Removed the course from ${bulkNoun(count)}`,
            );
          });
          break;
        }
        case "bulk-add-tag":
          void actions.bulkAddTag(selectedIds, value).then(() => {
            setAnnouncement(`Tagged ${bulkNoun(count)} with ${value.trim()}`);
          });
          break;
        case "bulk-remove-tag":
          void actions.bulkRemoveTag(selectedIds, value).then(() => {
            setAnnouncement(
              `Removed tag ${value.trim()} from ${bulkNoun(count)}`,
            );
          });
          break;
        case "bulk-due": {
          const dueDate = fromDateInputValue(value);
          void actions.bulkSetDueDate(selectedIds, dueDate).then(() => {
            setAnnouncement(
              dueDate == null
                ? `Cleared the due date on ${bulkNoun(count)}`
                : `Set a due date on ${bulkNoun(count)}`,
            );
          });
          break;
        }
        case "rename-tag":
          void actions.renameTag(state.tag, value).then((changed) => {
            setAnnouncement(
              `Renamed tag ${state.tag} to ${value.trim()} on ${bulkNoun(
                changed,
              )}`,
            );
            setFilter((current) =>
              current.kind === "tag" && current.tag === state.tag
                ? { kind: "tag", tag: value.trim() }
                : current,
            );
          });
          break;
        case "rename-course": {
          const target = normalizeCoursePath(value);
          if (!target) {
            break;
          }
          void actions.renameCourse(state.course, target).then((changed) => {
            setAnnouncement(
              `Renamed course to ${formatCoursePath(target)} on ${bulkNoun(
                changed,
              )}`,
            );
            setFilter((current) =>
              current.kind === "course" && current.course === state.course
                ? { kind: "course", course: target }
                : current,
            );
          });
          break;
        }
        default:
          break;
      }
    },
    [actions, prompt, selectedIds],
  );

  const handleConfirmDestructive = useCallback(() => {
    const state = confirming;
    setConfirming(null);
    if (!state) {
      return;
    }
    switch (state.kind) {
      case "delete-docs":
        void actions.bulkRemove(state.ids).then((removed) => {
          selection.clear();
          setAnnouncement(`Deleted ${bulkNoun(removed)}`);
        });
        break;
      case "delete-tag":
        void actions.deleteTag(state.tag).then((changed) => {
          setFilter((current) =>
            current.kind === "tag" && current.tag === state.tag
              ? FILTER_ALL
              : current,
          );
          setAnnouncement(`Deleted tag ${state.tag} from ${bulkNoun(changed)}`);
        });
        break;
      case "remove-course":
        void actions.removeCourse(state.course).then((changed) => {
          setAnnouncement(
            `Removed course ${coursePathLabel(state.course)} from ${bulkNoun(
              changed,
            )}`,
          );
        });
        break;
      default:
        break;
    }
  }, [actions, confirming, selection]);

  const docsInCourseTree = useCallback(
    (course: string) =>
      documents.filter(
        (doc) =>
          !!doc.course &&
          (doc.course === course || doc.course.startsWith(`${course}/`)),
      ).length,
    [documents],
  );

  const allSelectedFavourite =
    selectedDocs.length > 0 && selectedDocs.every(isFavourite);
  const allSelectedPinned =
    selectedDocs.length > 0 && selectedDocs.every(isPinned);
  const allSelectedArchived =
    selectedDocs.length > 0 && selectedDocs.every(isArchived);

  const hasAnyDocuments = documents.length > 0;
  const heading = filterLabel(filter);
  const Item = view === "grid" ? DocumentCard : DocumentRow;

  /** Top-level courses only — the rail is a shortcut, not the index. */
  const railCourses: RailCourse[] = useMemo(
    () =>
      (courseTree ?? []).map((node) => ({
        path: node.path,
        count: node.totalCount,
        style: courseStyles.styleOf(node.path),
      })),
    [courseTree, courseStyles],
  );

  /**
   * The notebook to get back into. Only ever the first card, only in the
   * default arrangement, and only when it really is the most recently opened
   * one — a pinned document sorts to the top in every order, and calling
   * *that* "Continue" would be a lie.
   */
  const heroId = useMemo(() => {
    if (
      sortKey !== "lastOpenedAt" ||
      view !== "grid" ||
      filter.kind !== "all" ||
      query.trim() ||
      visible.length === 0
    ) {
      return null;
    }
    // the only notebook there is gets the big card regardless — it is not
    // "continue" until it has been opened, but it is certainly the subject
    if (visible.length === 1) {
      return visible[0].id;
    }
    const opened = visible.filter((doc) => doc.lastOpenedAt != null);
    if (opened.length === 0) {
      return null;
    }
    const newest = opened.reduce((best, doc) =>
      lastTouched(doc) > lastTouched(best) ? doc : best,
    );
    return newest.id === visible[0].id ? newest.id : null;
  }, [sortKey, view, filter, query, visible]);

  const itemProps = (doc: DocMeta) => ({
    doc,
    now,
    tabIndex: doc.id === activeId ? 0 : -1,
    isEditing: editingId === doc.id,
    isFavourite: isFavourite(doc),
    isPinned: isPinned(doc),
    isArchived: isArchived(doc),
    isSelected: selection.selected.has(doc.id),
    selectionActive: selection.count > 0,
    onToggleSelect: handleToggleSelect,
    onSelectTag: handleSelectTag,
    onTogglePinned: handleTogglePinned,
    onToggleArchived: handleToggleArchived,
    tagSuggestions,
    courseSuggestions,
    isHero: doc.id === heroId,
    courseStyle: styleFor(doc.course),
    onOpen: handleOpen,
    onStartEdit: setEditingId,
    onStopEdit: handleStopEdit,
    onDuplicate: handleDuplicate,
    onDelete: handleRequestDelete,
    onRename: handleRename,
    onSetCourse: handleSetCourse,
    onSetDueDate: handleSetDueDate,
    onAddTag: handleAddTag,
    onRemoveTag: handleRemoveTag,
    onToggleFavourite: handleToggleFavourite,
    onFocusCard: handleFocusCard,
    registerRef,
  });

  const sidebarProps = {
    filter,
    onSelectFilter: setFilter,
    counts,
    courses: sidebarCourses,
    courseTree,
    courseStyleOf: courseStyles.styleOf,
    tags,
    onRenameCourse: (course: string) =>
      setPrompt({ kind: "rename-course", course }),
    onRemoveCourse: (course: string) =>
      setConfirming({
        kind: "remove-course",
        course,
        count: docsInCourseTree(course),
      }),
    onRenameTag: (tag: string) => setPrompt({ kind: "rename-tag", tag }),
    onDeleteTag: (tag: string) =>
      setConfirming({
        kind: "delete-tag",
        tag,
        count: tags.find((row) => row.tag === tag)?.count ?? 0,
      }),
    revision: documents.length,
  };

  return (
    <ShelfThemeContext.Provider value={theme}>
      <div
        className={`excalidraw${
          theme === "dark" ? " theme--dark" : ""
        } gn-shelf${className ? ` ${className}` : ""}`}
      >
        <div className="gn-shelf__main">
          <header className="gn-home__bar">
            {searchOpen || query ? (
              <div className="gn-home__search gn-search" role="search">
                <span className="gn-search__icon" aria-hidden="true">
                  <Icon path={ICON_SEARCH} />
                </span>
                <input
                  id={`${controlsId}-search`}
                  ref={searchRef}
                  className="gn-input gn-search__input"
                  type="search"
                  value={query}
                  autoFocus
                  placeholder="Search title, course or tag"
                  aria-label="Search documents by title, course or tag"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setQuery("");
                      setSearchOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="gn-button gn-button--small gn-search__done"
                  onClick={() => {
                    setQuery("");
                    setSearchOpen(false);
                  }}
                >
                  {query ? "Clear" : "Done"}
                </button>
              </div>
            ) : (
              <>
                <h1 className="gn-home__title">{heading}</h1>
                <div className="gn-home__bar-end">
                  <button
                    type="button"
                    className="gn-icon-button gn-home__iconbtn"
                    aria-label="Search documents"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Icon path={ICON_SEARCH} />
                  </button>

                  <MenuButton
                    label="Library options"
                    title="Library options"
                    role="dialog"
                    buttonClassName="gn-icon-button gn-home__iconbtn"
                    panelClassName="gn-popover--wide"
                    icon={<Icon path={ICON_MORE} filled />}
                  >
                    {(close) => (
                      <>
                        <MenuGroup label="Sort by">
                          {SORT_OPTIONS.map((option) => (
                            <MenuItem
                              key={option.value}
                              label={option.label}
                              checked={sortKey === option.value}
                              onClick={() => {
                                setSortKey(option.value);
                                close();
                              }}
                            />
                          ))}
                        </MenuGroup>
                        <MenuGroup label="View">
                          <MenuItem
                            label="Grid"
                            checked={view === "grid"}
                            onClick={() => {
                              setView("grid");
                              close();
                            }}
                          />
                          <MenuItem
                            label="List"
                            checked={view === "list"}
                            onClick={() => {
                              setView("list");
                              close();
                            }}
                          />
                        </MenuGroup>
                        {hasAnyDocuments && (
                          <div className="gn-menugroup">
                            <MenuItem
                              label="Browse courses and tags…"
                              icon={<Icon path={ICON_LIST} />}
                              onClick={() => {
                                setBrowseOpen(true);
                                close();
                              }}
                            />
                            {visible.length > 0 && (
                              <MenuItem
                                label="Select several…"
                                icon={<Icon path={ICON_CHECK} />}
                                onClick={() => {
                                  selection.toggle(visible[0].id);
                                  close();
                                }}
                              />
                            )}
                          </div>
                        )}
                        {(headerExtra || menuExtra) && (
                          <div className="gn-menugroup gn-menugroup--slot">
                            {headerExtra}
                            {menuExtra}
                          </div>
                        )}
                      </>
                    )}
                  </MenuButton>

                  <button
                    type="button"
                    className="gn-button gn-button--primary gn-home__new"
                    onClick={() => void handleCreate()}
                  >
                    <Icon path={ICON_PLUS} />
                    <span className="gn-home__new-label">New</span>
                  </button>
                </div>
              </>
            )}
          </header>

          <div className="gn-shelf__content">
            <p className="gn-sr-only" role="status" aria-live="polite">
              {loading
                ? "Loading documents"
                : `${heading}: ${visible.length} ${
                    visible.length === 1 ? "document" : "documents"
                  } shown${
                    selection.count > 0 ? `, ${selection.count} selected` : ""
                  }`}
            </p>
            <p className="gn-sr-only" role="status" aria-live="polite">
              {announcement}
            </p>

            {error && (
              <div className="gn-notice gn-notice--error" role="alert">
                Could not read your document library: {error.message}
              </div>
            )}

            {!loading && hasAnyDocuments && (
              <FilterRail
                filter={filter}
                onSelectFilter={setFilter}
                counts={counts}
                courses={railCourses}
                onOpenBrowse={() => setBrowseOpen(true)}
                browseCount={courses.length + tags.length}
              />
            )}

            {loading ? (
              <div className="gn-empty" aria-hidden="true">
                <p className="gn-empty__title">Loading your shelf…</p>
              </div>
            ) : !hasAnyDocuments ? (
              <div className="gn-empty">
                <div className="gn-empty__art" aria-hidden="true">
                  <span className="gn-empty__sheet" />
                  <span className="gn-empty__sheet" />
                  <span className="gn-empty__sheet" />
                </div>
                <h2 className="gn-empty__title">Your shelf is empty</h2>
                <p className="gn-empty__text">
                  Create your first notebook or assignment. Everything stays on
                  this device until you share it.
                </p>
                <button
                  type="button"
                  className="gn-button gn-button--primary"
                  onClick={() => void handleCreate()}
                >
                  <Icon path={ICON_PLUS} />
                  New document
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="gn-empty">
                <h2 className="gn-empty__title">No matching documents</h2>
                <p className="gn-empty__text">
                  Nothing in {heading} matches your search.
                </p>
                <button
                  type="button"
                  className="gn-button"
                  onClick={() => {
                    setQuery("");
                    setFilter(FILTER_ALL);
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            ) : (
              <>
                {selection.count > 0 && (
                  <SelectionBar
                    count={selection.count}
                    visibleCount={visible.length}
                    allVisibleSelected={selection.count === visible.length}
                    allFavourite={allSelectedFavourite}
                    allPinned={allSelectedPinned}
                    allArchived={allSelectedArchived}
                    onSelectAll={handleSelectAll}
                    onClear={handleClearSelection}
                    onMove={() => setPrompt({ kind: "bulk-course" })}
                    onAddTag={() => setPrompt({ kind: "bulk-add-tag" })}
                    onRemoveTag={() => setPrompt({ kind: "bulk-remove-tag" })}
                    onSetDueDate={() => setPrompt({ kind: "bulk-due" })}
                    onToggleFavourite={handleBulkFavourite}
                    onTogglePinned={handleBulkPinned}
                    onToggleArchived={handleBulkArchived}
                    onDuplicate={handleBulkDuplicate}
                    onDelete={() =>
                      setConfirming({ kind: "delete-docs", ids: selectedIds })
                    }
                  />
                )}
                {view === "list" && (
                  <div className="gn-list__head" aria-hidden="true">
                    <span className="gn-list__head-thumb" />
                    <span>Title</span>
                    <span>Course</span>
                    <span>Due</span>
                    <span>Edited</span>
                  </div>
                )}
                {/*
                role="grid" + aria-multiselectable is the one ARIA container
                that legitimately holds interactive children (each item is a
                row with a single gridcell), which a listbox/option pair does
                not. Roving tabindex and the measured row step are unchanged.
              */}
                <ul
                  className={view === "grid" ? "gn-grid" : "gn-list"}
                  ref={gridRef}
                  role="grid"
                  aria-multiselectable="true"
                  aria-label={`${heading}, ${
                    view === "grid" ? "grid" : "list"
                  } view, ${
                    selection.count
                  } selected. Press Space to select, Shift and arrow keys to extend.`}
                  onKeyDown={onGridKeyDown}
                >
                  {visible.map((doc) => (
                    <Item key={doc.id} {...itemProps(doc)} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {browseOpen && (
          <BrowseDrawer
            {...sidebarProps}
            onClose={() => setBrowseOpen(false)}
            folders={folders}
            activeCourse={filter.kind === "course" ? filter.course : null}
            onOpenCourse={(course: string) => {
              handleOpenCourse(course);
              setBrowseOpen(false);
            }}
            onSetColor={handleSetCourseColor}
            onSetEmoji={handleSetCourseEmoji}
          />
        )}

        {prompt && (
          <PromptDialog
            {...promptConfig(
              prompt,
              selectedIds.length,
              courseSuggestions,
              tagSuggestions,
              selectedTagSuggestions,
            )}
            onCancel={() => setPrompt(null)}
            onConfirm={handlePromptConfirm}
          />
        )}

        {confirming && (
          <ConfirmDialog
            title={
              confirming.kind === "delete-docs"
                ? `Delete ${confirming.ids.length} ${
                    confirming.ids.length === 1 ? "document" : "documents"
                  }?`
                : confirming.kind === "delete-tag"
                ? `Delete the tag “${confirming.tag}”?`
                : `Remove the course “${coursePathLabel(confirming.course)}”?`
            }
            body={
              confirming.kind === "delete-docs" ? (
                <>
                  This permanently removes {confirming.ids.length} documents and
                  all of their pages from this device. It cannot be undone.
                </>
              ) : confirming.kind === "delete-tag" ? (
                <>
                  The tag is removed from {confirming.count}{" "}
                  {confirming.count === 1 ? "document" : "documents"}. The
                  documents themselves are kept.
                </>
              ) : (
                <>
                  {confirming.count}{" "}
                  {confirming.count === 1 ? "document" : "documents"} in this
                  course and its sub-courses lose their course. No document is
                  deleted.
                </>
              )
            }
            confirmLabel={
              confirming.kind === "delete-docs"
                ? `Delete ${confirming.ids.length} ${
                    confirming.ids.length === 1 ? "document" : "documents"
                  }`
                : confirming.kind === "delete-tag"
                ? "Delete tag"
                : "Remove course"
            }
            onCancel={() => setConfirming(null)}
            onConfirm={handleConfirmDestructive}
          />
        )}

        {pendingDelete && (
          <ConfirmDialog
            title={`Delete “${pendingDelete.title}”?`}
            body={
              <>
                This removes the document and all {pendingDelete.pageCount}{" "}
                {pendingDelete.pageCount === 1 ? "page" : "pages"} of its
                contents from this device. It cannot be undone.
              </>
            }
            confirmLabel="Delete document"
            onCancel={() => setPendingDelete(null)}
            onConfirm={handleConfirmDelete}
          />
        )}
      </div>
    </ShelfThemeContext.Provider>
  );
};

export default Shelf;
