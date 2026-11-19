/**
 * "Contents" — one line per page, naming what is on it, and a tap to go
 * there.
 *
 * Deliberately a list of text rather than thumbnails: `PagePanel` already
 * does thumbnails, and thumbnails are no help when forty pages of lecture
 * notes all look alike. This is the view for "which page was Lagrange
 * multipliers on".
 *
 * Accessibility contract, as with the history panel: `role="dialog"
 * aria-modal`, labelled and described, focus moved in on mount, trapped
 * with Tab/Shift+Tab, restored on close, Escape closes. The list is a real
 * list of buttons rather than a listbox, because each row does something
 * when activated rather than selecting a value.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { buildOutline } from "./buildOutline";

import "./OutlinePanel.scss";

import type { DocScene } from "../types";
import type { OutlineEntry } from "./buildOutline";

export interface OutlinePanelProps {
  /** The scene to summarise. */
  scene: DocScene | null;
  /** Page currently on screen, 1-based, for marking the row. */
  currentPage?: number | null;
  onClose: () => void;
  /** Go to a 1-based page number. */
  onGoToPage: (page: number) => void;
  theme?: "light" | "dark";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The label for a page with no readable title. */
const untitledLabel = (entry: OutlineEntry): string =>
  entry.hasText ? "No heading" : "Handwriting only";

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  scene,
  currentPage,
  onClose,
  onGoToPage,
  theme,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const filterId = useId();

  const [filter, setFilter] = useState("");

  const entries = useMemo(() => (scene ? buildOutline(scene) : []), [scene]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.title?.toLowerCase().includes(needle) ||
        String(entry.page) === needle,
    );
  }, [entries, filter]);

  const titled = entries.filter((entry) => entry.title !== null).length;

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const go = useCallback(
    (page: number) => {
      onGoToPage(page);
      onClose();
    },
    [onClose, onGoToPage],
  );

  const body = (
    <div
      className={`gn-outline excalidraw ${
        theme === "dark" ? "theme--dark" : ""
      }`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="gn-outline__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-outline__head">
          <h2 className="gn-outline__title" id={titleId}>
            Contents
          </h2>
          <button
            type="button"
            className="gn-outline__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close contents"
          >
            ×
          </button>
        </div>

        <p className="gn-outline__intro" id={descriptionId}>
          {entries.length === 0
            ? "This notebook has no pages yet."
            : titled === 0
            ? "None of these pages has typed text on it, so there are no headings to list. Write or type a heading and it will show up here."
            : `${titled} of ${entries.length} page${
                entries.length === 1 ? "" : "s"
              } has a heading. Handwriting is not read.`}
        </p>

        {entries.length > 4 && (
          <input
            id={filterId}
            className="gn-outline__filter"
            type="search"
            value={filter}
            placeholder="Filter contents"
            aria-label="Filter contents"
            onChange={(event) => setFilter(event.target.value)}
          />
        )}

        {shown.length === 0 && entries.length > 0 ? (
          <p className="gn-outline__empty">Nothing matches “{filter}”.</p>
        ) : (
          <ol className="gn-outline__list">
            {shown.map((entry) => (
              <li key={entry.page}>
                <button
                  type="button"
                  className="gn-outline__row"
                  aria-current={entry.page === currentPage ? "true" : undefined}
                  onClick={() => go(entry.page)}
                >
                  <span className="gn-outline__page">{entry.page}</span>
                  <span
                    className={`gn-outline__label${
                      entry.title ? "" : " gn-outline__label--none"
                    }`}
                  >
                    {entry.title ?? untitledLabel(entry)}
                  </span>
                  {entry.page === currentPage && (
                    <span className="gn-outline__current">Current</span>
                  )}
                  {entry.source === "pdf" && (
                    <span className="gn-outline__badge">PDF</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="gn-outline__done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
