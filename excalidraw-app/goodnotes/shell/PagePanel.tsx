/**
 * The page overlay — the GoodNotes page rail, as a slide-over dialog.
 *
 * It used to be a 189x656 column (123,954 px², the single biggest consumer of
 * permanent chrome) that held its place in the layout whether or not anyone
 * was looking at it. It is now an overlay: **closed, it renders nothing and
 * occupies no space**; open, it slides in over the canvas with a scrim.
 *
 * This is still a WRAPPER, not a fork. All of the hard parts — composited
 * paper + ink thumbnails, the debounce/cache, roving-tabindex keyboard
 * navigation, reorder and delete, "scroll the active page into view", the
 * `+ Add page` footer — come from `goodnotes/pages`'s `PageSidebar`, which
 * this module only reads from. Everything here is chrome: the dialog frame,
 * the scrim, the focus trap and the re-skin (scoped in `PagePanel.scss`).
 *
 * Accessibility: a labelled `role="dialog" aria-modal="true"` with the heading
 * as its accessible name; Escape and a scrim click both dismiss; Tab and
 * Shift+Tab are trapped inside while it is open; focus moves into the dialog
 * on open and returns to whatever opened it (the bar's Pages control) on
 * close; `prefers-reduced-motion: reduce` removes the slide.
 */

import { useCallback, useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PageSidebar } from "../pages";

import { CloseIcon } from "../taskbar/icons";

import { PAGE_PANEL_OPEN_CLASS } from "./FloatingBar";

import "./PagePanel.scss";

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { ShellPlacement } from "./FloatingBar";

/** Default panel width, in px. Matches the GoodNotes study's rail. */
export const PAGE_PANEL_WIDTH = 248;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface PagePanelProps {
  /** The editor whose pages are listed. `null` renders an empty panel. */
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /**
   * Whether the overlay is shown. Default `false` — the overlay is a dialog,
   * and a dialog's resting state is closed.
   *
   * When `false` this component renders `null`: no scrim, no panel, no column,
   * no reserved width. That is the point of the change.
   */
  open?: boolean;
  /**
   * Dismiss. Called by the close control, a scrim click and Escape. Required
   * in practice: an overlay you cannot dismiss is a trap.
   */
  onClose?: () => void;
  /**
   * Where focus goes when the overlay closes. Pass the bar's Pages button.
   * Without it, focus returns to whatever was focused when the overlay opened,
   * which is the same element in every normal flow.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Panel theme. Defaults to light; pass the editor's theme. */
  theme?: "light" | "dark";
  /** Forwarded to `PageSidebar`: render page bitmaps. Default `true`. */
  thumbnails?: boolean;
  /**
   * Forwarded to `PageSidebar`. Without these the sidebar spins up its own
   * new-page dialog instead of sharing the host's, so the panel's "+ Add
   * page" and the bar's would be two separate instances.
   */
  onAddPage?: () => void;
  addPageMode?: "picker" | "repeat";
  docId?: string;
  /** Panel width in px. Default {@link PAGE_PANEL_WIDTH}. */
  width?: number;
  /** Which edge the panel slides in from. Default `"left"`. */
  side?: "left" | "right";
  /**
   * `overlay` (default) — a scrim + slide-over inside the stage, costing
   * nothing when closed. `inline` — the legacy docked column, kept only for
   * hosts that have not migrated; it holds a column in the layout and is the
   * thing this redesign removed.
   */
  variant?: "overlay" | "inline";
  /**
   * @deprecated Positioning is the overlay's own business now. `"flow"` maps
   * to `variant="inline"`; everything else is ignored.
   */
  placement?: ShellPlacement;
  /** Header text, and the dialog's accessible name. Default `"Pages"`. */
  title?: string;
  className?: string;
}

