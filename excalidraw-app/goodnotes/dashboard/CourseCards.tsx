/**
 * "Your courses" — one card per Canvas course: how many notebooks you have,
 * how much Canvas work it carries, and how urgent the nearest piece is.
 *
 * Activating a card selects that course in the library's own sidebar below
 * (see shelfBridge.ts), so the dashboard and the grid can never disagree
 * about which course is being shown.
 *
 * NOTE ON "Canvas files": the mockup counts files. goodnotes/canvas pins
 * only four functions as stable, and none of them lists files, so this
 * counts the course's dated Canvas *assignments* instead and says so in the
 * label rather than mislabelling the number.
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

      <ul className="gn-dash__courses">
        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              <li className="gn-dash__cell" key={index} aria-hidden="true">
                <div className="gn-dash__course gn-dash__course--skeleton">
                  <span className="gn-dash__sk gn-dash__sk--title" />
                  <span className="gn-dash__sk gn-dash__sk--foot" />
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
                    className="gn-dash__course"
                    aria-label={`Show ${
                      summary.course
                    } in the library. ${notebooks}, ${canvas}${
                      urgency ? `, soonest ${urgency.toLowerCase()}` : ""
                    }.`}
                    onClick={() => onSelectCourse(summary.course)}
                  >
                    <span className="gn-dash__course-head">
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
                          <span
                            className="gn-dash__chip-mark"
                            aria-hidden="true"
                          />
                          {urgency}
                        </span>
                      )}
                    </span>
                    <span className="gn-dash__course-meta">
                      {notebooks} · {canvas}
                    </span>
                  </button>
                </li>
              );
            })}
      </ul>
    </section>
  );
};
