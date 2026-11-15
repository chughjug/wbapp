/**
 * The library's filter model: what the left sidebar selects, plus the
 * predicates the main area applies.
 *
 * FAVOURITES — why a reserved tag rather than a new store:
 * `DocMeta` already carries `tags: string[]`, and the shared contract
 * (goodnotes/types.ts) is not ours to widen. A "starred" flag is exactly a
 * one-bit label, so it *is* a tag. Storing it as the reserved tag below means:
 *   - one source of truth, written through the existing `updateDocMeta`, so it
 *     can never drift from the document (a second store would need its own
 *     delete/duplicate bookkeeping, and `deleteDoc` is not ours to change);
 *   - `duplicateDoc` and any export/tabs consumer carry it for free;
 *   - zero migration and zero new failure mode when IndexedDB is partially
 *     wiped.
 * The cost is that the name is reserved: a user who types "favourite" as a
 * tag stars the document. That is the least surprising possible collision, and
 * the tag is hidden from the chip list and the tag editor so it never shows up
 * twice.
 */

import { DAY } from "./format";

import type { DocMeta } from "../types";

/** Reserved tag used as the starred flag. Compared case-insensitively. */
export const FAVOURITE_TAG = "favourite";

/** Documents opened within this window appear under "Recent". */
export const RECENT_WINDOW_MS = 30 * DAY;

export const isFavourite = (doc: DocMeta): boolean =>
  doc.tags.some((tag) => tag.trim().toLowerCase() === FAVOURITE_TAG);

/** Tags minus the reserved favourite flag — what the UI actually renders. */
export const visibleTags = (doc: DocMeta): string[] =>
  doc.tags.filter((tag) => tag.trim().toLowerCase() !== FAVOURITE_TAG);

/**
 * End of the 7th day from `now`, local time. "Due this week" means "due by
 * then", and deliberately *includes* anything already overdue: an assignment
 * you missed on Monday is the most this-week thing on the list.
 */
export const endOfDueWeek = (now: number): number => {
  const end = new Date(now);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
};

export const isDueThisWeek = (doc: DocMeta, now: number): boolean =>
  doc.dueDate != null && doc.dueDate <= endOfDueWeek(now);

export const isRecent = (doc: DocMeta, now: number): boolean =>
  doc.lastOpenedAt != null && now - doc.lastOpenedAt <= RECENT_WINDOW_MS;

// ---------------------------------------------------------------------------
// the selection model
// ---------------------------------------------------------------------------

export type LibraryFilter =
  | { kind: "all" }
  | { kind: "favourites" }
  | { kind: "recent" }
  | { kind: "due-week" }
  | { kind: "course"; course: string };

export const FILTER_ALL: LibraryFilter = { kind: "all" };

/** Stable string id — used as a React key and for `aria-current` bookkeeping. */
export const filterId = (filter: LibraryFilter): string =>
  filter.kind === "course" ? `course:${filter.course}` : filter.kind;

export const filtersEqual = (a: LibraryFilter, b: LibraryFilter): boolean =>
  filterId(a) === filterId(b);

/** Short human label, reused by the sidebar and the main heading. */
export const filterLabel = (filter: LibraryFilter): string => {
  switch (filter.kind) {
    case "favourites":
      return "Favourites";
    case "recent":
      return "Recent";
    case "due-week":
      return "Due this week";
    case "course":
      return filter.course;
    case "all":
    default:
      return "All documents";
  }
};

export const matchesFilter = (
  doc: DocMeta,
  filter: LibraryFilter,
  now: number,
): boolean => {
  switch (filter.kind) {
    case "favourites":
      return isFavourite(doc);
    case "recent":
      return isRecent(doc, now);
    case "due-week":
      return isDueThisWeek(doc, now);
    case "course":
      return doc.course === filter.course;
    case "all":
    default:
      return true;
  }
};

/** Free-text match over title, course and (visible) tags. */
export const matchesQuery = (doc: DocMeta, query: string): boolean => {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  return (
    doc.title.toLowerCase().includes(needle) ||
    (doc.course ?? "").toLowerCase().includes(needle) ||
    visibleTags(doc).some((tag) => tag.toLowerCase().includes(needle))
  );
};
