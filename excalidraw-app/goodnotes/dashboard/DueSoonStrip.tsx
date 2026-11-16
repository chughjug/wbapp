/**
 * "Due soon" — the headline of the home screen.
 *
 * Renders only when Canvas is connected; the disconnected screen has no
 * deadline strip at all (see Dashboard.tsx for why that is the point).
 *
 * The strip owns a fixed-height row from its first paint, so the three
 * states (skeleton, cards, failure) occupy the same box and the document
 * grid below never moves as deadlines arrive.
 */

import React, { useCallback, useState } from "react";

import { createDocumentForAssignment } from "../canvas";

import { DeadlineCard, DeadlineSkeleton } from "./DeadlineCard";
import { buildDeadlines } from "./model";

import type { DeadlineItem } from "./model";
import type { UpcomingWorkState } from "./useUpcomingWork";
import type { CourseStyle } from "../library";
import type { DocMeta } from "../types";

export interface DueSoonStripProps {
  state: UpcomingWorkState;
  now: number;
  /** Resolved colour/emoji for a course path. */
  styleOf: (course: string) => CourseStyle;
  onOpenDocument: (doc: DocMeta) => void;
  /** Heading id, so the section can be labelled by it. */
  headingId: string;
}

const SKELETON_COUNT = 3;

export const DueSoonStrip = ({
  state,
  now,
  styleOf,
  onOpenDocument,
  headingId,
}: DueSoonStripProps) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Notebooks created from this screen, keyed by assignment id. Canvas is
   * not re-polled after a create (that would be a network round trip to
   * learn something we already know), so the card flips to "Open notes"
   * from here until the next sync folds it into `row.existing`.
   */
  const [created, setCreated] = useState<Record<string, DocMeta>>({});

  const deadlines = buildDeadlines(state.rows, now).map((item) =>
    item.existing || !created[item.id]
      ? item
      : { ...item, existing: created[item.id] },
  );

  const handleActivate = useCallback(
    (item: DeadlineItem) => {
      setActionError(null);
      if (item.existing) {
        onOpenDocument(item.existing);
        return;
      }
      setBusyId(item.id);
      void createDocumentForAssignment(item.row)
        .then((doc) => {
          setCreated((current) => ({ ...current, [item.id]: doc }));
          onOpenDocument(doc);
        })
        .catch((error: unknown) => {
          setActionError(
            `Could not create notes for “${item.title}”. ${
              error instanceof Error ? error.message : ""
            }`.trim(),
          );
        })
        .finally(() => setBusyId(null));
    },
    [onOpenDocument],
  );

  const isFirstLoad = state.status === "loading" && state.rows.length === 0;
  const hasFailedCold = state.status === "error" && state.rows.length === 0;

  return (
    <section className="gn-dash__section" aria-labelledby={headingId}>
      <div className="gn-dash__section-head">
        <h2 className="gn-dash__h2" id={headingId}>
          Due soon
        </h2>
        <div className="gn-dash__section-end">
          <span className="gn-dash__muted">
            {state.status === "loading"
              ? "Checking Canvas…"
              : state.status === "ready"
              ? `${deadlines.length} to do`
              : ""}
          </span>
          <button
            type="button"
            className="gn-dash__button"
            onClick={state.syncDueDates}
            disabled={state.refreshing}
          >
            {state.refreshing ? "Syncing…" : "Sync Canvas"}
          </button>
        </div>
      </div>

      {/* the single announcement channel for this screen */}
      <p className="gn-dash__sr-only" role="status" aria-live="polite">
        {actionError ?? state.statusMessage}
      </p>

      <div className="gn-dash__strip">
        {isFirstLoad ? (
          <ul className="gn-dash__row">
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <DeadlineSkeleton key={index} index={index} />
            ))}
          </ul>
        ) : hasFailedCold ? (
          <div className="gn-dash__notice">
            <p className="gn-dash__notice-text">
              {state.errorMessage ?? "Canvas could not be reached."} Your
              documents below are unaffected.
            </p>
            <button
              type="button"
              className="gn-dash__button"
              onClick={state.reload}
              disabled={state.refreshing}
            >
              Try again
            </button>
          </div>
        ) : deadlines.length === 0 ? (
          <p className="gn-dash__empty">
            Nothing due in the next two weeks. Enjoy it.
          </p>
        ) : (
          <ul className="gn-dash__row">
            {deadlines.map((item) => {
              const style = styleOf(item.course);
              return (
                <DeadlineCard
                  key={item.id}
                  item={item}
                  now={now}
                  color={style.color}
                  emoji={style.emoji}
                  busy={busyId === item.id}
                  onActivate={handleActivate}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* a refresh that failed over existing cards: keep the cards, say so */}
      {state.status === "error" && state.rows.length > 0 && (
        <p className="gn-dash__inline-error">
          {state.errorMessage}{" "}
          <button
            type="button"
            className="gn-dash__link-button"
            onClick={state.reload}
          >
            Try again
          </button>
        </p>
      )}

      {actionError && <p className="gn-dash__inline-error">{actionError}</p>}
    </section>
  );
};
