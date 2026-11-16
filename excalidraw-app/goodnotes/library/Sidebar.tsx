/**
 * The library's left sidebar: smart filters, the course list, and a storage
 * line.
 *
 * Accessibility: a `<nav>` holding real `<ul>` lists of `<button>`s. The
 * selected filter carries `aria-current="true"` (and a visible active
 * treatment that is not colour alone — it also gets a weight change and an
 * inline start bar). Each course row shows its colour dot *next to its name*,
 * never instead of it, and the dot is `aria-hidden`.
 */

import React, { useEffect, useMemo, useState } from "react";

import { formatBytes } from "./format";
import { filterId, filterLabel } from "./filters";
import { hexToRgbChannels, resolveCourseStyle } from "./courses";
import {
  Icon,
  ICON_ARCHIVE,
  ICON_CALENDAR,
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_RIGHT,
  ICON_CLOCK,
  ICON_DATABASE,
  ICON_FILES,
  ICON_PENCIL,
  ICON_STAR,
  ICON_TAG,
  ICON_TRASH,
} from "./icons";

import type { CourseNode } from "./coursePath";
import type { TagCount } from "./tags";
import type { CourseStyle } from "./courses";
import type { LibraryFilter } from "./filters";

export interface SidebarCourse {
  name: string;
  count: number;
  style: CourseStyle;
}

export interface SidebarProps {
  filter: LibraryFilter;
  onSelectFilter: (filter: LibraryFilter) => void;
  counts: {
    all: number;
    favourites: number;
    recent: number;
    dueWeek: number;
    /** Archived documents. Omitted renders the Archived row with 0. */
    archived?: number;
  };
  /** Flat course list; used only when `courseTree` is not supplied. */
  courses: SidebarCourse[];
  /** Nested courses. When given, the course list renders as a tree. */
  courseTree?: CourseNode[];
  /** Resolved style for any course path in the tree. */
  courseStyleOf?: (course: string) => CourseStyle;
  /** Distinct user tags with counts. Reserved flags must already be gone. */
  tags?: TagCount[];
  /** Request a rename of a course *and its sub-courses*. */
  onRenameCourse?: (course: string) => void;
  /** Request clearing a course from its documents (deletes no document). */
  onRemoveCourse?: (course: string) => void;
  onRenameTag?: (tag: string) => void;
  onDeleteTag?: (tag: string) => void;
  /** Bumped whenever the library changes, so the storage estimate re-reads. */
  revision: number;
}

const SMART_FILTERS: { filter: LibraryFilter; icon: string }[] = [
  { filter: { kind: "all" }, icon: ICON_FILES },
  { filter: { kind: "favourites" }, icon: ICON_STAR },
  { filter: { kind: "recent" }, icon: ICON_CLOCK },
  { filter: { kind: "due-week" }, icon: ICON_CALENDAR },
  { filter: { kind: "archived" }, icon: ICON_ARCHIVE },
];

