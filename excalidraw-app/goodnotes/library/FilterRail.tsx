/**
 * The horizontal filter rail: one scrollable row of chips that replaces the
 * permanently resident left sidebar.
 *
 * THE RULE THAT MAKES IT MINIMAL: a chip only exists when it would select a
 * set *different from the one already on screen*. "Selects something" is too
 * weak a test — with one notebook, "All 1" and "Recent 1" both select that
 * same single card, so a rail of All / Recent / Browse would be three
 * controls that do nothing a student could want. So: no favourites yet means
 * no Favourites chip; no courses means no course chips; nothing archived
 * means no Archived chip; and Recent only appears once it is a *proper*
 * subset (`0 < recent < all`). If none of those survive, the whole rail —
 * including All and Browse — does not render, because a one-row picker that
 * can only pick what you are already looking at is noise.
 *
 * On a first run the rail is therefore absent: the screen is the bar and the
 * notebooks, and not one pixel explains a feature the student has not used.
 * As they give notebooks courses and stars, the rail grows into the thing
 * they need, in the order they will reach for it.
 *
 * Browse is the rail's trailing chip and disappears with it, which costs
 * nothing: the drawer is always reachable from the ⋯ popover ("Browse
 * courses and tags…") whenever there is a document at all.
 *
 * Nothing is lost: the full index — every course (nested), every tag, their
 * rename/delete actions, archived, and the storage line — is one tap away in
 * the Browse drawer, which the trailing chip opens.
 *
 * Accessibility: a `<nav>` of real buttons with `aria-current="true"` on the
 * active one; the active state is a fill *and* a weight change, never colour
 * alone; the row scrolls horizontally but every chip is in the tab order and
 * `focus-visible` scrolls it into view through normal browser behaviour.
 */

import React from "react";

import { filterId, filterLabel } from "./filters";
import { hexToRgbChannels } from "./courses";
import { coursePathLabel } from "./coursePath";
import { Icon, ICON_LIST } from "./icons";

import type { CourseStyle } from "./courses";
import type { LibraryFilter } from "./filters";

export interface RailCourse {
  path: string;
  count: number;
  style: CourseStyle;
}

export interface FilterRailProps {
  filter: LibraryFilter;
  onSelectFilter: (filter: LibraryFilter) => void;
  counts: {
    all: number;
    favourites: number;
    recent: number;
    dueWeek: number;
    archived: number;
  };
  /** Top-level courses only; sub-courses live in the Browse drawer. */
  courses: readonly RailCourse[];
  /** Opens the full index. Rendered as the trailing chip. */
  onOpenBrowse: () => void;
  /** Tags, courses and management live here; the count labels the chip. */
  browseCount: number;
}

export const FilterRail = ({
  filter,
  onSelectFilter,
  counts,
  courses,
  onOpenBrowse,
  browseCount,
}: FilterRailProps) => {
  const activeId = filterId(filter);

  const smart: LibraryFilter[] = [];
  // "Recent" is only a filter when some documents are *not* recent
  if (counts.recent > 0 && counts.recent < counts.all) {
    smart.push({ kind: "recent" });
  }
  if (counts.favourites > 0) {
    smart.push({ kind: "favourites" });
  }
  if (counts.dueWeek > 0) {
    smart.push({ kind: "due-week" });
  }

  const chips: LibraryFilter[] = [...smart];
  if (counts.archived > 0) {
    chips.push({ kind: "archived" });
  }

  // the rail is not worth a row of the viewport until one of its chips can
  // show the student something other than what is already in front of them
  if (chips.length === 0 && courses.length === 0) {
    return null;
  }

  // a filter the user reached from the drawer (a tag, a sub-course) is not in
  // the rail — show it anyway, so the rail never lies about what is selected
  const extra: LibraryFilter[] =
    activeId === "all" ||
    chips.some((it) => filterId(it) === activeId) ||
    courses.some((it) => `course:${it.path}` === activeId)
      ? []
      : [filter];

  const chipFor = (candidate: LibraryFilter, count?: number) => {
    const id = filterId(candidate);
    const isActive = id === activeId;
    return (
      <li key={id}>
        <button
          type="button"
          className={`gn-chipnav${isActive ? " gn-chipnav--on" : ""}`}
          aria-current={isActive ? "true" : undefined}
          onClick={() => onSelectFilter(candidate)}
        >
          {filterLabel(candidate)}
          {count != null && (
            <span className="gn-chipnav__count" aria-hidden="true">
              {count}
            </span>
          )}
          {count != null && (
            <span className="gn-sr-only">
              {`, ${count} ${count === 1 ? "document" : "documents"}`}
            </span>
          )}
        </button>
      </li>
    );
  };

  const countOf = (candidate: LibraryFilter): number | undefined => {
    switch (candidate.kind) {
      case "recent":
        return counts.recent;
      case "favourites":
        return counts.favourites;
      case "due-week":
        return counts.dueWeek;
      case "archived":
        return counts.archived;
      default:
        return undefined;
    }
  };

  return (
    <nav className="gn-rail" aria-label="Filter notebooks">
      <ul className="gn-rail__list">
        <li>
          <button
            type="button"
            className={`gn-chipnav${
              activeId === "all" ? " gn-chipnav--on" : ""
            }`}
            aria-current={activeId === "all" ? "true" : undefined}
            onClick={() => onSelectFilter({ kind: "all" })}
          >
            All
            <span className="gn-chipnav__count" aria-hidden="true">
              {counts.all}
            </span>
            <span className="gn-sr-only">
              {`, ${counts.all} ${counts.all === 1 ? "document" : "documents"}`}
            </span>
          </button>
        </li>
        {smart.map((candidate) => chipFor(candidate, countOf(candidate)))}
        {courses.map((course) => {
          const candidate: LibraryFilter = {
            kind: "course",
            course: course.path,
          };
          const isActive = filterId(candidate) === activeId;
          return (
            <li key={course.path}>
              <button
                type="button"
                className={`gn-chipnav gn-chipnav--course${
                  isActive ? " gn-chipnav--on" : ""
                }`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelectFilter(candidate)}
              >
                <span
                  className="gn-course-dot"
                  aria-hidden="true"
                  style={
                    {
                      "--gn-course-rgb": hexToRgbChannels(course.style.color),
                    } as React.CSSProperties
                  }
                />
                {course.style.emoji ? `${course.style.emoji} ` : ""}
                {coursePathLabel(course.path)}
                <span className="gn-chipnav__count" aria-hidden="true">
                  {course.count}
                </span>
                <span className="gn-sr-only">
                  {`, ${course.count} ${
                    course.count === 1 ? "document" : "documents"
                  }, including sub-courses`}
                </span>
              </button>
            </li>
          );
        })}
        {counts.archived > 0 && chipFor({ kind: "archived" }, counts.archived)}
        {extra.map((candidate) => chipFor(candidate))}
        <li>
          <button
            type="button"
            className="gn-chipnav gn-chipnav--browse"
            onClick={onOpenBrowse}
            aria-label={`Browse all courses and tags, ${browseCount} in total`}
          >
            <Icon path={ICON_LIST} />
            Browse
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default FilterRail;
