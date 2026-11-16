/**
 * Pure projection from "what Canvas said" + "what is in the library" to the
 * two things the dashboard renders: the deadline strip and the course cards.
 *
 * Kept free of React and of IndexedDB so the ordering rules (which is the
 * part that is easy to get subtly wrong) can be reasoned about — and tested —
 * on plain data.
 */

import { isInCourseTree } from "../library";

import { OVERDUE_GRACE_MS, getUrgency, urgencyRank } from "./urgency";

import type { DeadlineUrgency } from "./urgency";
import type { AssignmentRow } from "../canvas";
import type { DocMeta } from "../types";

/** How many deadline cards the strip shows at most. */
export const MAX_DEADLINE_CARDS = 6;

export interface DeadlineItem {
  /** Canvas assignment id — stable React key. */
  id: string;
  row: AssignmentRow;
  title: string;
  /**
   * The course string this assignment's notes carry. MUST match what
   * `createDocumentForAssignment` writes (`course_code` falling back to
   * `name`), otherwise a created notebook would not line up with its course
   * card. Mirrored here rather than imported because goodnotes/canvas does
   * not export it.
   */
  course: string;
  dueAt: number | null;
  urgency: DeadlineUrgency;
  /** The notebook that already exists for this assignment, if any. */
  existing: DocMeta | null;
}

/** The course label the canvas module stores on a created document. */
export const courseLabelOf = (row: AssignmentRow): string =>
  row.course.course_code?.trim() || row.course.name;

const dueAtOf = (row: AssignmentRow): number | null => {
  if (!row.assignment.due_at) {
    return null;
  }
  const parsed = new Date(row.assignment.due_at).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

export const toDeadlineItem = (
  row: AssignmentRow,
  now: number,
): DeadlineItem => {
  const dueAt = dueAtOf(row);
  return {
    id: row.assignment.id,
    row,
    title: row.assignment.name,
    course: courseLabelOf(row),
    dueAt,
    urgency: getUrgency(dueAt, now),
    existing: row.existing,
  };
};

/**
 * The strip's contents: soonest first, long-dead work dropped, capped.
 *
 * Two deliberate rules:
 *  - work that went overdue more than `OVERDUE_GRACE_MS` ago is dropped. A
 *    term's worth of missed assignments would otherwise permanently bury the
 *    thing that is actually due tomorrow, which is the one question this
 *    screen exists to answer.
 *  - assignments with no due date never appear. `listUpcomingWork` already
 *    filters them out; this is belt and braces so a future change there
 *    cannot put an undated row at the top of the sort.
 */
export const buildDeadlines = (
  rows: readonly AssignmentRow[],
  now: number,
  limit: number = MAX_DEADLINE_CARDS,
): DeadlineItem[] =>
  rows
    .map((row) => toDeadlineItem(row, now))
    .filter((item) => item.dueAt != null)
    .filter((item) => now - (item.dueAt as number) <= OVERDUE_GRACE_MS)
    .sort(
      (a, b) =>
        urgencyRank(a.urgency) - urgencyRank(b.urgency) ||
        (a.dueAt as number) - (b.dueAt as number) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);

export interface CourseSummary {
  /** Course path as the library stores it — what a course filter selects. */
  course: string;
  /** Notebooks in this course *and its sub-courses*. */
  notebookCount: number;
  /** Canvas assignments with a due date in this course. */
  canvasCount: number;
  /** Most urgent bucket among this course's live deadlines, if any. */
  urgency: DeadlineUrgency | null;
  nextDueAt: number | null;
}

/**
 * One card per Canvas course, ordered by urgency then name, so the course
 * with something due tomorrow sits first.
 */
export const buildCourseSummaries = (
  rows: readonly AssignmentRow[],
  docs: readonly DocMeta[],
  now: number,
): CourseSummary[] => {
  const byCourse = new Map<string, CourseSummary>();

  for (const row of rows) {
    const course = courseLabelOf(row);
    const item = toDeadlineItem(row, now);
    const summary = byCourse.get(course) ?? {
      course,
      notebookCount: 0,
      canvasCount: 0,
      urgency: null,
      nextDueAt: null,
    };
    summary.canvasCount += 1;
    const live = item.dueAt != null && now - item.dueAt <= OVERDUE_GRACE_MS;
    if (live) {
      if (
        summary.urgency == null ||
        urgencyRank(item.urgency) < urgencyRank(summary.urgency)
      ) {
        summary.urgency = item.urgency;
      }
      if (
        summary.nextDueAt == null ||
        (item.dueAt as number) < summary.nextDueAt
      ) {
        summary.nextDueAt = item.dueAt;
      }
    }
    byCourse.set(course, summary);
  }

  for (const summary of byCourse.values()) {
    summary.notebookCount = docs.filter((doc) =>
      isInCourseTree(doc.course, summary.course),
    ).length;
  }

  return [...byCourse.values()].sort(
    (a, b) =>
      (a.urgency == null ? 99 : urgencyRank(a.urgency)) -
        (b.urgency == null ? 99 : urgencyRank(b.urgency)) ||
      a.course.localeCompare(b.course),
  );
};
