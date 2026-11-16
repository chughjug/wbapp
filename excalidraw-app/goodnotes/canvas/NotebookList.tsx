/**
 * The "My notebooks" tab: the documents this app already holds for the
 * selected course. Read entirely from IndexedDB, so it keeps working when
 * Canvas is down, offline, or the token has been revoked.
 */

import React from "react";

import { formatDueDate, formatUpdatedAt, getDueUrgency } from "../library";

import type { DocMeta } from "../types";

export interface NotebookListProps {
  docs: readonly DocMeta[];
  courseLabel: string;
  onOpen: (doc: DocMeta) => void;
  now?: number;
}

export const NotebookList: React.FC<NotebookListProps> = ({
  docs,
  courseLabel,
  onOpen,
  now = Date.now(),
}) => {
  if (docs.length === 0) {
    return (
      <p className="gn-canvas-empty">
        No notebooks filed under “{courseLabel}” yet. Create one from the
        Assignments tab, or import a PDF from Files.
      </p>
    );
  }

  return (
    <ul className="gn-canvas-list">
      {docs.map((doc) => {
        const urgency = getDueUrgency(doc.dueDate, now);
        return (
          <li key={doc.id} className="gn-canvas-row">
            <div className="gn-canvas-row__main">
              <span className="gn-canvas-row__title">{doc.title}</span>
              <span className="gn-canvas-row__meta">
                {doc.dueDate != null ? (
                  <span
                    className={`gn-canvas-due gn-canvas-due--${urgency}`}
                    data-urgency={urgency}
                  >
                    {formatDueDate(doc.dueDate, now)}
                  </span>
                ) : (
                  <span>No due date</span>
                )}
                <span className="gn-canvas-row__dot" aria-hidden="true">
                  ·
                </span>
                <span>
                  {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                </span>
                <span className="gn-canvas-row__dot" aria-hidden="true">
                  ·
                </span>
                <span>{formatUpdatedAt(doc.updatedAt, now)}</span>
              </span>
            </div>
            <div className="gn-canvas-row__actions">
              <button
                type="button"
                className="gn-canvas-button gn-canvas-button--primary"
                onClick={() => onOpen(doc)}
              >
                Open
                <span className="gn-canvas-sr"> {doc.title}</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
