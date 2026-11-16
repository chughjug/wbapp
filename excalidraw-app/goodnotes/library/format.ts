/**
 * Pure presentation helpers shared by the shelf, the grid card and the list
 * row. Kept out of `Shelf.tsx` so the leaf components can import them without
 * a cycle. `Shelf.tsx` re-exports the three public ones for API compatibility.
 */

import type { DocMeta } from "../types";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** "Due soon" window. */
export const SOON_MS = 48 * HOUR;

export type DueUrgency = "overdue" | "soon" | "upcoming" | "none";

export const getDueUrgency = (
  dueDate: number | null,
  now: number = Date.now(),
): DueUrgency => {
  if (dueDate == null) {
    return "none";
  }
  if (dueDate < now) {
    return "overdue";
  }
  if (dueDate - now <= SOON_MS) {
    return "soon";
  }
  return "upcoming";
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export const formatDueDate = (
  dueDate: number | null,
  now: number = Date.now(),
): string => {
  if (dueDate == null) {
    return "No due date";
  }
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfDue = new Date(dueDate).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDue - startOfToday) / DAY);
  if (days === 0) {
    return "Due today";
  }
  if (days === 1) {
    return "Due tomorrow";
  }
  if (days === -1) {
    return "Due yesterday";
  }
  if (days < 0) {
    return `${Math.abs(days)} days overdue`;
  }
  if (days <= 7) {
    return `Due in ${days} days`;
  }
  return `Due ${dateFormatter.format(dueDate)}`;
};

export const formatUpdatedAt = (
  updatedAt: number,
  now: number = Date.now(),
): string => {
  const diff = Math.max(0, now - updatedAt);
  if (diff < HOUR) {
    const minutes = Math.floor(diff / 60000);
    return minutes <= 1 ? "Edited just now" : `Edited ${minutes} min ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `Edited ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return `Edited ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return `Edited ${dateFormatter.format(updatedAt)}`;
};

/** Short "12 Mar" style date, for the dense list's columns. */
export const formatShortDate = (timestamp: number): string =>
  dateFormatter.format(timestamp);

/** Stable 0-359 hue from a document id, for the placeholder cover. */
export const hueFromId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360000;
  }
  return hash % 360;
};

export const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("") || "?";

/** Bytes -> "1.2 MB". Used by the sidebar's storage line. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${
    value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)
  } ${units[exponent]}`;
};

/** The accessible name of a document card/row: never relies on colour. */
export const describeDocument = (
  doc: DocMeta,
  now: number,
  isFavourite: boolean,
  visibleTags: string[],
): string =>
  [
    `Open ${doc.title}`,
    doc.course ? `course ${doc.course}` : "no course",
    doc.dueDate != null
      ? formatDueDate(doc.dueDate, now).toLowerCase()
      : "no due date",
    `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`,
    isFavourite ? "favourite" : null,
    visibleTags.length ? `tags ${visibleTags.join(", ")}` : null,
    formatUpdatedAt(doc.updatedAt, now).toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");
