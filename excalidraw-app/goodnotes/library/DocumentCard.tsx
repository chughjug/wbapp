/**
 * Grid view: one document as a cover card.
 *
 * The whole cover + body is a single `<button>` with a composed accessible
 * name (title, course, due state, pages, favourite, tags, last edited), so a
 * screen-reader user never has to infer anything from the colour of a badge.
 *
 * Multi-select semantics: the owning container is an ARIA `grid` with
 * `aria-multiselectable`, so the wrapper is a `row` carrying `aria-selected`
 * and the card itself is the row's single `gridcell` — a grid cell is the one
 * ARIA container that may legitimately hold the buttons this card needs.
 * A real `<input type="checkbox">` gives the selection an independent,
 * always-keyboard-reachable control with its own accessible name.
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
import { formatCoursePath } from "./coursePath";
import { hexToRgbChannels } from "./courses";
import {
  DocumentActions,
  DocumentEditor,
  SelectionCheckbox,
  useItemActivation,
} from "./DocumentEditor";

import type { DocumentItemProps } from "./DocumentEditor";

export const DocumentCard = React.memo((props: DocumentItemProps) => {
  const {
    doc,
    now,
    tabIndex,
    isEditing,
    isFavourite,
    isSelected,
    isPinned,
    isArchived,
    selectionActive,
    courseStyle,
    onFocusCard,
    onToggleSelect,
    onSelectTag,
    registerRef,
  } = props;

  const urgency = getDueUrgency(doc.dueDate, now);
  const dueLabel = formatDueDate(doc.dueDate, now);
  const updatedLabel = formatUpdatedAt(doc.updatedAt, now);
  const tags = visibleTags(doc);
  const activation = useItemActivation(props);

  return (
    <li
      className={`gn-card-wrapper${isSelected ? " gn-selected" : ""}`}
      role="row"
      aria-selected={onToggleSelect ? !!isSelected : undefined}
    >
      <div
        className={`gn-card${isEditing ? " gn-card--editing" : ""}${
          isSelected ? " gn-card--selected" : ""
        }${selectionActive ? " gn-card--selecting" : ""}`}
        role="gridcell"
      >
        {onToggleSelect && (
          <SelectionCheckbox
            doc={doc}
            isSelected={isSelected}
            tabIndex={tabIndex}
            onToggleSelect={onToggleSelect}
          />
        )}

        <button
          type="button"
          className="gn-card__open"
          ref={(node) => registerRef(doc.id, node)}
          tabIndex={tabIndex}
          aria-label={describeDocument(doc, now, isFavourite, tags)}
          aria-keyshortcuts={onToggleSelect ? "Space" : undefined}
          onFocus={() => onFocusCard(doc.id)}
          onClick={activation.onClick}
          onKeyDown={activation.onKeyDown}
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
            <span className="gn-card__title">
              {isPinned && (
                <span className="gn-flag" aria-hidden="true">
                  Pinned
                </span>
              )}
              {isArchived && (
                <span className="gn-flag" aria-hidden="true">
                  Archived
                </span>
              )}
              {doc.title}
            </span>
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
                  {formatCoursePath(doc.course)}
                </>
              ) : (
                "No course"
              )}
            </span>
            <span className={`gn-due gn-due--${urgency}`}>
              <span className="gn-due__dot" aria-hidden="true" />
              {dueLabel}
            </span>
            <span className="gn-card__updated">{updatedLabel}</span>
          </span>
        </button>

        {tags.length > 0 && (
          <ul className="gn-card__tags" aria-label={`Tags on ${doc.title}`}>
            {tags.slice(0, 4).map((tag) => (
              <li key={tag}>
                {onSelectTag ? (
                  <button
                    type="button"
                    className="gn-chip gn-chip--button"
                    tabIndex={tabIndex}
                    aria-label={`Show all documents tagged ${tag}`}
                    onClick={() => onSelectTag(tag)}
                  >
                    {tag}
                  </button>
                ) : (
                  <span className="gn-chip">{tag}</span>
                )}
              </li>
            ))}
            {tags.length > 4 && (
              <li>
                <span className="gn-chip gn-chip--more">
                  +{tags.length - 4}
                  <span className="gn-sr-only"> more tags</span>
                </span>
              </li>
            )}
          </ul>
        )}

        <DocumentActions {...props} />

        {isEditing && <DocumentEditor {...props} />}
      </div>
    </li>
  );
});
DocumentCard.displayName = "DocumentCard";

export default DocumentCard;
