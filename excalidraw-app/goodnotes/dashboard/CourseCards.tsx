/**
 * "Your courses" — quiet filter chips (colour + name), not card islands.
 *
 * Activating a chip selects that course in the library's own sidebar below
 * (see shelfBridge.ts), so the dashboard and the grid can never disagree
 * about which course is being shown.
 */

import React from "react";

import { urgencyLabel } from "./urgency";

import type { CourseSummary } from "./model";
import type { CourseStyle } from "../library";

export interface CourseCardsProps {
  summaries: readonly CourseSummary[];
  styleOf: (course: string) => CourseStyle;
  onSelectCourse: (course: string) => void;
  /** Show placeholders of the same height instead of cards. */
  loading?: boolean;
  headingId: string;
}

const countLabel = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const CourseCards = ({
  summaries,
  styleOf,
  onSelectCourse,
  loading = false,
  headingId,
}: CourseCardsProps) => {
  if (!loading && summaries.length === 0) {
    return null;
  }

  return (
    <section className="gn-dash__section" aria-labelledby={headingId}>
      <div className="gn-dash__section-head">
        <h2 className="gn-dash__h2" id={headingId}>
          Your courses
        </h2>
      </div>

      <ul className="gn-dash__course-rail">
        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              <li className="gn-dash__cell" key={index} aria-hidden="true">
                <div className="gn-dash__course-chip gn-dash__course-chip--skeleton">
                  <span className="gn-dash__sk gn-dash__sk--chip" />
                </div>
              </li>
            ))
          : summaries.map((summary) => {
              const style = styleOf(summary.course);
              const notebooks = countLabel(
                summary.notebookCount,
                "notebook",
                "notebooks",
              );
              const canvas = countLabel(
                summary.canvasCount,
                "Canvas assignment",
                "Canvas assignments",
              );
              const urgency = summary.urgency
                ? urgencyLabel(summary.urgency)
                : null;
              return (
                <li className="gn-dash__cell" key={summary.course}>
                  <button
                    type="button"
                    className="gn-dash__course-chip"
                    aria-label={`Show ${
                      summary.course
                    } in the library. ${notebooks}, ${canvas}${
                      urgency ? `, soonest ${urgency.toLowerCase()}` : ""
                    }.`}
                    onClick={() => onSelectCourse(summary.course)}
                  >
                    <span
                      className="gn-dash__dot"
                      aria-hidden="true"
                      style={{ backgroundColor: style.color }}
                    >
                      {style.emoji}
                    </span>
                    <span className="gn-dash__course-name">
                      {summary.course}
                    </span>
                    {urgency && summary.urgency && (
                      <span
                        className={`gn-dash__chip gn-dash__chip--${summary.urgency}`}
                      >
                        {urgency}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
      </ul>
    </section>
  );
};
