/**
 * The local "Up next" row: the notebooks with the nearest due dates.
 *
 * Deliberately not the Canvas `DueSoonStrip`. That one is a timeline of
 * assignments which may not have notebooks yet, so it carries a create
 * action, a busy state and an error state. This is a row of notebooks that
 * already exist, so activating one just opens it — and it renders only
 * when the Canvas strip is not there.
 */

import React from "react";

import { formatDueDate, hueFromId } from "../library";

import type { LocalDeadline } from "./localDeadlines";
import type { CourseStyle } from "../library";
import type { DocMeta } from "../types";

export interface UpNextStripProps {
  items: readonly LocalDeadline[];
  now: number;
  styleOf: (course: string) => CourseStyle;
  onOpenDocument: (doc: DocMeta) => void;
  /** Heading id, so the section can be labelled by it. */
  headingId: string;
}

export const UpNextStrip = ({
  items,
  now,
  styleOf,
  onOpenDocument,
  headingId,
}: UpNextStripProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="gn-upnext" aria-labelledby={headingId}>
      <h2 className="gn-upnext__heading" id={headingId}>
        Up next
      </h2>
      <ul className="gn-upnext__list">
        {items.map(({ doc, urgency }) => {
          const course = doc.course ? styleOf(doc.course) : null;
          const due = formatDueDate(doc.dueDate, now);
          return (
            <li key={doc.id}>
              <button
                type="button"
                className="gn-upnext__item"
                style={
                  { "--gn-hue": `${hueFromId(doc.id)}` } as React.CSSProperties
                }
                // the visible text reads "Problem set 6 MATH 221 Due
                // tomorrow", which is the whole sentence a screen reader
                // needs; the label only adds the verb
                aria-label={`Open ${doc.title}, ${
                  doc.course ? `${doc.course}, ` : ""
                }${due.toLowerCase()}`}
                onClick={() => onOpenDocument(doc)}
              >
                <span className="gn-upnext__title">{doc.title}</span>
                <span className="gn-upnext__meta">
                  {doc.course && (
                    <span className="gn-upnext__course">
                      <span
                        className="gn-upnext__dot"
                        aria-hidden="true"
                        style={
                          {
                            "--gn-course-color": course?.color,
                          } as React.CSSProperties
                        }
                      />
                      {doc.course}
                    </span>
                  )}
                  <span className={`gn-due gn-due--${urgency}`}>
                    <span className="gn-due__dot" aria-hidden="true" />
                    {due}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default UpNextStrip;
