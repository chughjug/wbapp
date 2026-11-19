/**
 * "Earlier versions" — the list of dated snapshots of the open notebook,
 * with a button to put one back.
 *
 * Accessibility contract, the same one the maths and graph dialogs keep:
 * `role="dialog" aria-modal` labelled by its title and described by its
 * intro; focus moves in on mount, is trapped with Tab/Shift+Tab and restored
 * on close; Escape closes; the error region is `role="alert"`.
 *
 * Two deliberate choices in the interaction:
 *
 * - **Restoring asks first.** It overwrites the page you are looking at, and
 *   a list of near-identical timestamps is easy to mis-tap on a phone. The
 *   confirmation names the version by date so the answer is checkable.
 *
 * - **Restoring then offers "Undo".** `restoreSnapshot` leaves behind a
 *   pinned snapshot of what was replaced, so the undo is a real restore of
 *   a real stored version rather than an in-memory stack that dies with the
 *   dialog.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatShortDate } from "../library/format";

import { restoreSnapshot } from "./restore";
import { listSnapshots, setSnapshotPinned } from "./store";

import "./HistoryPanel.scss";

import type { SnapshotSummary } from "./store";

export interface HistoryPanelProps {
  docId: string;
  /** Escape, backdrop click, or Close. */
  onClose: () => void;
  /** Fired after a restore lands, so the host can reload the scene. */
  onRestored?: (docId: string) => void;
  theme?: "light" | "dark";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "11 minutes ago", "Yesterday, 14:02", "3 Nov, 09:30".
 *
 * Relative near the top of the list where the user is choosing between
 * versions minutes apart, absolute further down where the date is what
 * identifies it.
 */
export const describeSnapshotTime = (at: number, now: number): string => {
  const age = now - at;
  const time = new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (age < MINUTE) {
    return "Just now";
  }
  if (age < HOUR) {
    const minutes = Math.round(age / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (age < 6 * HOUR) {
    const hours = Math.round(age / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) {
    return `Today, ${time}`;
  }
  if (at >= startOfToday - DAY) {
    return `Yesterday, ${time}`;
  }
  return `${formatShortDate(at)}, ${time}`;
};

/** What a snapshot's `reason` means to someone reading the list. */
const describeReason = (summary: SnapshotSummary): string | null => {
  switch (summary.reason) {
    case "before-restore":
      return "Replaced by a restore";
    case "manual":
      return "Saved by you";
    default:
      return null;
  }
};

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  docId,
  onClose,
  onRestored,
  theme,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();

  const [versions, setVersions] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SnapshotSummary | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);

  /**
   * The clock the whole list is described against, frozen at the moment the
   * list was read. One shared value, so two rows cannot disagree about what
   * "an hour ago" means, and it is state rather than a render-time
   * `Date.now()` so re-rendering for an unrelated reason — opening the
   * confirmation, say — does not silently relabel every row.
   */
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const list = await listSnapshots(docId);
      if (!unmountedRef.current) {
        setNow(Date.now());
        setVersions(list);
      }
    } catch (caught) {
      if (!unmountedRef.current) {
        setVersions([]);
        setError(
          "Earlier versions could not be read. The notebook itself is fine.",
        );
      }
    }
  }, [docId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ---- focus ------------------------------------------------------------- */
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      unmountedRef.current = true;
      window.cancelAnimationFrame(frame);
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  const doRestore = useCallback(
    async (summary: SnapshotSummary) => {
      setConfirming(null);
      setBusyId(summary.id);
      setError(null);
      try {
        const result = await restoreSnapshot(summary.id);
        if (unmountedRef.current) {
          return;
        }
        if (!result) {
          setError(
            "That version is no longer stored. The list has been refreshed.",
          );
          await reload();
          return;
        }
        setUndoId(result.undo?.id ?? null);
        onRestored?.(docId);
        await reload();
      } catch (caught) {
        if (!unmountedRef.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : "That version could not be restored.",
          );
        }
      } finally {
        if (!unmountedRef.current) {
          setBusyId(null);
        }
      }
    },
    [docId, onRestored, reload],
  );

  const togglePin = useCallback(
    async (summary: SnapshotSummary) => {
      await setSnapshotPinned(summary.id, !summary.pinned);
      await reload();
    },
    [reload],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        if (confirming) {
          setConfirming(null);
        } else {
          onClose();
        }
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
    [confirming, onClose],
  );

  const body = (
    <div
      className={`gn-versions excalidraw ${
        theme === "dark" ? "theme--dark" : ""
      }`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="gn-versions__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-versions__head">
          <h2 className="gn-versions__title" id={titleId}>
            Earlier versions
          </h2>
          <button
            type="button"
            className="gn-versions__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close earlier versions"
          >
            ×
          </button>
        </div>

        <p className="gn-versions__intro" id={descriptionId}>
          This notebook is saved automatically every few minutes. Put any of
          these back if something has gone wrong — whatever is on the page now
          is kept first, so a restore can itself be undone.
        </p>

        {error && (
          <p className="gn-versions__error" role="alert">
            {error}
          </p>
        )}

        {undoId && (
          <div className="gn-versions__undo">
            <span>Restored.</span>
            <button
              type="button"
              onClick={() => {
                const target = versions?.find((v) => v.id === undoId);
                if (target) {
                  void doRestore(target);
                }
                setUndoId(null);
              }}
            >
              Undo
            </button>
          </div>
        )}

        {versions === null ? (
          <p className="gn-versions__empty">Reading earlier versions…</p>
        ) : versions.length === 0 ? (
          <p className="gn-versions__empty">
            No earlier versions yet. The first is kept a few minutes after you
            start writing.
          </p>
        ) : (
          <ul className="gn-versions__list">
            {versions.map((summary) => {
              const note = describeReason(summary);
              return (
                <li className="gn-versions__item" key={summary.id}>
                  <div className="gn-versions__when">
                    <span className="gn-versions__stamp">
                      {describeSnapshotTime(summary.at, now)}
                    </span>
                    <span className="gn-versions__meta">
                      {summary.pageCount} page
                      {summary.pageCount === 1 ? "" : "s"}
                      {note ? ` · ${note}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="gn-versions__pin"
                    aria-pressed={Boolean(summary.pinned)}
                    onClick={() => void togglePin(summary)}
                    title={
                      summary.pinned
                        ? "Kept: this version is never cleaned up"
                        : "Keep this version"
                    }
                  >
                    {summary.pinned ? "Kept" : "Keep"}
                  </button>
                  <button
                    type="button"
                    className="gn-versions__restore"
                    disabled={busyId !== null}
                    onClick={() => setConfirming(summary)}
                  >
                    {busyId === summary.id ? "Restoring…" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {confirming && (
          <div className="gn-versions__confirm" role="alertdialog">
            <p>
              Replace the page with the version from{" "}
              <strong>{describeSnapshotTime(confirming.at, now)}</strong>?
            </p>
            <div className="gn-versions__confirm-actions">
              <button type="button" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="gn-versions__confirm-go"
                onClick={() => void doRestore(confirming)}
              >
                Restore it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
