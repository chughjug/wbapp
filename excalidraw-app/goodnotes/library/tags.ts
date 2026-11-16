/**
 * The tag index: distinct user tags across the library, with counts, plus the
 * autocomplete helper the editors and the bulk bar share.
 *
 * Tags are stored case-preserving but compared case-insensitively (`tagKey`),
 * so "Exam" and "exam" are one tag. The *first* spelling seen (in
 * most-recently-updated order, which is how `listDocs` returns rows) wins as
 * the display form, so renaming the casing of a tag is a real edit rather
 * than a coin flip.
 */

import { isReservedTag, tagKey, visibleTags } from "./filters";

import type { DocMeta } from "../types";

export interface TagCount {
  /** Display spelling. */
  tag: string;
  /** Lowercase comparison key. */
  key: string;
  count: number;
}

/** Distinct user tags with document counts, alphabetical. */
export const buildTagIndex = (documents: readonly DocMeta[]): TagCount[] => {
  const map = new Map<string, TagCount>();
  for (const doc of documents) {
    for (const tag of visibleTags(doc)) {
      const key = tagKey(tag);
      if (!key) {
        continue;
      }
      const row = map.get(key);
      if (row) {
        row.count++;
      } else {
        map.set(key, { tag: tag.trim(), key, count: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
};

/** How many documents carry `tag` (case-insensitive). */
export const countDocsWithTag = (
  documents: readonly DocMeta[],
  tag: string,
): number => {
  const key = tagKey(tag);
  return documents.filter((doc) => doc.tags.some((it) => tagKey(it) === key))
    .length;
};

/**
 * Autocomplete: tags whose text contains `query`, prefix matches first, with
 * anything in `exclude` (already applied to the document being edited) and
 * every reserved tag removed.
 */
export const suggestTags = (
  index: readonly TagCount[],
  query: string,
  exclude: readonly string[] = [],
  limit = 8,
): TagCount[] => {
  const needle = tagKey(query);
  const excluded = new Set(exclude.map(tagKey));
  const matches = index.filter(
    (row) =>
      !excluded.has(row.key) &&
      !isReservedTag(row.tag) &&
      (!needle || row.key.includes(needle)),
  );
  matches.sort((a, b) => {
    if (needle) {
      const aPrefix = a.key.startsWith(needle) ? 0 : 1;
      const bPrefix = b.key.startsWith(needle) ? 0 : 1;
      if (aPrefix !== bPrefix) {
        return aPrefix - bPrefix;
      }
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.tag.localeCompare(b.tag);
  });
  return matches.slice(0, limit);
};

/**
 * Apply a tag rename to one document's tag array, preserving order and
 * de-duplicating if the target spelling already exists. Returns the same
 * array instance when nothing changes, so callers can skip the write.
 */
export const renameTagInList = (
  tags: readonly string[],
  from: string,
  to: string,
): string[] => {
  const fromKey = tagKey(from);
  const toValue = to.trim();
  const toKeyValue = tagKey(toValue);
  const out: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const tag of tags) {
    const next = tagKey(tag) === fromKey ? toValue : tag;
    if (next !== tag) {
      changed = true;
    }
    const key = tagKey(next);
    if (!key || seen.has(key)) {
      changed = changed || seen.has(key);
      continue;
    }
    seen.add(key);
    out.push(next);
  }
  if (!toKeyValue) {
    // renaming to nothing is a delete
    return tags.filter((tag) => tagKey(tag) !== fromKey);
  }
  return changed ? out : [...tags];
};

/** Remove a tag (case-insensitive) from one document's tag array. */
export const removeTagFromList = (
  tags: readonly string[],
  tag: string,
): string[] => {
  const key = tagKey(tag);
  return tags.filter((it) => tagKey(it) !== key);
};

/** Add a tag unless an equal-key tag is already present. */
export const addTagToList = (
  tags: readonly string[],
  tag: string,
): string[] => {
  const value = tag.trim();
  if (!value || tags.some((it) => tagKey(it) === tagKey(value))) {
    return [...tags];
  }
  return [...tags, value];
};
