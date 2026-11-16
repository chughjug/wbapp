/**
 * The left page panel — the GoodNotes page rail, moved from the right-hand
 * Excalidraw sidebar to a fixed ~188px column on the left, under the nav bar.
 *
 * This is a WRAPPER, not a fork. All of the hard parts — composited paper +
 * ink thumbnails, the debounce/cache, roving-tabindex keyboard navigation,
 * reorder and delete, "scroll the active page into view", the `+ Add page`
 * footer — come from `goodnotes/pages`'s `PageSidebar`, which this module only
 * reads from. Everything here is chrome: the panel frame, the "PAGES" header,
 * the re-skin (scoped in `PagePanel.scss`) and the body class that keeps
 * Excalidraw's bottom-left zoom pill clear of the panel.
 *
 * Accessibility: the panel is a labelled `<aside>`; the heading is a real
 * `<h2>`; the close control has a text accessible name; focus rings and
 * reduced-motion handling come from the sidebar and are re-stated here for the
 * chrome this file adds.
 */

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PageSidebar } from "../pages";

import { CloseIcon } from "../taskbar/icons";

import { PAGE_PANEL_OPEN_CLASS } from "./NavBar";

import "./PagePanel.scss";

import type { ShellPlacement } from "./NavBar";

/** Default panel width, in px. Matches the GoodNotes study's rail. */
export const PAGE_PANEL_WIDTH = 188;

export interface PagePanelProps {
  /** The editor whose pages are listed. `null` renders an empty panel. */
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Whether the panel is shown. Default `true`; `false` renders nothing. */
  open?: boolean;
  /** Close control. Hidden when absent — pair it with the nav bar's toggle. */
  onClose?: () => void;
  /** Panel theme. Defaults to light; pass the editor's theme. */
  theme?: "light" | "dark";
  /** Forwarded to `PageSidebar`: render page bitmaps. Default `true`. */
  thumbnails?: boolean;
  /** Panel width in px. Default {@link PAGE_PANEL_WIDTH}. */
  width?: number;
  /**
   * `flow` (default): the panel is the first column of the shell's body row,
   * so the canvas simply starts to its right and Excalidraw's own bottom-left
   * zoom pill moves with the canvas. `fixed`: the panel is pinned to the left
   * edge, overlaying the canvas, and the pill is nudged clear of it with a
   * body class. Use the same placement as the nav bar.
   */
  placement?: ShellPlacement;
  /** Header text. Default `"Pages"` (rendered in small caps). */
  title?: string;
  className?: string;
}

export const PagePanel = ({
  excalidrawAPI,
  open = true,
  onClose,
  theme = "light",
  thumbnails = true,
  width = PAGE_PANEL_WIDTH,
  placement = "flow",
  title = "Pages",
  className,
}: PagePanelProps) => {
  // While a FIXED panel is open, Excalidraw's own bottom-left footer (the
  // zoom / undo pill, which we deliberately do NOT absorb) is pushed clear of
  // it. In flow placement the canvas itself starts to the right of the panel,
  // so the pill is already clear and no body class is needed.
  useEffect(() => {
    if (!open || placement !== "fixed" || typeof document === "undefined") {
      return;
    }
    const { body } = document;
    body.classList.add(PAGE_PANEL_OPEN_CLASS);
    body.style.setProperty("--gn-page-panel-width", `${width}px`);
    return () => {
      body.classList.remove(PAGE_PANEL_OPEN_CLASS);
      body.style.removeProperty("--gn-page-panel-width");
    };
  }, [open, width, placement]);

  if (!open) {
    return null;
  }

  return (
    <aside
      className={`gn-page-panel gn-page-panel--${placement} excalidraw${
        theme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      style={{ width: `${width}px` }}
      aria-label={`${title} panel`}
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
        <PageSidebar excalidrawAPI={excalidrawAPI} thumbnails={thumbnails} />
      </div>
    </aside>
  );
};

export default PagePanel;
