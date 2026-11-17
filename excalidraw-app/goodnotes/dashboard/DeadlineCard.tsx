/**
 * One deadline as a timeline row — a single real `<button>` so there is
 * exactly one tab stop and exactly one action.
 *
 * Accessible name is composed, not inferred: it always states the action,
 * the assignment, its course and its urgency in words, because the left
 * urgency mark's colour carries no meaning on its own.
 */

import React from "react";

import { formatDeadline, formatRelative, urgencyLabel } from "./urgency";

import type { DeadlineItem } from "./model";

export interface DeadlineCardProps {
  item: DeadlineItem;
  now: number;
  /** Course dot colour, resolved from the library's course-style store. */
  color: string;
  emoji: string | null;
  /** True while this card's "Create notes" is in flight. */
  busy?: boolean;
  onActivate: (item: DeadlineItem) => void;
}

export const DeadlineCard = React.memo(
  ({
    item,
    now,
    color,
    emoji,
    busy = false,
    onActivate,
  }: DeadlineCardProps) => {
    const action = item.existing ? "Open notes" : "Create notes";
    const name = [
      `${action} for ${item.title}`,
      item.course,
      urgencyLabel(item.urgency).toLowerCase(),
      formatRelative(item.dueAt, now),
      formatDeadline(item.dueAt),
      item.existing ? "notes already exist" : "no notes yet",
    ].join(", ");

    return (
      <li className="gn-dash__cell">
        <button
          type="button"
          className={`gn-dash__row-item gn-dash__row-item--${item.urgency}`}
          aria-label={name}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => onActivate(item)}
        >
          <span className="gn-dash__urgency" aria-hidden="true" />
          <span className="gn-dash__row-main">
            <span className="gn-dash__row-title">{item.title}</span>
            <span className="gn-dash__row-meta">
              <span
                className="gn-dash__dot"
                aria-hidden="true"
                style={{ backgroundColor: color }}
              >
                {emoji}
              </span>
              <span className="gn-dash__card-course-name">{item.course}</span>
              <span className="gn-dash__row-sep" aria-hidden="true">
                ·
              </span>
              <span className="gn-dash__card-when">
                {urgencyLabel(item.urgency)} · {formatDeadline(item.dueAt)}
              </span>
            </span>
          </span>
          <span className="gn-dash__card-action">
            {busy ? "Creating…" : action}
          </span>
        </button>
      </li>
    );
  },
);
DeadlineCard.displayName = "DeadlineCard";

/**
 * Placeholder with the *same* box as a real row. The strip reserves its
 * height from the first paint, so deadlines arriving later never push the
 * document grid down.
 */
export const DeadlineSkeleton = ({ index }: { index: number }) => (
  <li className="gn-dash__cell" aria-hidden="true">
    <div
      className={`gn-dash__row-item gn-dash__row-item--skeleton gn-dash__card--s${index}`}
    >
      <span className="gn-dash__urgency gn-dash__urgency--sk" />
      <span className="gn-dash__row-main">
        <span className="gn-dash__sk gn-dash__sk--title" />
        <span className="gn-dash__sk gn-dash__sk--course" />
      </span>
      <span className="gn-dash__sk gn-dash__sk--foot" />
    </div>
  </li>
);
