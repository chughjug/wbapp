/**
 * The Assignments tab.
 *
 * One row per assignment: name, due date with its urgency, and the single
 * button that matters — "Open notes" when a notebook already exists for it
 * (`AssignmentRow.existing`), "Create notes" otherwise. Urgency is never
 * colour-only: the text itself says "2 days overdue".
 */

import React from "react";

import { formatDueDate, getDueUrgency } from "../library";

import type { AssignmentRow } from "./sync";
import type { DocMeta } from "../types";

export interface AssignmentListProps {
  rows: readonly AssignmentRow[];
  /** Id of the assignment whose notebook is being created right now. */
  busyAssignmentId?: string | null;
  onOpenNotes: (doc: DocMeta) => void;
  onCreateNotes: (row: AssignmentRow) => void;
  now?: number;
}

const dueMs = (row: AssignmentRow) =>
  row.assignment.due_at ? new Date(row.assignment.due_at).getTime() : null;

export const AssignmentList: React.FC<AssignmentListProps> = ({
  rows,
  busyAssignmentId = null,
  onOpenNotes,
  onCreateNotes,
  now = Date.now(),
}) => {
  if (rows.length === 0) {
    return (
      <p className="gn-canvas-empty">
        This course has no assignments in Canvas — or your account can’t see
        them.
      </p>
    );
  }

  return (
    <ul className="gn-canvas-list">
      {rows.map((row) => {
        const due = dueMs(row);
        const urgency = getDueUrgency(due, now);
        const isBusy = busyAssignmentId === row.assignment.id;
        return (
          <li key={row.assignment.id} className="gn-canvas-row">
            <div className="gn-canvas-row__main">
              <span className="gn-canvas-row__title">
                {row.assignment.name}
              </span>
              <span className="gn-canvas-row__meta">
                <span
                  className={`gn-canvas-due gn-canvas-due--${urgency}`}
                  data-urgency={urgency}
                >
                  {formatDueDate(due, now)}
                </span>
                {typeof row.assignment.points_possible === "number" ? (
                  <span className="gn-canvas-row__dot" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                {typeof row.assignment.points_possible === "number" ? (
                  <span>{row.assignment.points_possible} points</span>
                ) : null}
                {row.existing ? (
                  <>
                    <span className="gn-canvas-row__dot" aria-hidden="true">
                      ·
                    </span>
                    <span className="gn-canvas-badge">Notebook exists</span>
                  </>
                ) : null}
              </span>
            </div>

            <div className="gn-canvas-row__actions">
              {row.assignment.html_url ? (
                <a
                  className="gn-canvas-link"
                  href={row.assignment.html_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Canvas
                  <span className="gn-canvas-sr">
                    {" "}
                    page for {row.assignment.name} (opens in a new tab)
                  </span>
                </a>
              ) : null}
              {row.existing ? (
                <button
                  type="button"
                  className="gn-canvas-button gn-canvas-button--primary"
                  onClick={() => row.existing && onOpenNotes(row.existing)}
                >
                  Open notes
                  <span className="gn-canvas-sr">
                    {" "}
                    for {row.assignment.name}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="gn-canvas-button gn-canvas-button--primary"
                  disabled={isBusy}
                  onClick={() => onCreateNotes(row)}
                >
                  {isBusy ? "Creating…" : "Create notes"}
                  <span className="gn-canvas-sr">
                    {" "}
                    for {row.assignment.name}
                  </span>
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
