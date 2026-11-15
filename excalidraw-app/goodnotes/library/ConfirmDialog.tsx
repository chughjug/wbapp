/**
 * In-app confirmation, replacing `window.confirm` (which is blocking, cannot
 * be themed, is suppressed in some embedded contexts, and reads badly to
 * screen readers in an SPA).
 *
 * Behaviour: modal `role="dialog"`, labelled by its title and described by its
 * body, focus moved to the safe (cancel) button on open, Tab cycles inside the
 * dialog, Escape and backdrop click cancel, and focus is restored to whatever
 * was focused before it opened.
 */

import React, { useCallback, useEffect, useId, useRef } from "react";

export interface ConfirmDialogProps {
  title: string;
  body?: React.ReactNode;
  /** Label of the destructive/affirmative button. */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export const ConfirmDialog = ({
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, []);

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
      // the backdrop is not a control; the dialog below owns all interaction
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
        aria-describedby={body ? `${id}-body` : undefined}
      >
        <h2 className="gn-modal__title" id={`${id}-title`}>
          {title}
        </h2>
        {body && (
          <div className="gn-modal__body" id={`${id}-body`}>
            {body}
          </div>
        )}
        <div className="gn-modal__actions">
          <button
            type="button"
            className="gn-button"
            ref={cancelRef}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`gn-button ${
              tone === "danger" ? "gn-button--danger" : "gn-button--primary"
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
