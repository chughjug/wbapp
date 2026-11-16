/**
 * The contextual bulk-action bar, shown while at least one document is
 * selected.
 *
 * Accessibility notes:
 *  - it is a `role="group"` of real `<button>`s with text labels (not icon
 *    buttons), so it is in the normal Tab order, reachable without a mouse,
 *    and every action has an accessible name that names the count it will
 *    affect ("Delete 12 documents"), never just "Delete";
 *  - it is rendered *before* the document container in the DOM, so Tab from
 *    the selection lands on the actions rather than after the whole grid;
 *  - toggles whose meaning depends on the current selection (favourite, pin,
 *    archive) flip their label rather than their colour.
 */

import React from "react";

export interface SelectionBarProps {
  count: number;
  /** Documents currently visible — the scope of "Select all". */
  visibleCount: number;
  allVisibleSelected: boolean;
  /** Every selected document already favourited / pinned / archived. */
  allFavourite: boolean;
  allPinned: boolean;
  allArchived: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onMove: () => void;
  onAddTag: () => void;
  onRemoveTag: () => void;
  onSetDueDate: () => void;
  onToggleFavourite: (next: boolean) => void;
  onTogglePinned: (next: boolean) => void;
  onToggleArchived: (next: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const SelectionBar = ({
  count,
  visibleCount,
  allVisibleSelected,
  allFavourite,
  allPinned,
  allArchived,
  onSelectAll,
  onClear,
  onMove,
  onAddTag,
  onRemoveTag,
  onSetDueDate,
  onToggleFavourite,
  onTogglePinned,
  onToggleArchived,
  onDuplicate,
  onDelete,
}: SelectionBarProps) => {
  const noun = count === 1 ? "document" : "documents";
  const scope = `${count} ${noun}`;

  return (
    <div
      className="gn-selbar"
      role="group"
      aria-label={`Bulk actions, ${scope} selected`}
    >
      <p className="gn-selbar__count">
        <strong>{count}</strong> selected
      </p>

      <div className="gn-selbar__actions">
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onMove}
        >
          Move to course…
          <span className="gn-sr-only">{` (${scope})`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onAddTag}
        >
          Add tag…
          <span className="gn-sr-only">{` (${scope})`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onRemoveTag}
        >
          Remove tag…
          <span className="gn-sr-only">{` (${scope})`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          aria-pressed={allFavourite}
          onClick={() => onToggleFavourite(!allFavourite)}
        >
          {allFavourite ? "Unfavourite" : "Favourite"}
          <span className="gn-sr-only">{` ${scope}`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          aria-pressed={allPinned}
          onClick={() => onTogglePinned(!allPinned)}
        >
          {allPinned ? "Unpin" : "Pin"}
          <span className="gn-sr-only">{` ${scope}`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onSetDueDate}
        >
          Set due date…
          <span className="gn-sr-only">{` (${scope})`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          aria-pressed={allArchived}
          onClick={() => onToggleArchived(!allArchived)}
        >
          {allArchived ? "Unarchive" : "Archive"}
          <span className="gn-sr-only">{` ${scope}`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onDuplicate}
        >
          Duplicate
          <span className="gn-sr-only">{` ${scope}`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small gn-button--danger"
          onClick={onDelete}
        >
          Delete
          <span className="gn-sr-only">{` ${scope}`}</span>
        </button>
      </div>

      <div className="gn-selbar__end">
        <button
          type="button"
          className="gn-button gn-button--small"
          disabled={allVisibleSelected || visibleCount === 0}
          onClick={onSelectAll}
        >
          Select all
          <span className="gn-sr-only">{` ${visibleCount} shown documents`}</span>
        </button>
        <button
          type="button"
          className="gn-button gn-button--small"
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
};

export default SelectionBar;
