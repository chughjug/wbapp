/**
 * A one-field modal: "move N documents to course…", "add a tag to N
 * documents…", "rename tag…", "set a due date…".
 *
 * Same accessibility contract as ConfirmDialog — `role="dialog"`,
 * `aria-modal`, labelled by its title, focus moved into the field on open,
 * Tab cycles inside, Escape cancels, focus restored on close — plus a native
 * `<datalist>` for autocomplete, which gets keyboard and screen-reader
 * support from the browser rather than from a hand-rolled combobox.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

export interface PromptDialogProps {
  title: string;
  /** Visible label of the single field. */
  label: string;
  /** Optional explanatory text, wired up with aria-describedby. */
  description?: React.ReactNode;
  kind?: "text" | "date";
  initialValue?: string;
  placeholder?: string;
  /** Autocomplete options offered through a native datalist. */
  suggestions?: readonly string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Allow confirming with an empty value (e.g. "clear the due date"). */
  allowEmpty?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export const PromptDialog = ({
  title,
  label,
  description,
  kind = "text",
  initialValue = "",
  placeholder,
  suggestions,
  confirmLabel = "Apply",
  cancelLabel = "Cancel",
  allowEmpty = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) => {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, []);

  const canConfirm = allowEmpty || value.trim().length > 0;

  const confirm = useCallback(() => {
    if (canConfirm) {
      onConfirm(value);
    }
  }, [canConfirm, onConfirm, value]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const nodes = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ];
      if (nodes.length === 0) {
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="gn-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="gn-modal__dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
      >
        <h2 className="gn-modal__title" id={`${id}-title`}>
          {title}
        </h2>
        {description && (
          <div className="gn-modal__body" id={`${id}-desc`}>
            {description}
          </div>
        )}
        <div className="gn-modal__body">
          <label className="gn-field" htmlFor={`${id}-field`}>
            <span className="gn-field__label">{label}</span>
            <input
              id={`${id}-field`}
              ref={inputRef}
              className="gn-input"
              type={kind === "date" ? "date" : "text"}
              value={value}
              placeholder={placeholder}
              autoComplete="off"
              list={suggestions?.length ? `${id}-list` : undefined}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
          </label>
          {suggestions && suggestions.length > 0 && (
            <datalist id={`${id}-list`}>
              {suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          )}
        </div>
        <div className="gn-modal__actions">
          <button type="button" className="gn-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="gn-button gn-button--primary"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptDialog;
