import React from "react";

import "./PresentationOverlay.scss";

export interface PresentationOverlayProps {
  active: boolean;
  index: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

export const PresentationOverlay = ({
  active,
  index,
  pageCount,
  onPrev,
  onNext,
  onExit,
}: PresentationOverlayProps) => {
  if (!active) {
    return null;
  }

  return (
    <div className="gn-present" role="status" aria-live="polite">
      <div className="gn-present__bar">
        <button type="button" className="gn-present__btn" onClick={onPrev}>
          Previous
        </button>
        <span className="gn-present__count">
          {pageCount === 0 ? "0 / 0" : `${index + 1} / ${pageCount}`}
        </span>
        <button type="button" className="gn-present__btn" onClick={onNext}>
          Next
        </button>
        <button
          type="button"
          className="gn-present__btn gn-present__btn--exit"
          onClick={onExit}
        >
          Exit
        </button>
      </div>
    </div>
  );
};