export const PagePanel = ({
  excalidrawAPI,
  open = false,
  onClose,
  returnFocusTo,
  theme = "light",
  thumbnails = true,
  onAddPage,
  addPageMode,
  docId,
  width = PAGE_PANEL_WIDTH,
  side = "left",
  variant,
  placement,
  title = "Pages",
  className,
}: PagePanelProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // read by the document-level Escape listener, which must not be re-bound
  // every time the host hands us a fresh closure
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resolvedVariant =
    variant ?? (placement === "flow" ? "inline" : "overlay");
  const isOverlay = resolvedVariant === "overlay";

  // A body class for hosts that want to react to the overlay (pause an
  // animation, say). The overlay itself needs nothing from it.
  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }
    const { body } = document;
    body.classList.add(PAGE_PANEL_OPEN_CLASS);
    body.style.setProperty("--gn-page-panel-width", `${width}px`);
    return () => {
      body.classList.remove(PAGE_PANEL_OPEN_CLASS);
      body.style.removeProperty("--gn-page-panel-width");
    };
  }, [open, width]);

  // Remember what opened us, move focus in, and put it back on close. Both
  // halves run from one effect so the restore cannot be skipped.
  useEffect(() => {
    if (!open || !isOverlay || typeof document === "undefined") {
      return;
    }
    openerRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => {
      // Reading the ref *in cleanup* is the point: focus must go wherever the
      // Pages control is at close time, not where it was at open time.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = returnFocusTo?.current ?? openerRef.current;
      // the opener may have unmounted (document switch); never throw for it
      if (target && document.contains(target)) {
        target.focus();
      }
    };
  }, [open, isOverlay, returnFocusTo]);

  // Escape is handled on the document, in the capture phase, rather than on
  // the dialog: focus can legitimately be elsewhere for a moment (React runs
  // effects twice in StrictMode, and the editor steals focus back on some
  // scene updates), and an overlay you cannot dismiss with Escape is a trap.
  // Capture also beats Excalidraw's own window-level Escape handling.
  useEffect(() => {
    if (!open || !isOverlay || typeof document === "undefined") {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current?.();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [open, isOverlay]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const node = dialogRef.current;
    if (!node) {
      return;
    }
    const items = Array.from(
      node.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement as HTMLElement | null;
    // wrap at both ends: focus never escapes the dialog while it is open
    if (event.shiftKey && (current === first || current === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) {
    // zero cost when closed: no scrim, no panel, no column, no width
    return null;
  }

  const themeClass = `excalidraw${theme === "dark" ? " theme--dark" : ""}`;

  const panel = (
    <div
      ref={dialogRef}
      className={`gn-page-panel gn-page-panel--${resolvedVariant} gn-page-panel--${side} ${themeClass}${
        className ? ` ${className}` : ""
      }`}
      style={{ width: `${width}px` }}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-label={isOverlay ? `${title} panel` : undefined}
      tabIndex={isOverlay ? -1 : undefined}
      onKeyDown={isOverlay ? onKeyDown : undefined}
      data-testid="goodnotes-page-panel"
    >
      <div className="gn-page-panel__header">
        <h2 className="gn-page-panel__title">{title}</h2>
        {onClose && (
          <button
            type="button"
            className="gn-page-panel__close"
            onClick={onClose}
          >
            <CloseIcon />
            <span className="gn-page-panel__sr">{`Close ${title.toLowerCase()} panel`}</span>
          </button>
        )}
      </div>

      <div className="gn-page-panel__body">
        {/* owned by `goodnotes/pages`; re-skinned, never forked */}
        <PageSidebar
          excalidrawAPI={excalidrawAPI}
          thumbnails={thumbnails}
          onAddPage={onAddPage}
          addPageMode={addPageMode}
          docId={docId}
        />
      </div>
    </div>
  );

  if (!isOverlay) {
    return (
      <aside
        className="gn-page-panel-inline"
        aria-label={`${title} panel`}
        style={{ width: `${width}px` }}
      >
        {panel}
      </aside>
    );
  }

  return (
    <div className={`gn-page-overlay ${themeClass}`} data-side={side}>
      {/* the scrim: dismisses on click, and is not in the tab order — Escape
          and the close button are the keyboard routes */}
      <div
        className="gn-page-overlay__scrim"
        // `click`, not `pointerdown`: the browser's own focus shift happens
        // between the two, and would land after our focus restore otherwise
        onClick={onClose}
        aria-hidden="true"
        data-testid="goodnotes-page-overlay-scrim"
      />
      {panel}
    </div>
  );
};

export default PagePanel;
