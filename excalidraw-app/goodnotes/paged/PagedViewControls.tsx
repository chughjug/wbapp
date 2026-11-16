/**
 * <PagedViewControls /> — page changes, announced.
 *
 * **This is no longer a permanent bar.** It used to render prev / "Page N of
 * M" / next as a 1194×36 strip across the bottom of an iPad screen, which
 * duplicated the page count the shell's bar already carries and cost 42,984
 * px² that is never drawing surface. By default it now renders ONLY the
 * visually-hidden `aria-live` region that announces page changes — zero
 * layout area, and the announcement survives, which matters because it is the
 * only thing that tells a screen reader user that the arrow keys, the flick or
 * the page panel moved them.
 *
 * The capability did not go anywhere:
 *
 * - `usePagedView()` exposes `prev` / `next` / `goToPage`, so the shell's bar
 *   and the page overlay drive the same controller;
 * - the keyboard routes (arrows, PageUp/PageDown, Home/End) are installed by
 *   the controller, not by this component, and are untouched;
 * - a host that genuinely wants the visible strip back can pass
 *   `controls` — it is opt-in now rather than always-on.
 *
 * The paged / continuous switch is gone from here entirely: Settings → View
 * mode owns it (one control, one place), and two switches for one
 * `localStorage` key is exactly the kind of duplication this change exists to
 * remove.
 */

import clsx from "clsx";
import { useEffect, useId, useState } from "react";

import "./PagedViewControls.scss";

export interface PagedViewControlsProps {
  /**
   * Render the visible prev / page / next strip. **Off by default**: the live
   * region alone is what the app mounts. Opt in only if your shell has no
   * other page affordance.
   */
  controls?: boolean;
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
  className?: string;
}

/**
 * The live region, on its own. Visually hidden (not `display: none`, which
 * screen readers skip), `role="status"` + polite so a page change never
 * interrupts what is being read.
 */
const LiveRegion = ({ announcement }: { announcement: string }) => (
  <span
    className="goodnotes-paged-controls__live"
    role="status"
    aria-live="polite"
  >
    {announcement}
  </span>
);

export const PagedViewControls = ({
  controls = false,
  pageNumber,
  pageCount,
  canPrev,
  canNext,
  announcement,
  onPrev,
  onNext,
  onGoToPage,
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

  if (!controls) {
    // zero layout area: the announcement, and nothing else
    return <LiveRegion announcement={announcement} />;
  }

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

      <LiveRegion announcement={announcement} />
    </div>
  );
};
