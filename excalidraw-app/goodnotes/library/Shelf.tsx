/**
 * The home shelf: browse, search, sort, filter and manage documents.
 *
 * Rendered *instead of* the Excalidraw editor (see INTEGRATION.md) — it is a
 * full-viewport screen, not an overlay.
 *
 * Accessibility contract honoured here:
 *  - every card is a real <button> with a descriptive aria-label
 *  - roving tabindex across the card grid, with Arrow/Home/End navigation
 *  - every icon-only button carries an accessible name
 *  - visible focus rings (never `outline: none` without a replacement)
 *  - `prefers-reduced-motion: reduce` disables transitions (in Shelf.scss)
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

import "./Shelf.scss";

import type { DocMeta, SortKey } from "../types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** "Due soon" window. */
const SOON_MS = 48 * HOUR;

export type DueUrgency = "overdue" | "soon" | "upcoming" | "none";

export interface ShelfProps {
  /** Called when the user activates a card or creates a document. */
  onOpenDocument: (doc: DocMeta) => void;
  /** Drives the dark-theme CSS custom properties. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Optional slot rendered at the far right of the header (e.g. a menu). */
  headerExtra?: React.ReactNode;
  className?: string;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "dueDate", label: "Due date" },
  { value: "updatedAt", label: "Last edited" },
  { value: "title", label: "Title" },
  { value: "course", label: "Course" },
];

// ---------------------------------------------------------------------------
// pure helpers (exported for reuse/testing)
// ---------------------------------------------------------------------------

export const getDueUrgency = (
  dueDate: number | null,
  now: number = Date.now(),
): DueUrgency => {
  if (dueDate == null) {
    return "none";
  }
  if (dueDate < now) {
    return "overdue";
  }
  if (dueDate - now <= SOON_MS) {
    return "soon";
  }
  return "upcoming";
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export const formatDueDate = (
  dueDate: number | null,
  now: number = Date.now(),
): string => {
  if (dueDate == null) {
    return "No due date";
  }
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfDue = new Date(dueDate).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDue - startOfToday) / DAY);
  if (days === 0) {
    return "Due today";
  }
  if (days === 1) {
    return "Due tomorrow";
  }
  if (days === -1) {
    return "Due yesterday";
  }
  if (days < 0) {
    return `${Math.abs(days)} days overdue`;
  }
  if (days <= 7) {
    return `Due in ${days} days`;
  }
  return `Due ${dateFormatter.format(dueDate)}`;
};

