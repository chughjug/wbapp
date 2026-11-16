/**
 * The library's filter model: what the left sidebar selects, plus the
 * predicates the main area applies.
 *
 * RESERVED TAGS — why flags live in `DocMeta.tags` rather than new fields:
 * `DocMeta` already carries `tags: string[]`, and the shared contract
 * (goodnotes/types.ts) is not ours to widen. "Starred", "archived" and
 * "pinned" are each exactly a one-bit label, so each *is* a tag. Storing them
 * as the reserved tags below means:
 *   - one source of truth, written through the existing `updateDocMeta`, so a
 *     flag can never drift from the document (a second store would need its
 *     own delete/duplicate bookkeeping, and `deleteDoc` is not ours to
 *     change);
 *   - `duplicateDoc` and any export/tabs consumer carry them for free;
 *   - zero migration and zero new failure mode when IndexedDB is partially
 *     wiped;
 *   - bulk flag changes are the same single batched write as any other bulk
 *     tag edit, instead of three different code paths.
 * The cost is that these three names are reserved: a user who types
 * "archived" as a tag archives the document. That is the least surprising
 * possible collision, and all three are hidden from the chip lists, the tag
 * editor and the sidebar's tag index so they never show up twice.
 */

import { isInCourseTree } from "./coursePath";
import { DAY } from "./format";

import type { DocMeta } from "../types";

/** Reserved tag used as the starred flag. Compared case-insensitively. */
export const FAVOURITE_TAG = "favourite";

/** Reserved tag: hidden from every view except the Archived filter. */
export const ARCHIVED_TAG = "archived";

/** Reserved tag: sorts to the top of the shelf, in every sort order. */
export const PINNED_TAG = "pinned";

/** Every reserved tag, lowercase. Never offered or shown as a user tag. */
export const RESERVED_TAGS: readonly string[] = [
  FAVOURITE_TAG,
  ARCHIVED_TAG,
  PINNED_TAG,
];

/** Case/whitespace-insensitive comparison key for a tag. */
export const tagKey = (tag: string): string => tag.trim().toLowerCase();

export const isReservedTag = (tag: string): boolean =>
  RESERVED_TAGS.includes(tagKey(tag));

const hasTag = (doc: DocMeta, tag: string): boolean =>
  doc.tags.some((it) => tagKey(it) === tagKey(tag));

/** Documents opened within this window appear under "Recent". */
export const RECENT_WINDOW_MS = 30 * DAY;

export const isFavourite = (doc: DocMeta): boolean =>
  hasTag(doc, FAVOURITE_TAG);

export const isArchived = (doc: DocMeta): boolean => hasTag(doc, ARCHIVED_TAG);

export const isPinned = (doc: DocMeta): boolean => hasTag(doc, PINNED_TAG);

/** True when the document carries `tag` (case-insensitive). */
export const hasUserTag = (doc: DocMeta, tag: string): boolean =>
  hasTag(doc, tag);

/** Tags minus every reserved flag — what the UI actually renders. */
export const visibleTags = (doc: DocMeta): string[] =>
  doc.tags.filter((tag) => !isReservedTag(tag));

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
  | { kind: "archived" }
  | { kind: "tag"; tag: string }
  | { kind: "course"; course: string };

export const FILTER_ALL: LibraryFilter = { kind: "all" };

/** Stable string id — used as a React key and for `aria-current` bookkeeping. */
export const filterId = (filter: LibraryFilter): string => {
  switch (filter.kind) {
    case "course":
      return `course:${filter.course}`;
    case "tag":
      return `tag:${tagKey(filter.tag)}`;
    default:
      return filter.kind;
  }
};

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
    case "archived":
      return "Archived";
    case "tag":
      return `#${filter.tag}`;
    case "course":
      return filter.course.split("/").join(" / ");
    case "all":
    default:
      return "All documents";
  }
};

/**
 * Does the document belong to this filter, ignoring archive visibility?
 * A course filter matches the whole sub-tree, so "MATH 221" includes
 * "MATH 221 / Problem sets".
 */
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
    case "archived":
      return isArchived(doc);
    case "tag":
      return hasTag(doc, filter.tag);
    case "course":
      return isInCourseTree(doc.course, filter.course);
    case "all":
    default:
      return true;
  }
};

/**
 * Archived documents are hidden everywhere except the Archived filter: that
 * is the whole point of archiving. Kept separate from `matchesFilter` so the
 * sidebar can still count "all documents" honestly.
 */
export const isHiddenByArchive = (
  doc: DocMeta,
  filter: LibraryFilter,
): boolean => filter.kind !== "archived" && isArchived(doc);

/** The single predicate the shelf applies: filter + archive visibility. */
export const isInView = (
  doc: DocMeta,
  filter: LibraryFilter,
  now: number,
): boolean =>
  matchesFilter(doc, filter, now) && !isHiddenByArchive(doc, filter);

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
