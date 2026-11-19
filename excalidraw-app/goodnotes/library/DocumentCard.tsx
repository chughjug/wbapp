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
    isHero,
    courseStyle,
    contentMatch,
    trashDaysLeft,
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
      className={`gn-card-wrapper${isSelected ? " gn-selected" : ""}${
        isHero ? " gn-card-wrapper--hero" : ""
      }`}
      role="row"
      aria-selected={onToggleSelect ? !!isSelected : undefined}
    >
      <div
        className={`gn-card${isHero ? " gn-card--hero" : ""}${
          isEditing ? " gn-card--editing" : ""
        }${isSelected ? " gn-card--selected" : ""}${
          selectionActive ? " gn-card--selecting" : ""
        }`}
        role="gridcell"
      >
        {/*
          The checkbox is only resident once a selection exists. At rest it
          was one more control on every card for a gesture almost nobody uses
          on a home screen; it is still reachable without it — Space on the
          focused card, Cmd/Ctrl-click, or "Select" in the card's own menu —
          and the moment any of those fires, every checkbox appears.
        */}
        {onToggleSelect && selectionActive && (
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
          aria-label={`${
            isHero && doc.lastOpenedAt != null
              ? "Continue where you left off. "
              : ""
          }${describeDocument(doc, now, isFavourite, tags)}`}
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
            {isHero && doc.lastOpenedAt != null && (
              <span className="gn-card__continue">Continue</span>
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
            {/*
              A badge that says a field is empty is noise: "No course" and
              "No due date" were on most cards on most screens and told the
              student nothing. Both are simply absent now — and both are
              still spelled out in the card's accessible name, which has not
              changed, so nothing is lost to a screen reader.
            */}
            {doc.course && (
              <span className="gn-card__course">
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
              </span>
            )}
            {trashDaysLeft !== undefined && (
              <span className="gn-card__match">
                <span className="gn-card__match-page">
                  {trashDaysLeft === 0
                    ? "Deleted — removed today"
                    : `Deleted — ${trashDaysLeft} ${
                        trashDaysLeft === 1 ? "day" : "days"
                      } left`}
                </span>
                <span className="gn-card__match-text">
                  Put it back from the menu to keep it.
                </span>
              </span>
            )}
            {contentMatch && (
              <span className="gn-card__match">
                <span className="gn-card__match-page">
                  {contentMatch.page > 0
                    ? `Page ${contentMatch.page}`
                    : "In this notebook"}
                </span>
                <span className="gn-card__match-text">
                  {contentMatch.snippet}
                </span>
              </span>
            )}
            <span className="gn-card__meta">
              {doc.dueDate != null && (
                <span className={`gn-due gn-due--${urgency}`}>
                  <span className="gn-due__dot" aria-hidden="true" />
                  {dueLabel}
                </span>
              )}
              <span className="gn-card__updated">{updatedLabel}</span>
            </span>
          </span>
        </button>

        {tags.length > 0 && (
          <ul className="gn-card__tags" aria-label={`Tags on ${doc.title}`}>
            {tags.slice(0, 2).map((tag) => (
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
            {tags.length > 2 && (
              <li>
                <span className="gn-chip gn-chip--more">
                  +{tags.length - 2}
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
