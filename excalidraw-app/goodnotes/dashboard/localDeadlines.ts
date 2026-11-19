/**
 * "Up next" from the library's own due dates.
 *
 * The Canvas strip above this one answers "what is due?" by asking an LMS.
 * But every notebook already carries a `dueDate` the student typed in, and
 * with no Canvas connection the home screen did nothing with it: the dates
 * existed, were shown on each card, and were scattered through a grid
 * sorted by "recently opened". The one question a student opens this app
 * to answer — what is due next — needed a filter click to answer.
 *
 * Same rule as the Canvas strip: when there is nothing to say, the strip
 * does not render at all. No empty state, no "nothing due" card.
 */

import { getDueUrgency, isArchived } from "../library";

import type { DueUrgency } from "../library";
import type { DocMeta } from "../types";

const DAY = 24 * 60 * 60 * 1000;

/**
 * How far ahead to look. Two weeks is the horizon a student plans on; a
 * date three months out is not "up next", it is a calendar entry, and
 * putting it here would push the thing due tomorrow down the list.
 */
export const UP_NEXT_WINDOW_MS = 14 * DAY;

/**
 * How far back to keep showing something overdue. Long enough that work
 * missed over a week is still in front of you, short enough that last
 * term's forgotten deadline is not.
 */
export const UP_NEXT_OVERDUE_MS = 14 * DAY;

/** Never more than this many — it is a glance, not a list. */
export const UP_NEXT_LIMIT = 4;

export interface LocalDeadline {
  doc: DocMeta;
  dueAt: number;
  urgency: DueUrgency;
}

/**
 * Notebooks with a due date near enough to act on, soonest first.
 *
 * Archived notebooks are excluded: archiving is how a student says "this
 * is done with", and a finished course's old deadlines must not crowd out
 * this week's. Trashed ones never reach here — the caller passes live
 * documents only.
 */
export const buildLocalDeadlines = (
  docs: readonly DocMeta[],
  now: number,
  limit: number = UP_NEXT_LIMIT,
): LocalDeadline[] =>
  docs
    .filter(
      (doc) =>
        typeof doc.dueDate === "number" &&
        !isArchived(doc) &&
        doc.dueDate <= now + UP_NEXT_WINDOW_MS &&
        doc.dueDate >= now - UP_NEXT_OVERDUE_MS,
    )
    .map((doc) => ({
      doc,
      dueAt: doc.dueDate as number,
      urgency: getDueUrgency(doc.dueDate as number, now),
    }))
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, Math.max(0, limit));
