/**
 * Import progress.
 *
 * A 40-page PDF takes real time (each page is rasterised), so there is a
 * determinate bar plus a polite live region. The live region is mounted
 * *before* the import starts — a region inserted at the same moment as its
 * first text usually isn't announced at all.
 */

import React from "react";

/** The phases `importCanvasFileAsDocument`'s `onProgress` reports. */
export const describeImportPhase = (
  phase: string,
  done: number,
  total: number,
): string => {
  switch (phase) {
    case "checking":
      return "Checking the PDF…";
    case "rendering":
      return total > 0
        ? `Rendering page ${Math.min(done + 1, total)} of ${total}…`
        : "Rendering pages…";
    case "saving":
      return "Saving the notebook…";
    case "done":
      return "Import finished.";
    default:
      return total > 0 ? `Working… ${done} of ${total}` : "Working…";
  }
};

export interface CanvasProgressProps {
  /** Polite status text. Empty string keeps the region mounted but silent. */
  message: string;
  /** 0..1, or null for indeterminate. */
  fraction: number | null;
  showBar?: boolean;
  label?: string;
}

export const CanvasProgress: React.FC<CanvasProgressProps> = ({
  message,
  fraction,
  showBar = true,
  label = "Canvas import progress",
}) => {
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <div className="gn-canvas-progress">
      <div
        className="gn-canvas-progress__text"
        aria-live="polite"
        aria-atomic="true"
      >
        {message}
      </div>
      {showBar ? (
        <div
          className="gn-canvas-progress__track"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { "aria-valuenow": percent })}
        >
          <div
            className={`gn-canvas-progress__bar${
              percent === null ? " gn-canvas-progress__bar--indeterminate" : ""
            }`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};
