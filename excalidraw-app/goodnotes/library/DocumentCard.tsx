/**
 * Grid view: one document as a cover card.
 *
 * The whole cover + body is a single `<button>` with a composed accessible
 * name (title, course, due state, pages, favourite, tags, last edited), so a
 * screen-reader user never has to infer anything from the colour of a badge.
 */

import React from "react";

import {
  describeDocument,
  formatDueDate,
  formatUpdatedAt,
  getDueUrgency,
  hueFromId,
  initialsOf,
} from "./format";
import { visibleTags } from "./filters";
import { hexToRgbChannels } from "./courses";
import { DocumentActions, DocumentEditor } from "./DocumentEditor";

import type { DocumentItemProps } from "./DocumentEditor";

export const DocumentCard = React.memo((props: DocumentItemProps) => {
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
  const dueLabel = formatDueDate(doc.dueDate, now);
  const updatedLabel = formatUpdatedAt(doc.updatedAt, now);
  const tags = visibleTags(doc);

  return (
    <li className="gn-card-wrapper">
      <div className={`gn-card${isEditing ? " gn-card--editing" : ""}`}>
        <button
          type="button"
          className="gn-card__open"
          ref={(node) => registerRef(doc.id, node)}
          tabIndex={tabIndex}
          aria-label={describeDocument(doc, now, isFavourite, tags)}
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
                  { "--gn-hue": `${hueFromId(doc.id)}` } as React.CSSProperties
                }
              >
                <span className="gn-card__placeholder-initials">
                  {initialsOf(doc.title)}
                </span>
              </span>
            )}
            {isFavourite && <span className="gn-card__star">★</span>}
            <span className="gn-card__pages">
              {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
            </span>
          </span>

          <span className="gn-card__body">
            <span className="gn-card__title">{doc.title}</span>
            <span className="gn-card__course">
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
                "No course"
              )}
            </span>
            <span className={`gn-due gn-due--${urgency}`}>
              <span className="gn-due__dot" aria-hidden="true" />
              {dueLabel}
            </span>
            {tags.length > 0 && (
              <span className="gn-card__tags">
                {tags.slice(0, 4).map((tag) => (
                  <span className="gn-chip" key={tag}>
                    {tag}
                  </span>
                ))}
                {tags.length > 4 && (
                  <span className="gn-chip gn-chip--more">
                    +{tags.length - 4}
                  </span>
                )}
              </span>
            )}
            <span className="gn-card__updated">{updatedLabel}</span>
          </span>
        </button>

        <DocumentActions {...props} />

        {isEditing && <DocumentEditor {...props} />}
      </div>
    </li>
  );
});
DocumentCard.displayName = "DocumentCard";

export default DocumentCard;
