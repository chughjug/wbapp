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

import React, { useEffect, useState } from "react";

import { formatBytes } from "./format";
import { filterId, filterLabel } from "./filters";
import { hexToRgbChannels } from "./courses";
import {
  Icon,
  ICON_CALENDAR,
  ICON_CLOCK,
  ICON_DATABASE,
  ICON_FILES,
  ICON_STAR,
} from "./icons";

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
  };
  courses: SidebarCourse[];
  /** Bumped whenever the library changes, so the storage estimate re-reads. */
  revision: number;
}

const SMART_FILTERS: { filter: LibraryFilter; icon: string }[] = [
  { filter: { kind: "all" }, icon: ICON_FILES },
  { filter: { kind: "favourites" }, icon: ICON_STAR },
  { filter: { kind: "recent" }, icon: ICON_CLOCK },
  { filter: { kind: "due-week" }, icon: ICON_CALENDAR },
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

export const Sidebar = ({
  filter,
  onSelectFilter,
  counts,
  courses,
  revision,
}: SidebarProps) => {
  const estimate = useStorageEstimate(revision);
  const activeId = filterId(filter);

  const countFor = (candidate: LibraryFilter): number => {
    switch (candidate.kind) {
      case "favourites":
        return counts.favourites;
      case "recent":
        return counts.recent;
      case "due-week":
        return counts.dueWeek;
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
      {courses.length === 0 ? (
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
                estimate.quota ? ` of ${formatBytes(estimate.quota)} available` : ""
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
