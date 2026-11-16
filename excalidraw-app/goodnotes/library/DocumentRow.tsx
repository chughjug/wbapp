/**
 * List view: one document as a dense row with title / course / due / edited
 * columns.
 *
 * The columns are laid out with CSS grid on the row itself (the rows must
 * align, but a <table> would fight the roving-tabindex container contract the
 * grid view already uses). Each column therefore carries a visually hidden
 * prefix in the button's accessible name — the composed name is identical to
 * the grid card's, so switching view does not change what is announced.
 */

import React from "react";

import {
  describeDocument,
  formatDueDate,
  formatShortDate,
  formatUpdatedAt,
  getDueUrgency,
  initialsOf,
} from "./format";
import { visibleTags } from "./filters";
import { hexToRgbChannels } from "./courses";
import { DocumentActions, DocumentEditor } from "./DocumentEditor";

import type { DocumentItemProps } from "./DocumentEditor";

export const DocumentRow = React.memo((props: DocumentItemProps) => {
  const {
    doc,
    now,
    tabIndex,
    isEditing,
    isFavourite,
    courseStyle,
    onOpen,
    onFocusCard,
    registerRef,
  } = props;

  const urgency = getDueUrgency(doc.dueDate, now);
  const tags = visibleTags(doc);

  return (
    <li className="gn-row-wrapper">
      <div className={`gn-row${isEditing ? " gn-row--editing" : ""}`}>
        <button
          type="button"
          className="gn-row__open"
          ref={(node) => registerRef(doc.id, node)}
          tabIndex={tabIndex}
          aria-label={describeDocument(doc, now, isFavourite, tags)}
          onFocus={() => onFocusCard(doc.id)}
          onClick={() => onOpen(doc)}
        >
          <span className="gn-row__thumb" aria-hidden="true">
            {doc.thumbnail ? (
              <img src={doc.thumbnail} alt="" draggable={false} />
            ) : (
              <span className="gn-row__initials">{initialsOf(doc.title)}</span>
            )}
          </span>
          <span className="gn-row__title">
            {isFavourite && (
              <span className="gn-row__star" aria-hidden="true">
                ★
              </span>
            )}
            {doc.title}
          </span>
          <span className="gn-row__course">
            {doc.course ? (
              <>
                <span
                  className="gn-course-dot"
                  aria-hidden="true"
                  style={
                    {
                      "--gn-course-rgb": hexToRgbChannels(
                        courseStyle?.color ?? "#6b7280",
                      ),
                    } as React.CSSProperties
                  }
                />
                {courseStyle?.emoji ? `${courseStyle.emoji} ` : ""}
                {doc.course}
              </>
            ) : (
              <span className="gn-row__dim">—</span>
            )}
          </span>
          <span className={`gn-row__due gn-due gn-due--${urgency}`}>
            <span className="gn-due__dot" aria-hidden="true" />
            {formatDueDate(doc.dueDate, now)}
          </span>
          <span className="gn-row__edited">
            {formatUpdatedAt(doc.updatedAt, now).replace(/^Edited /, "")}
            <span className="gn-row__edited-date">
              {formatShortDate(doc.updatedAt)}
            </span>
          </span>
        </button>

        <DocumentActions {...props} className="gn-row__actions" />

        {isEditing && <DocumentEditor {...props} />}
      </div>
    </li>
  );
});
DocumentRow.displayName = "DocumentRow";

export default DocumentRow;