export const formatUpdatedAt = (
  updatedAt: number,
  now: number = Date.now(),
): string => {
  const diff = Math.max(0, now - updatedAt);
  if (diff < HOUR) {
    const minutes = Math.floor(diff / 60000);
    return minutes <= 1 ? "Edited just now" : `Edited ${minutes} min ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `Edited ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return `Edited ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return `Edited ${dateFormatter.format(updatedAt)}`;
};

/** Stable 0-359 hue from a document id, for the placeholder cover. */
const hueFromId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360000;
  }
  return hash % 360;
};

const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("") || "?";

const matchesQuery = (doc: DocMeta, query: string): boolean => {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  return (
    doc.title.toLowerCase().includes(needle) ||
    (doc.course ?? "").toLowerCase().includes(needle) ||
    doc.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
};

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

const toDateInputValue = (timestamp: number | null): string => {
  if (timestamp == null) {
    return "";
  }
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const fromDateInputValue = (value: string): number | null => {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  // end of the chosen day, local time — "due Friday" means Friday night
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
};

// ---------------------------------------------------------------------------
// icons (decorative — every button has a text/aria label of its own)
// ---------------------------------------------------------------------------

const Icon = ({ path }: { path: string }) => (
  <svg
    className="gn-icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={path} />
  </svg>
);

const ICON_PLUS = "M12 5v14M5 12h14";
const ICON_PENCIL = "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z";
const ICON_COPY =
  "M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM5 15V5a2 2 0 0 1 2-2h10";
const ICON_TRASH = "M4 7h16M10 7V5h4v2m-7 0 1 13h8l1-13";
const ICON_SEARCH = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4";
const ICON_CLOSE = "M6 6l12 12M18 6L6 18";
const ICON_CHECK = "M5 13l4 4L19 7";

// ---------------------------------------------------------------------------
// card
// ---------------------------------------------------------------------------

interface ShelfCardProps {
  doc: DocMeta;
  now: number;
  tabIndex: number;
  isEditing: boolean;
  onOpen: (doc: DocMeta) => void;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onDuplicate: (doc: DocMeta) => void;
  onDelete: (doc: DocMeta) => void;
  onRename: (id: string, title: string) => void;
  onSetCourse: (id: string, course: string | null) => void;
  onSetDueDate: (id: string, dueDate: number | null) => void;
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  onFocusCard: (id: string) => void;
  registerRef: (id: string, node: HTMLButtonElement | null) => void;
}

const ShelfCard = React.memo((props: ShelfCardProps) => {
  const {
    doc,
    now,
    tabIndex,
    isEditing,
    onOpen,
    onStartEdit,
    onStopEdit,
    onDuplicate,
    onDelete,
    onRename,
    onSetCourse,
    onSetDueDate,
    onAddTag,
    onRemoveTag,
    onFocusCard,
    registerRef,
  } = props;

  const urgency = getDueUrgency(doc.dueDate, now);
  const dueLabel = formatDueDate(doc.dueDate, now);
  const updatedLabel = formatUpdatedAt(doc.updatedAt, now);
  const fieldId = useId();
  const [tagDraft, setTagDraft] = useState("");

  const ariaLabel = [
    `Open ${doc.title}`,
    doc.course ? `course ${doc.course}` : null,
    doc.dueDate != null ? dueLabel.toLowerCase() : "no due date",
    `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`,
    doc.tags.length ? `tags ${doc.tags.join(", ")}` : null,
    updatedLabel.toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="gn-card-wrapper">
      <div className={`gn-card${isEditing ? " gn-card--editing" : ""}`}>
        <button
          type="button"
          className="gn-card__open"
          ref={(node) => registerRef(doc.id, node)}
          tabIndex={tabIndex}
          aria-label={ariaLabel}
          onFocus={() => onFocusCard(doc.id)}
          onClick={() => onOpen(doc)}
        >
          <span className="gn-card__cover" aria-hidden="true">
            {doc.thumbnail ? (
              <img
                className="gn-card__thumb"
                src={doc.thumbnail}
                alt=""
                draggable={false}
              />
            ) : (
              <span
                className="gn-card__placeholder"
                style={
                  {
                    "--gn-hue": `${hueFromId(doc.id)}`,
                  } as React.CSSProperties
                }
              >
                <span className="gn-card__placeholder-initials">
                  {initialsOf(doc.title)}
                </span>
              </span>
            )}
            <span className="gn-card__pages">
              {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
            </span>
          </span>

          <span className="gn-card__body">
            <span className="gn-card__title">{doc.title}</span>
            <span className="gn-card__course">{doc.course || "No course"}</span>
            <span className={`gn-due gn-due--${urgency}`}>
              <span className="gn-due__dot" aria-hidden="true" />
              {dueLabel}
            </span>
            {doc.tags.length > 0 && (
              <span className="gn-card__tags">
                {doc.tags.slice(0, 4).map((tag) => (
                  <span className="gn-chip" key={tag}>
                    {tag}
                  </span>
                ))}
                {doc.tags.length > 4 && (
                  <span className="gn-chip gn-chip--more">
                    +{doc.tags.length - 4}
                  </span>
                )}
              </span>
            )}
            <span className="gn-card__updated">{updatedLabel}</span>
          </span>
        </button>

        <div className="gn-card__actions">
          <button
            type="button"
            className="gn-icon-button"
            tabIndex={tabIndex}
            aria-expanded={isEditing}
            aria-label={
              isEditing
                ? `Close details for ${doc.title}`
                : `Edit details for ${doc.title}`
            }
            onClick={() => (isEditing ? onStopEdit() : onStartEdit(doc.id))}
          >
            <Icon path={isEditing ? ICON_CLOSE : ICON_PENCIL} />
          </button>
          <button
            type="button"
            className="gn-icon-button"
            tabIndex={tabIndex}
            aria-label={`Duplicate ${doc.title}`}
            onClick={() => onDuplicate(doc)}
          >
            <Icon path={ICON_COPY} />
          </button>
          <button
            type="button"
            className="gn-icon-button gn-icon-button--danger"
            tabIndex={tabIndex}
            aria-label={`Delete ${doc.title}`}
            onClick={() => onDelete(doc)}
          >
            <Icon path={ICON_TRASH} />
          </button>
        </div>

        {isEditing && (
          <div className="gn-card__editor">
            <label className="gn-field" htmlFor={`${fieldId}-title`}>
              <span className="gn-field__label">Title</span>
              <input
                id={`${fieldId}-title`}
                className="gn-input"
                type="text"
                defaultValue={doc.title}
                onBlur={(event) => onRename(doc.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onRename(doc.id, event.currentTarget.value);
                    onStopEdit();
                  }
                }}
              />
            </label>

            <label className="gn-field" htmlFor={`${fieldId}-course`}>
              <span className="gn-field__label">Course</span>
              <input
                id={`${fieldId}-course`}
                className="gn-input"
                type="text"
                defaultValue={doc.course ?? ""}
                placeholder="e.g. Biology 201"
                onBlur={(event) => onSetCourse(doc.id, event.target.value)}
              />
            </label>

            <label className="gn-field" htmlFor={`${fieldId}-due`}>
              <span className="gn-field__label">Due date</span>
              <input
                id={`${fieldId}-due`}
                className="gn-input"
                type="date"
                defaultValue={toDateInputValue(doc.dueDate)}
                onChange={(event) =>
                  onSetDueDate(doc.id, fromDateInputValue(event.target.value))
                }
              />
            </label>

            <div className="gn-field">
              <span className="gn-field__label" id={`${fieldId}-tags-label`}>
                Tags
              </span>
              <ul
                className="gn-card__tag-editor"
                aria-labelledby={`${fieldId}-tags-label`}
              >
                {doc.tags.map((tag) => (
                  <li key={tag}>
                    <span className="gn-chip gn-chip--editable">
                      {tag}
                      <button
                        type="button"
                        className="gn-chip__remove"
                        aria-label={`Remove tag ${tag} from ${doc.title}`}
                        onClick={() => onRemoveTag(doc.id, tag)}
                      >
                        <Icon path={ICON_CLOSE} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="gn-card__tag-add">
                <input
                  className="gn-input"
                  type="text"
                  value={tagDraft}
                  placeholder="Add a tag"
                  aria-label={`Add a tag to ${doc.title}`}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && tagDraft.trim()) {
                      event.preventDefault();
                      onAddTag(doc.id, tagDraft);
                      setTagDraft("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="gn-icon-button"
                  aria-label={`Add tag to ${doc.title}`}
                  disabled={!tagDraft.trim()}
                  onClick={() => {
                    onAddTag(doc.id, tagDraft);
                    setTagDraft("");
                  }}
                >
                  <Icon path={ICON_CHECK} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </li>
  );
});
ShelfCard.displayName = "ShelfCard";

// ---------------------------------------------------------------------------
// shelf
// ---------------------------------------------------------------------------

export const Shelf = ({
  onOpenDocument,
  theme = "light",
  headerExtra,
  className,
}: ShelfProps) => {
  const { documents, loading, error, courses, actions } = useDocuments();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const controlsId = useId();
  const gridRef = useRef<HTMLUListElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  // id of a card that should take DOM focus once it renders
  const pendingFocusRef = useRef<string | null>(null);

  // a single clock read per render keeps every badge mutually consistent
  const now = useMemo(() => Date.now(), [documents]);

  const visible = useMemo(() => {
    return documents
      .filter(
        (doc) =>
          matchesQuery(doc, query.trim()) &&
          (!courseFilter || doc.course === courseFilter),
      )
      .sort((a, b) => compareDocs(a, b, sortKey));
  }, [documents, query, courseFilter, sortKey]);

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

  /** Columns actually rendered, read back from layout (grid is responsive). */
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
    const doc = await actions.create({});
    await actions.touch(doc.id);
    onOpenDocument(doc);
  }, [actions, onOpenDocument]);

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

  const handleDelete = useCallback(
    (doc: DocMeta) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Delete “${doc.title}”? This cannot be undone.`)) {
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
    },
    [actions, visible, editingId],
  );

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
  const handleFocusCard = useCallback((id: string) => {
    setActiveId(id);
  }, []);
  const handleStopEdit = useCallback(() => setEditingId(null), []);

  const hasAnyDocuments = documents.length > 0;

  return (
    <div
      className={`excalidraw${theme === "dark" ? " theme--dark" : ""} gn-shelf${
        className ? ` ${className}` : ""
      }`}
    >
      <header className="gn-shelf__header">
        <div className="gn-shelf__header-row">
          <h1 className="gn-shelf__heading">My documents</h1>
          <div className="gn-shelf__header-end">
            {headerExtra}
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
              value={courseFilter}
              onChange={(event) => setCourseFilter(event.target.value)}
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
            : `${visible.length} ${
                visible.length === 1 ? "document" : "documents"
              } shown`}
        </p>

        {error && (
          <div className="gn-notice gn-notice--error" role="alert">
            Could not read your document library: {error.message}
          </div>
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
              Create your first notebook or assignment. Everything stays on this
              device until you share it.
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
              Nothing matches your search and filters.
            </p>
            <button
              type="button"
              className="gn-button"
              onClick={() => {
                setQuery("");
                setCourseFilter("");
              }}
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <ul
            className="gn-grid"
            ref={gridRef}
            aria-label="Documents"
            onKeyDown={onGridKeyDown}
          >
            {visible.map((doc) => (
              <ShelfCard
                key={doc.id}
                doc={doc}
                now={now}
                tabIndex={doc.id === activeId ? 0 : -1}
                isEditing={editingId === doc.id}
                onOpen={handleOpen}
                onStartEdit={setEditingId}
                onStopEdit={handleStopEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onRename={handleRename}
                onSetCourse={handleSetCourse}
                onSetDueDate={handleSetDueDate}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onFocusCard={handleFocusCard}
                registerRef={registerRef}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Shelf;
