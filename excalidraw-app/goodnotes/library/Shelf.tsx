/**
 * The home library: a document *manager*, not a flat grid.
 *
 * Layout
 *   [ sidebar ][ header: title + search + sort + view toggle + new ]
 *              [ course folders                                   ]
 *              [ grid of cover cards  |  dense list of rows       ]
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
  isDueThisWeek,
  isFavourite,
  isRecent,
  matchesFilter,
  matchesQuery,
} from "./filters";
import { ConfirmDialog } from "./ConfirmDialog";
import { CourseFolders } from "./CourseFolders";
import { DocumentCard } from "./DocumentCard";
import { DocumentRow } from "./DocumentRow";
import { Sidebar } from "./Sidebar";
import {
  Icon,
  ICON_CLOSE,
  ICON_GRID,
  ICON_LIST,
  ICON_PLUS,
  ICON_SEARCH,
} from "./icons";

import "./Shelf.scss";

import type { CourseFolder } from "./CourseFolders";
import type { LibraryFilter } from "./filters";
import type { SidebarCourse } from "./Sidebar";
import type { DocMeta, SortKey } from "../types";

// re-exported for API compatibility with the previous Shelf module
export {
  getDueUrgency,
  formatDueDate,
  formatUpdatedAt,
} from "./format";
export type { DueUrgency } from "./format";

export type LibraryView = "grid" | "list";

const VIEW_STORAGE_KEY = "goodnotes-library-view";

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
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "dueDate", label: "Due date" },
  { value: "updatedAt", label: "Last edited" },
  { value: "title", label: "Title" },
  { value: "course", label: "Course" },
];

const compareDocs = (a: DocMeta, b: DocMeta, sortKey: SortKey): number => {
  switch (sortKey) {
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

const readStoredView = (fallback: LibraryView): LibraryView => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "grid" || stored === "list" ? stored : fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------

export const Shelf = ({
  onOpenDocument,
  theme = "light",
  headerExtra,
  className,
  defaultView = "grid",
}: ShelfProps) => {
  const { documents, loading, error, courses, actions } = useDocuments();
  const courseStyles = useCourseStyles();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [filter, setFilter] = useState<LibraryFilter>(FILTER_ALL);
  const [view, setView] = useState<LibraryView>(() => readStoredView(defaultView));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocMeta | null>(null);

  const controlsId = useId();
  const gridRef = useRef<HTMLUListElement | null>(null);
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

  // one clock read per documents-change keeps every badge mutually consistent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [documents]);

  const counts = useMemo(
    () => ({
      all: documents.length,
      favourites: documents.filter(isFavourite).length,
      recent: documents.filter((doc) => isRecent(doc, now)).length,
      dueWeek: documents.filter((doc) => isDueThisWeek(doc, now)).length,
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

  // a filter whose course disappeared (last document moved/deleted) resets
  useEffect(() => {
    if (filter.kind === "course" && !courses.includes(filter.course)) {
      setFilter(FILTER_ALL);
    }
  }, [filter, courses]);

  const visible = useMemo(() => {
    return documents
      .filter(
        (doc) =>
          matchesQuery(doc, query.trim()) && matchesFilter(doc, filter, now),
      )
      .sort((a, b) => compareDocs(a, b, sortKey));
  }, [documents, query, filter, sortKey, now]);

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
    (index: number) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, index));
      const doc = visible[clamped];
      if (!doc) {
        return;
      }
      setActiveId(doc.id);
      cardRefs.current.get(doc.id)?.focus();
    },
    [visible],
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
    const items = [...grid.children] as HTMLElement[];
    if (items.length === 0) {
      return 1;
    }
    const firstTop = items[0].offsetTop;
    let columns = 0;
    for (const item of items) {
      if (item.offsetTop !== firstTop) {
        break;
      }
      columns++;
    }
    return Math.max(1, columns);
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
      focusByIndex(next);
    },
    [visible, activeId, getColumnCount, focusByIndex],
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

  const hasAnyDocuments = documents.length > 0;
  const heading = filterLabel(filter);
  const Item = view === "grid" ? DocumentCard : DocumentRow;

  const itemProps = (doc: DocMeta) => ({
    doc,
    now,
    tabIndex: doc.id === activeId ? 0 : -1,
    isEditing: editingId === doc.id,
    isFavourite: isFavourite(doc),
    courseStyle: doc.course ? courseStyles.styleOf(doc.course) : null,
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

  return (
    <div
      className={`excalidraw${theme === "dark" ? " theme--dark" : ""} gn-shelf${
        className ? ` ${className}` : ""
      }`}
    >
      <Sidebar
        filter={filter}
        onSelectFilter={setFilter}
        counts={counts}
        courses={sidebarCourses}
        revision={documents.length}
      />

      <div className="gn-shelf__main">
        <header className="gn-shelf__header">
          <div className="gn-shelf__header-row">
            <h1 className="gn-shelf__heading">{heading}</h1>
            <div className="gn-shelf__header-end">
              {headerExtra}
              <div
                className="gn-viewtoggle"
                role="group"
                aria-label="Document view"
              >
                <button
                  type="button"
                  className={`gn-icon-button${
                    view === "grid" ? " gn-icon-button--on" : ""
                  }`}
                  aria-pressed={view === "grid"}
                  aria-label="Grid view"
                  onClick={() => setView("grid")}
                >
                  <Icon path={ICON_GRID} />
                </button>
                <button
                  type="button"
                  className={`gn-icon-button${
                    view === "list" ? " gn-icon-button--on" : ""
                  }`}
                  aria-pressed={view === "list"}
                  aria-label="List view"
                  onClick={() => setView("list")}
                >
                  <Icon path={ICON_LIST} />
                </button>
              </div>
              <button
                type="button"
                className="gn-button gn-button--primary"
                onClick={() => void handleCreate()}
              >
                <Icon path={ICON_PLUS} />
                New document
              </button>
            </div>
          </div>

          <div className="gn-toolbar" role="search">
            <div className="gn-search">
              <span className="gn-search__icon" aria-hidden="true">
                <Icon path={ICON_SEARCH} />
              </span>
              <input
                id={`${controlsId}-search`}
                className="gn-input gn-search__input"
                type="search"
                value={query}
                placeholder="Search title, course or tag"
                aria-label="Search documents by title, course or tag"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="gn-icon-button gn-search__clear"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <Icon path={ICON_CLOSE} />
                </button>
              )}
            </div>

            <label className="gn-select-field" htmlFor={`${controlsId}-sort`}>
              <span className="gn-field__label">Sort by</span>
              <select
                id={`${controlsId}-sort`}
                className="gn-select"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="gn-select-field" htmlFor={`${controlsId}-course`}>
              <span className="gn-field__label">Course</span>
              <select
                id={`${controlsId}-course`}
                className="gn-select"
                value={filter.kind === "course" ? filter.course : ""}
                onChange={(event) =>
                  setFilter(
                    event.target.value
                      ? { kind: "course", course: event.target.value }
                      : FILTER_ALL,
                  )
                }
              >
                <option value="">All courses</option>
                {courses.map((course) => (
                  <option key={course} value={course}>
                    {course}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="gn-shelf__content">
          <p className="gn-sr-only" role="status" aria-live="polite">
            {loading
              ? "Loading documents"
              : `${heading}: ${visible.length} ${
                  visible.length === 1 ? "document" : "documents"
                } shown`}
          </p>

          {error && (
            <div className="gn-notice gn-notice--error" role="alert">
              Could not read your document library: {error.message}
            </div>
          )}

          {!loading && hasAnyDocuments && (
            <CourseFolders
              folders={folders}
              activeCourse={filter.kind === "course" ? filter.course : null}
              onOpenCourse={handleOpenCourse}
              onSetColor={handleSetCourseColor}
              onSetEmoji={handleSetCourseEmoji}
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
              {view === "list" && (
                <div className="gn-list__head" aria-hidden="true">
                  <span className="gn-list__head-thumb" />
                  <span>Title</span>
                  <span>Course</span>
                  <span>Due</span>
                  <span>Edited</span>
                </div>
              )}
              <ul
                className={view === "grid" ? "gn-grid" : "gn-list"}
                ref={gridRef}
                aria-label={`${heading}, ${
                  view === "grid" ? "grid" : "list"
                } view`}
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

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.title}”?`}
          body={
            <>
              This removes the document and all {pendingDelete.pageCount}{" "}
              {pendingDelete.pageCount === 1 ? "page" : "pages"} of its contents
              from this device. It cannot be undone.
            </>
          }
          confirmLabel="Delete document"
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
};

export default Shelf;
