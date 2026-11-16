/**
 * The progress + error pair every import surface in this module shares.
 *
 * Accessibility contract (relied on by the drop zone, the receive screen and
 * the drop overlay):
 * - the status line lives in an `aria-live="polite"` region that is present
 *   in the DOM **before** the import starts, so the first update is actually
 *   announced (a region inserted at the same time as its text usually is
 *   not);
 * - the bar is a real `role="progressbar"` with `aria-valuenow` when the page
 *   count is known, and indeterminate (no `aria-valuenow`) before that;
 * - errors are a separate `role="alert"` node so they interrupt.
 */

import React from "react";

export interface ImportProgressProps {
  /** Polite status text. Empty string renders the live region empty. */
  message: string;
  /** 0..1, or null for indeterminate. */
  fraction: number | null;
  /** Shown in a `role="alert"`; null hides it. */
  errorText?: string | null;
  /** Hide the bar (e.g. when idle) but keep the live region mounted. */
  showBar?: boolean;
  /** Accessible name of the progress bar. */
  label?: string;
}

export const ImportProgress: React.FC<ImportProgressProps> = ({
  message,
  fraction,
  errorText = null,
  showBar = true,
  label = "PDF import progress",
}) => {
  const percent = fraction === null ? null : Math.round(fraction * 100);

  return (
    <div className="gn-share-progress">
      <div
        className="gn-share-progress__label"
        aria-live="polite"
        aria-atomic="true"
      >
        {message}
      </div>
      {showBar && (
        <div
          className="gn-share-progress__track"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { "aria-valuenow": percent })}
        >
          <div
            className={`gn-share-progress__bar${
              percent === null ? " gn-share-progress__bar--indeterminate" : ""
            }`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {errorText ? (
        <p className="gn-share-error" role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
};
