/**
 * The inline "details" editor shared by the grid card and the dense list row,
 * plus the props contract both of them implement.
 *
 * The reserved favourite tag is filtered out of the tag editor: the star
 * button is its only control, so the flag can never be shown or removed twice.
 */

import React, { useId, useState } from "react";

import { visibleTags } from "./filters";
import { Icon, ICON_CHECK, ICON_CLOSE } from "./icons";

import type { CourseStyle } from "./courses";
import type { DocMeta } from "../types";

export interface DocumentItemProps {
  doc: DocMeta;
  /** One clock read per render pass, so every badge agrees. */
  now: number;
  tabIndex: number;
  isEditing: boolean;
  isFavourite: boolean;
  /** Resolved style of `doc.course`, or null when the document has no course. */
  courseStyle: CourseStyle | null;
  onOpen: (doc: DocMeta) => void;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onDuplicate: (doc: DocMeta) => void;
  onDelete: (doc: DocMeta) => void;
  onRename: (id: string, title: string) => void;
  onSetCourse: (id: string, course: string | null) => void;
  onSetDueDate: (id: string, dueDate: number | null) => void;
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  onToggleFavourite: (doc: DocMeta) => void;
  onFocusCard: (id: string) => void;
  registerRef: (id: string, node: HTMLButtonElement | null) => void;
}

export const toDateInputValue = (timestamp: number | null): string => {
  if (timestamp == null) {
    return "";
  }
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

export const fromDateInputValue = (value: string): number | null => {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  // end of the chosen day, local time — "due Friday" means Friday night
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
};

export const DocumentEditor = ({
  doc,
  onRename,
  onStopEdit,
  onSetCourse,
  onSetDueDate,
  onAddTag,
  onRemoveTag,
}: Pick<
  DocumentItemProps,
  | "doc"
  | "onRename"
  | "onStopEdit"
  | "onSetCourse"
  | "onSetDueDate"
  | "onAddTag"
  | "onRemoveTag"
>) => {
  const fieldId = useId();
  const [tagDraft, setTagDraft] = useState("");
  const tags = visibleTags(doc);

  return (
    <div className="gn-card__editor">
      <label className="gn-field" htmlFor={`${fieldId}-title`}>
        <span className="gn-field__label">Title</span>
        <input
          id={`${fieldId}-title`}
          className="gn-input"
          type="text"
          defaultValue={doc.title}
          onBlur={(event) => onRename(doc.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRename(doc.id, event.currentTarget.value);
              onStopEdit();
            }
          }}
        />
      </label>

      <label className="gn-field" htmlFor={`${fieldId}-course`}>
        <span className="gn-field__label">Course</span>
        <input
          id={`${fieldId}-course`}
          className="gn-input"
          type="text"
          defaultValue={doc.course ?? ""}
          placeholder="e.g. Biology 201"
          onBlur={(event) => onSetCourse(doc.id, event.target.value)}
        />
      </label>

      <label className="gn-field" htmlFor={`${fieldId}-due`}>
        <span className="gn-field__label">Due date</span>
        <input
          id={`${fieldId}-due`}
          className="gn-input"
          type="date"
          defaultValue={toDateInputValue(doc.dueDate)}
          onChange={(event) =>
            onSetDueDate(doc.id, fromDateInputValue(event.target.value))
          }
        />
      </label>

      <div className="gn-field">
        <span className="gn-field__label" id={`${fieldId}-tags-label`}>
          Tags
        </span>
        <ul
          className="gn-card__tag-editor"
          aria-labelledby={`${fieldId}-tags-label`}
        >
          {tags.map((tag) => (
            <li key={tag}>
              <span className="gn-chip gn-chip--editable">
                {tag}
                <button
                  type="button"
                  className="gn-chip__remove"
                  aria-label={`Remove tag ${tag} from ${doc.title}`}
                  onClick={() => onRemoveTag(doc.id, tag)}
                >
                  <Icon path={ICON_CLOSE} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="gn-card__tag-add">
          <input
            className="gn-input"
            type="text"
            value={tagDraft}
            placeholder="Add a tag"
            aria-label={`Add a tag to ${doc.title}`}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && tagDraft.trim()) {
                event.preventDefault();
                onAddTag(doc.id, tagDraft);
                setTagDraft("");
              }
            }}
          />
          <button
            type="button"
            className="gn-icon-button"
            aria-label={`Add tag to ${doc.title}`}
            disabled={!tagDraft.trim()}
            onClick={() => {
              onAddTag(doc.id, tagDraft);
              setTagDraft("");
            }}
          >
            <Icon path={ICON_CHECK} />
          </button>
        </div>
      </div>
    </div>
  );
};

/** The star / duplicate / delete / edit cluster, identical in both views. */
export const DocumentActions = ({
  doc,
  isEditing,
  isFavourite,
  tabIndex,
  onStartEdit,
  onStopEdit,
  onDuplicate,
  onDelete,
  onToggleFavourite,
  className,
}: Pick<
  DocumentItemProps,
  | "doc"
  | "isEditing"
  | "isFavourite"
  | "tabIndex"
  | "onStartEdit"
  | "onStopEdit"
  | "onDuplicate"
  | "onDelete"
  | "onToggleFavourite"
> & { className?: string }) => (
  <div className={`gn-card__actions${className ? ` ${className}` : ""}`}>
    <button
      type="button"
      className={`gn-icon-button${
        isFavourite ? " gn-icon-button--star-on" : ""
      }`}
      tabIndex={tabIndex}
      aria-pressed={isFavourite}
      aria-label={
        isFavourite
          ? `Remove ${doc.title} from favourites`
          : `Add ${doc.title} to favourites`
      }
      onClick={() => onToggleFavourite(doc)}
    >
      <Icon
        path="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.95 6.75 19.7l1-5.85L3.5 9.7l5.9-.9L12 3.5z"
        filled={isFavourite}
      />
    </button>
    <button
      type="button"
      className="gn-icon-button"
      tabIndex={tabIndex}
      aria-expanded={isEditing}
      aria-label={
        isEditing
          ? `Close details for ${doc.title}`
          : `Edit details for ${doc.title}`
      }
      onClick={() => (isEditing ? onStopEdit() : onStartEdit(doc.id))}
    >
      <Icon
        path={
          isEditing
            ? "M6 6l12 12M18 6L6 18"
            : "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"
        }
      />
    </button>
    <button
      type="button"
      className="gn-icon-button"
      tabIndex={tabIndex}
      aria-label={`Duplicate ${doc.title}`}
      onClick={() => onDuplicate(doc)}
    >
      <Icon path="M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM5 15V5a2 2 0 0 1 2-2h10" />
    </button>
    <button
      type="button"
      className="gn-icon-button gn-icon-button--danger"
      tabIndex={tabIndex}
      aria-label={`Delete ${doc.title}`}
      onClick={() => onDelete(doc)}
    >
      <Icon path="M4 7h16M10 7V5h4v2m-7 0 1 13h8l1-13" />
    </button>
  </div>
);
