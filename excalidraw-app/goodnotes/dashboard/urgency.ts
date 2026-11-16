/**
 * The deadline urgency model.
 *
 * WHY NOT REUSE `getDueUrgency` FROM goodnotes/library: that one answers a
 * document-card question ("is this overdue / within 48h / later") in four
 * buckets. The dashboard's headline strip needs the calendar-day buckets a
 * student actually thinks in — *today* and *tomorrow* are different answers,
 * and "this week" has to line up exactly with the library's own
 * "Due this week" filter so the sidebar count and the strip never disagree.
 * So the week boundary is taken from the library's `endOfDueWeek`, and only
 * the day-level split is added on top.
 *
 * COLOUR IS NEVER THE SIGNAL. Every bucket has a short text label
 * (`urgencyLabel`) that is rendered inside the chip, so the urgency survives
 * greyscale, dark theme and a screen reader.
 */

import { endOfDueWeek } from "../library";

/** Soonest-first ordering of the deadline buckets. */
export type DeadlineUrgency =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later";

/** Overdue work older than this is noise, not a deadline. */
export const OVERDUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

const startOfDay = (timestamp: number): number =>
  new Date(timestamp).setHours(0, 0, 0, 0);

/** Whole calendar days from `now` to `dueAt` (negative = in the past). */
export const daysUntil = (dueAt: number, now: number): number =>
  Math.round((startOfDay(dueAt) - startOfDay(now)) / 86400000);

export const getUrgency = (
  dueAt: number | null,
  now: number,
): DeadlineUrgency => {
  if (dueAt == null) {
    return "later";
  }
  if (dueAt < now) {
    return "overdue";
  }
  const days = daysUntil(dueAt, now);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  return dueAt <= endOfDueWeek(now) ? "week" : "later";
};

/** Sort weight — soonest bucket first. */
export const urgencyRank = (urgency: DeadlineUrgency): number =>
  ["overdue", "today", "tomorrow", "week", "later"].indexOf(urgency);

/** The text that is always rendered next to the colour. */
export const urgencyLabel = (urgency: DeadlineUrgency): string => {
  switch (urgency) {
    case "overdue":
      return "Overdue";
    case "today":
      return "Due today";
    case "tomorrow":
      return "Due tomorrow";
    case "week":
      return "This week";
    case "later":
    default:
      return "Later";
  }
};

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** "Fri 21 Nov, 11:59 pm" — the exact deadline, under the relative chip. */
export const formatDeadline = (dueAt: number | null): string =>
  dueAt == null
    ? "No due date"
    : `${dayFormatter.format(dueAt)}, ${timeFormatter.format(dueAt)}`;

/**
 * Relative phrase used in accessible names: "2 days overdue", "in 3 days".
 * Deliberately spelled out rather than left to the chip, because a chip
 * reading only "Overdue" hides *how* overdue.
 */
export const formatRelative = (dueAt: number | null, now: number): string => {
  if (dueAt == null) {
    return "no due date";
  }
  const days = daysUntil(dueAt, now);
  if (dueAt < now) {
    return days === 0
      ? "overdue, earlier today"
      : `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  }
  if (days === 0) {
    return "due later today";
  }
  if (days === 1) {
    return "due tomorrow";
  }
  return `due in ${days} days`;
};
