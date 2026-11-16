/**
 * <PagedViewControls /> — the keyboard-reachable route to every page, and
 * the switch between paged and continuous view.
 *
 * Deliberately not the only route (the page panel, the arrow keys and the
 * two-finger flick all work too), but it is the route that is always there:
 * NO GESTURE IS REQUIRED to reach any page.
 *
 * It also owns the `aria-live` region that announces page changes, whichever
 * route caused them — pass `announcement` from `usePagedView()`.
 */

import clsx from "clsx";
import { useEffect, useId, useState } from "react";

import "./PagedViewControls.scss";

import type { ViewMode } from "./mode";

export interface PagedViewControlsProps {
  mode: ViewMode;
  /** 1-based; `0` when the document has no pages. */
  pageNumber: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  /** Screen-reader text for the live region, from `usePagedView()`. */
  announcement: string;
  onPrev: () => void;
  onNext: () => void;
  /** Called with a 1-based page number. */
  onGoToPage: (pageNumber: number) => void;
  onToggleMode: () => void;
  /** Hide the paged/continuous switch (if the host puts it in a menu). */
  hideModeToggle?: boolean;
  className?: string;
}

export const PagedViewControls = ({
  mode,
  pageNumber,
  pageCount,
  canPrev,
  canNext,
  announcement,
  onPrev,
  onNext,
  onGoToPage,
  onToggleMode,
  hideModeToggle,
  className,
}: PagedViewControlsProps) => {
  const inputId = useId();
  const [draft, setDraft] = useState(String(pageNumber));

  // follow the document unless the field is being edited
  useEffect(() => {
    setDraft(String(pageNumber));
  }, [pageNumber]);

  const commit = () => {
    const value = Number.parseInt(draft, 10);
    if (Number.isFinite(value) && value >= 1 && value <= pageCount) {
      onGoToPage(value);
    } else {
      setDraft(String(pageNumber));
    }
  };

  return (
    <div className={clsx("goodnotes-paged-controls", className)}>
      <button
        type="button"
        className="goodnotes-paged-controls__step"
        onClick={onPrev}
        disabled={!canPrev}
        title="Previous page"
        aria-label="Previous page"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>

      <label className="goodnotes-paged-controls__field" htmlFor={inputId}>
        <span className="goodnotes-paged-controls__label">Page</span>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(pageCount, 1)}
          value={draft}
          disabled={pageCount === 0}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="goodnotes-paged-controls__count">of {pageCount}</span>
      </label>

      <button
        type="button"
        className="goodnotes-paged-controls__step"
        onClick={onNext}
        disabled={!canNext}
        title="Next page"
        aria-label="Next page"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {!hideModeToggle && (
        <button
          type="button"
          className={clsx("goodnotes-paged-controls__mode", {
            "is-paged": mode === "paged",
          })}
          onClick={onToggleMode}
          aria-pressed={mode === "paged"}
          title={
            mode === "paged"
              ? "One page at a time (click for the continuous canvas)"
              : "Continuous canvas (click for one page at a time)"
          }
        >
          {mode === "paged" ? "Paged" : "Scroll"}
        </button>
      )}

      {/*
        One live region for every route to a page: the flick, the arrow keys,
        this control, the page panel. `role="status"` + polite so it never
        interrupts, and it is visually hidden rather than display:none (which
        screen readers skip).
      */}
      <span
        className="goodnotes-paged-controls__live"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </span>
    </div>
  );
};