const useStorageEstimate = (revision: number) => {
  const [estimate, setEstimate] = useState<{
    usage: number;
    quota: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.storage?.estimate) {
      return undefined;
    }
    void navigator.storage
      .estimate()
      .then((result) => {
        if (!cancelled) {
          setEstimate({ usage: result.usage ?? 0, quota: result.quota ?? 0 });
        }
      })
      .catch(() => {
        /* storage estimation is a nicety; never break the shelf over it */
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  return estimate;
};

// ---------------------------------------------------------------------------
// course tree
// ---------------------------------------------------------------------------

const CourseTreeRow = ({
  node,
  activeId,
  expanded,
  onToggleExpanded,
  onSelectFilter,
  styleOf,
  onRenameCourse,
  onRemoveCourse,
}: {
  node: CourseNode;
  activeId: string;
  expanded: Set<string>;
  onToggleExpanded: (path: string) => void;
  onSelectFilter: (filter: LibraryFilter) => void;
  styleOf: (course: string) => CourseStyle;
  onRenameCourse?: (course: string) => void;
  onRemoveCourse?: (course: string) => void;
}) => {
  const candidate: LibraryFilter = { kind: "course", course: node.path };
  const isActive = filterId(candidate) === activeId;
  const hasChildren = node.children.length > 0;
  const isOpen = !expanded.has(node.path);
  const style = styleOf(node.path);
  const childrenId = `gn-course-children-${node.path.replace(
    /[^a-z0-9]/gi,
    "-",
  )}`;

  return (
    <li>
      <div className="gn-sidebar__row">
        {hasChildren ? (
          <button
            type="button"
            className="gn-sidebar__twisty"
            aria-expanded={isOpen}
            aria-controls={childrenId}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.label}`}
            onClick={() => onToggleExpanded(node.path)}
          >
            <Icon path={isOpen ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT} />
          </button>
        ) : (
          <span className="gn-sidebar__twisty gn-sidebar__twisty--empty" />
        )}
        <button
          type="button"
          className={`gn-sidebar__item${
            isActive ? " gn-sidebar__item--active" : ""
          }`}
          aria-current={isActive ? "true" : undefined}
          onClick={() => onSelectFilter(candidate)}
        >
          <span
            className="gn-sidebar__dot"
            aria-hidden="true"
            style={
              {
                "--gn-course-rgb": hexToRgbChannels(style.color),
              } as React.CSSProperties
            }
          >
            {style.emoji ? (
              <span className="gn-sidebar__dot-emoji">{style.emoji}</span>
            ) : null}
          </span>
          <span className="gn-sidebar__label">{node.label}</span>
          <span className="gn-sidebar__count" aria-hidden="true">
            {node.totalCount}
          </span>
          <span className="gn-sr-only">
            {`${node.totalCount} ${
              node.totalCount === 1 ? "document" : "documents"
            }${hasChildren ? ", including sub-courses" : ""}`}
          </span>
        </button>
        {onRenameCourse && (
          <button
            type="button"
            className="gn-icon-button gn-sidebar__rowaction"
            aria-label={`Rename course ${node.label}${
              hasChildren ? " and its sub-courses" : ""
            }`}
            onClick={() => onRenameCourse(node.path)}
          >
            <Icon path={ICON_PENCIL} />
          </button>
        )}
        {onRemoveCourse && (
          <button
            type="button"
            className="gn-icon-button gn-sidebar__rowaction"
            aria-label={`Remove course ${node.label} from its documents`}
            onClick={() => onRemoveCourse(node.path)}
          >
            <Icon path={ICON_TRASH} />
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul
          className="gn-sidebar__list gn-sidebar__list--nested"
          id={childrenId}
        >
          {node.children.map((child) => (
            <CourseTreeRow
              key={child.path}
              node={child}
              activeId={activeId}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              onSelectFilter={onSelectFilter}
              styleOf={styleOf}
              onRenameCourse={onRenameCourse}
              onRemoveCourse={onRemoveCourse}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export const Sidebar = ({
  filter,
  onSelectFilter,
  counts,
  courses,
  courseTree,
  courseStyleOf,
  tags,
  onRenameCourse,
  onRemoveCourse,
  onRenameTag,
  onDeleteTag,
  revision,
}: SidebarProps) => {
  const estimate = useStorageEstimate(revision);
  const activeId = filterId(filter);
  // stores *collapsed* paths, so a newly created sub-course is visible
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

  const styleOf = useMemo(
    () =>
      courseStyleOf ??
      ((course: string) => {
        const match = courses.find((it) => it.name === course);
        return match ? match.style : resolveCourseStyle(course, {});
      }),
    [courseStyleOf, courses],
  );

  const countFor = (candidate: LibraryFilter): number => {
    switch (candidate.kind) {
      case "favourites":
        return counts.favourites;
      case "recent":
        return counts.recent;
      case "due-week":
        return counts.dueWeek;
      case "archived":
        return counts.archived ?? 0;
      case "all":
      default:
        return counts.all;
    }
  };

  const percent =
    estimate && estimate.quota > 0
      ? Math.min(100, Math.round((estimate.usage / estimate.quota) * 1000) / 10)
      : null;

  return (
    <nav className="gn-sidebar" aria-label="Library filters">
      <ul className="gn-sidebar__list">
        {SMART_FILTERS.map(({ filter: candidate, icon }) => {
          const id = filterId(candidate);
          const label = filterLabel(candidate);
          const count = countFor(candidate);
          const isActive = id === activeId;
          return (
            <li key={id}>
              <button
                type="button"
                className={`gn-sidebar__item${
                  isActive ? " gn-sidebar__item--active" : ""
                }`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelectFilter(candidate)}
              >
                <span className="gn-sidebar__icon">
                  <Icon path={icon} filled={candidate.kind === "favourites"} />
                </span>
                <span className="gn-sidebar__label">{label}</span>
                <span className="gn-sidebar__count" aria-hidden="true">
                  {count}
                </span>
                <span className="gn-sr-only">
                  {`${count} ${count === 1 ? "document" : "documents"}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="gn-sidebar__section" id="gn-sidebar-courses">
        Courses
      </h2>
      {courseTree ? (
        courseTree.length === 0 ? (
          <p className="gn-sidebar__hint">
            Give a document a course and it will appear here. Use “ / ” to nest,
            e.g. MATH 221 / Problem sets.
          </p>
        ) : (
          <ul className="gn-sidebar__list" aria-labelledby="gn-sidebar-courses">
            {courseTree.map((node) => (
              <CourseTreeRow
                key={node.path}
                node={node}
                activeId={activeId}
                expanded={collapsed}
                onToggleExpanded={toggleExpanded}
                onSelectFilter={onSelectFilter}
                styleOf={styleOf}
                onRenameCourse={onRenameCourse}
                onRemoveCourse={onRemoveCourse}
              />
            ))}
          </ul>
        )
      ) : courses.length === 0 ? (
        <p className="gn-sidebar__hint">
          Give a document a course and it will appear here.
        </p>
      ) : (
        <ul className="gn-sidebar__list" aria-labelledby="gn-sidebar-courses">
          {courses.map((course) => {
            const candidate: LibraryFilter = {
              kind: "course",
              course: course.name,
            };
            const isActive = filterId(candidate) === activeId;
            return (
              <li key={course.name}>
                <button
                  type="button"
                  className={`gn-sidebar__item${
                    isActive ? " gn-sidebar__item--active" : ""
                  }`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelectFilter(candidate)}
                >
                  <span
                    className="gn-sidebar__dot"
                    aria-hidden="true"
                    style={
                      {
                        "--gn-course-rgb": hexToRgbChannels(course.style.color),
                      } as React.CSSProperties
                    }
                  >
                    {course.style.emoji ? (
                      <span className="gn-sidebar__dot-emoji">
                        {course.style.emoji}
                      </span>
                    ) : null}
                  </span>
                  <span className="gn-sidebar__label">{course.name}</span>
                  <span className="gn-sidebar__count" aria-hidden="true">
                    {course.count}
                  </span>
                  <span className="gn-sr-only">
                    {`${course.count} ${
                      course.count === 1 ? "document" : "documents"
                    }`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tags && (
        <>
          <h2 className="gn-sidebar__section" id="gn-sidebar-tags">
            Tags
          </h2>
          {tags.length === 0 ? (
            <p className="gn-sidebar__hint">
              Tag a document and the tag shows up here.
            </p>
          ) : (
            <ul className="gn-sidebar__list" aria-labelledby="gn-sidebar-tags">
              {tags.map((row) => {
                const candidate: LibraryFilter = { kind: "tag", tag: row.tag };
                const isActive = filterId(candidate) === activeId;
                return (
                  <li key={row.key}>
                    <div className="gn-sidebar__row">
                      <button
                        type="button"
                        className={`gn-sidebar__item${
                          isActive ? " gn-sidebar__item--active" : ""
                        }`}
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => onSelectFilter(candidate)}
                      >
                        <span className="gn-sidebar__icon">
                          <Icon path={ICON_TAG} />
                        </span>
                        <span className="gn-sidebar__label">{row.tag}</span>
                        <span className="gn-sidebar__count" aria-hidden="true">
                          {row.count}
                        </span>
                        <span className="gn-sr-only">
                          {`${row.count} ${
                            row.count === 1 ? "document" : "documents"
                          }`}
                        </span>
                      </button>
                      {onRenameTag && (
                        <button
                          type="button"
                          className="gn-icon-button gn-sidebar__rowaction"
                          aria-label={`Rename tag ${row.tag} across all documents`}
                          onClick={() => onRenameTag(row.tag)}
                        >
                          <Icon path={ICON_PENCIL} />
                        </button>
                      )}
                      {onDeleteTag && (
                        <button
                          type="button"
                          className="gn-icon-button gn-sidebar__rowaction"
                          aria-label={`Delete tag ${row.tag} from all ${row.count} documents`}
                          onClick={() => onDeleteTag(row.tag)}
                        >
                          <Icon path={ICON_TRASH} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="gn-sidebar__storage">
        <p className="gn-sidebar__storage-head">
          <span className="gn-sidebar__icon">
            <Icon path={ICON_DATABASE} />
          </span>
          Storage
        </p>
        {estimate ? (
          <>
            <div
              className="gn-sidebar__meter"
              role="img"
              aria-label={`${formatBytes(estimate.usage)} used${
                estimate.quota
                  ? ` of ${formatBytes(estimate.quota)} available`
                  : ""
              }`}
            >
              <span
                className="gn-sidebar__meter-fill"
                style={{ width: `${Math.max(percent ?? 0, 1)}%` }}
              />
            </div>
            <p className="gn-sidebar__storage-text">
              {formatBytes(estimate.usage)} used
              {estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ""}
            </p>
          </>
        ) : (
          <p className="gn-sidebar__storage-text">
            Everything is stored on this device.
          </p>
        )}
      </div>
    </nav>
  );
};

export default Sidebar;
