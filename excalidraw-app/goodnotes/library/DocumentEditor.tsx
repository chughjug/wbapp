/**
 * The inline "details" editor shared by the grid card and the dense list row,
 * plus the props contract both of them implement.
 *
 * The reserved favourite tag is filtered out of the tag editor: the star
 * button is its only control, so the flag can never be shown or removed twice.
 */

import React, { useId, useState } from "react";

import { visibleTags } from "./filters";
import { formatCoursePath } from "./coursePath";
import {
  Icon,
  ICON_ARCHIVE,
  ICON_CHECK,
  ICON_CLOSE,
  ICON_PIN,
} from "./icons";

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

  // ------------------------------------------------------------- selection
  /** Part of the current multi-selection. */
  isSelected?: boolean;
  /** At least one document is selected anywhere, so checkboxes stay visible. */
  selectionActive?: boolean;
  /**
   * Toggle/extend the selection. `shift` requests a range from the anchor,
   * `meta` an additive toggle; neither means "select only this one".
   */
  onToggleSelect?: (
    id: string,
    modifiers: { shift: boolean; meta: boolean },
  ) => void;

  // ------------------------------------------------------- flags + filters
  isPinned?: boolean;
  isArchived?: boolean;
  onTogglePinned?: (doc: DocMeta) => void;
  onToggleArchived?: (doc: DocMeta) => void;
  /** Clicking a tag chip filters the library by it. */
  onSelectTag?: (tag: string) => void;
  /** Autocomplete sources for the inline editor. */
  tagSuggestions?: readonly string[];
  courseSuggestions?: readonly string[];
}

/**
 * Mouse/keyboard activation shared by the card and the row.
 *
 * Modifier-click selects instead of opening (Cmd/Ctrl toggles, Shift
 * extends), and Space toggles selection from the keyboard — the one place
 * where a `<button>`'s default is deliberately overridden, because Enter
 * still opens the document and a multi-select list with no keyboard
 * selection gesture is not usable without a mouse.
 */
export const useItemActivation = (props: DocumentItemProps) => {
  const { doc, onOpen, onToggleSelect } = props;
  return {
    onClick: (event: React.MouseEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (onToggleSelect && (meta || event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        onToggleSelect(doc.id, { shift: event.shiftKey, meta });
        return;
      }
      onOpen(doc);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (onToggleSelect && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        event.stopPropagation();
        onToggleSelect(doc.id, { shift: event.shiftKey, meta: true });
      }
    },
  };
};

/** The per-item selection checkbox. A real input, always keyboard reachable. */
export const SelectionCheckbox = ({
  doc,
  isSelected,
  tabIndex,
  onToggleSelect,
}: Pick<DocumentItemProps, "doc" | "isSelected" | "tabIndex"> & {
  onToggleSelect: (
    id: string,
    modifiers: { shift: boolean; meta: boolean },
  ) => void;
}) => (
  <span className="gn-select-box">
    <input
      type="checkbox"
      className="gn-select-box__input"
      checked={!!isSelected}
      tabIndex={tabIndex}
      aria-label={`Select ${doc.title}`}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const native = event.nativeEvent as MouseEvent & { shiftKey?: boolean };
        onToggleSelect(doc.id, {
          shift: !!native?.shiftKey,
          meta: true,
        });
      }}
    />
  </span>
);

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
  tagSuggestions,
  courseSuggestions,
}: Pick<
  DocumentItemProps,
  | "doc"
  | "onRename"
  | "onStopEdit"
  | "onSetCourse"
  | "onSetDueDate"
  | "onAddTag"
  | "onRemoveTag"
  | "tagSuggestions"
  | "courseSuggestions"
>) => {
  const fieldId = useId();
  const [tagDraft, setTagDraft] = useState("");
  const tags = visibleTags(doc);
  const tagOptions = (tagSuggestions ?? []).filter(
    (tag) => !tags.some((it) => it.toLowerCase() === tag.toLowerCase()),
  );

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
          defaultValue={doc.course ? formatCoursePath(doc.course) : ""}
          placeholder="e.g. Biology 201 / Labs"
          list={courseSuggestions?.length ? `${fieldId}-courses` : undefined}
          autoComplete="off"
          onBlur={(event) => onSetCourse(doc.id, event.target.value)}
        />
        {courseSuggestions && courseSuggestions.length > 0 && (
          <datalist id={`${fieldId}-courses`}>
            {courseSuggestions.map((course) => (
              <option key={course} value={course} />
            ))}
          </datalist>
        )}
        <span className="gn-field__hint">
          Use “ / ” to nest, e.g. MATH 221 / Problem sets
        </span>
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
            list={tagOptions.length ? `${fieldId}-tags` : undefined}
            autoComplete="off"
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
        {tagOptions.length > 0 && (
          <datalist id={`${fieldId}-tags`}>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
};

/** The star / pin / archive / edit / duplicate / delete cluster. */
export const DocumentActions = ({
  doc,
  isEditing,
  isFavourite,
  isPinned,
  isArchived,
  tabIndex,
  onStartEdit,
  onStopEdit,
  onDuplicate,
  onDelete,
  onToggleFavourite,
  onTogglePinned,
  onToggleArchived,
  className,
}: Pick<
  DocumentItemProps,
  | "doc"
  | "isEditing"
  | "isFavourite"
  | "isPinned"
  | "isArchived"
  | "tabIndex"
  | "onStartEdit"
  | "onStopEdit"
  | "onDuplicate"
  | "onDelete"
  | "onToggleFavourite"
  | "onTogglePinned"
  | "onToggleArchived"
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
    {onTogglePinned && (
      <button
        type="button"
        className={`gn-icon-button${isPinned ? " gn-icon-button--on" : ""}`}
        tabIndex={tabIndex}
        aria-pressed={!!isPinned}
        aria-label={
          isPinned ? `Unpin ${doc.title}` : `Pin ${doc.title} to the top`
        }
        onClick={() => onTogglePinned(doc)}
      >
        <Icon path={ICON_PIN} filled={!!isPinned} />
      </button>
    )}
    {onToggleArchived && (
      <button
        type="button"
        className={`gn-icon-button${isArchived ? " gn-icon-button--on" : ""}`}
        tabIndex={tabIndex}
        aria-pressed={!!isArchived}
        aria-label={
          isArchived ? `Unarchive ${doc.title}` : `Archive ${doc.title}`
        }
        onClick={() => onToggleArchived(doc)}
      >
        <Icon path={ICON_ARCHIVE} />
      </button>
    )}
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
