/**
 * React binding for the document library store.
 *
 * Holds the shelf's `DocMeta[]`, a loading flag, and the mutation actions.
 * The returned `actions` object is referentially stable for the lifetime of the
 * hook, so it can be passed to memoised children without defeating them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as store from "./store";
import {
  ARCHIVED_TAG,
  FAVOURITE_TAG,
  PINNED_TAG,
  isArchived,
  isFavourite,
  isPinned,
} from "./filters";
import { renameCourseStyleTree } from "./courses";
import { buildCourseTree, normalizeCoursePath } from "./coursePath";
import { buildTagIndex } from "./tags";

import type { CourseNode } from "./coursePath";
import type { TagCount } from "./tags";
import type { DocMeta } from "../types";

export interface DocumentActions {
  /** Re-read the metadata store. */
  refresh: () => Promise<void>;
  /** Create a document; resolves with the new (already-listed) metadata. */
  create: (init?: Partial<DocMeta>) => Promise<DocMeta>;
  rename: (id: string, title: string) => Promise<DocMeta>;
  /**
   * Move to the trash — reversible, and what the shelf's delete action
   * calls. The document keeps its scene and reappears under "Recently
   * deleted" until the retention window expires.
   */
  remove: (id: string) => Promise<void>;
  /** Take a document back out of the trash. */
  restore: (id: string) => Promise<void>;
  /** Delete for good. Only reachable from inside "Recently deleted". */
  purge: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<DocMeta>;
  /** `null` clears the due date. */
  setDueDate: (id: string, dueDate: number | null) => Promise<DocMeta>;
  /** `null` or an empty string clears the course. */
  setCourse: (id: string, course: string | null) => Promise<DocMeta>;
  /** No-op when the tag is blank or already present (case-insensitive). */
  addTag: (id: string, tag: string) => Promise<DocMeta>;
  removeTag: (id: string, tag: string) => Promise<DocMeta>;
  /** Star/unstar. Stored as the reserved `FAVOURITE_TAG` (see filters.ts). */
  setFavourite: (id: string, favourite: boolean) => Promise<DocMeta>;
  toggleFavourite: (id: string) => Promise<DocMeta>;
  /** Hide from every view but Archived. Stored as the reserved archived tag. */
  setArchived: (id: string, archived: boolean) => Promise<DocMeta>;
  toggleArchived: (id: string) => Promise<DocMeta>;
  /** Stick to the top of the shelf. Stored as the reserved pinned tag. */
  setPinned: (id: string, pinned: boolean) => Promise<DocMeta>;
  togglePinned: (id: string) => Promise<DocMeta>;
  setThumbnail: (id: string, dataUrl: string) => Promise<void>;
  /** Stamp `lastOpenedAt`; call this when routing into the editor. */
  touch: (id: string) => Promise<void>;

  // ------------------------------------------------------------------ bulk
  // Each of these is ONE store notification regardless of how many documents
  // it touches, so the shelf repaints once per bulk action.

  /** Move many documents to a course path (`null` clears it). */
  bulkSetCourse: (
    ids: readonly string[],
    course: string | null,
  ) => Promise<DocMeta[]>;
  bulkSetDueDate: (
    ids: readonly string[],
    dueDate: number | null,
  ) => Promise<DocMeta[]>;
  bulkAddTag: (ids: readonly string[], tag: string) => Promise<DocMeta[]>;
  bulkRemoveTag: (ids: readonly string[], tag: string) => Promise<DocMeta[]>;
  bulkSetFavourite: (
    ids: readonly string[],
    favourite: boolean,
  ) => Promise<DocMeta[]>;
  bulkSetArchived: (
    ids: readonly string[],
    archived: boolean,
  ) => Promise<DocMeta[]>;
  bulkSetPinned: (
    ids: readonly string[],
    pinned: boolean,
  ) => Promise<DocMeta[]>;
  bulkDuplicate: (ids: readonly string[]) => Promise<DocMeta[]>;
  /** Delete many. ONE confirmation belongs in the UI, not here. */
  bulkRemove: (ids: readonly string[]) => Promise<number>;
  bulkRestore: (ids: readonly string[]) => Promise<number>;
  bulkPurge: (ids: readonly string[]) => Promise<number>;

  // ------------------------------------------------------- library-wide ops
  /** Rename a tag on every document carrying it. Resolves with the count. */
  renameTag: (from: string, to: string) => Promise<number>;
  /** Remove a tag from every document. Resolves with the count. */
  deleteTag: (tag: string) => Promise<number>;
  /** Rename a course *and every course nested below it*. */
  renameCourse: (from: string, to: string) => Promise<number>;
  /** Clear the course of every document in a sub-tree (deletes no document). */
  removeCourse: (course: string) => Promise<number>;
}

export interface UseDocumentsResult {
  documents: DocMeta[];
  /** True until the first read of the store resolves. */
  loading: boolean;
  error: Error | null;
  /** Distinct, sorted course names across the library (for the filter UI). */
  courses: string[];
  /** The same courses as a nested tree, with per-node and subtree counts. */
  courseTree: CourseNode[];
  /** Distinct user tags (reserved flags excluded) with document counts. */
  tags: TagCount[];
  actions: DocumentActions;
}

const requireDoc = async (id: string): Promise<DocMeta> => {
  const doc = await store.getDoc(id);
  if (!doc) {
    throw new Error(`goodnotes/library: no such document "${id}"`);
  }
  return doc;
};

export const useDocuments = (): UseDocumentsResult => {
  const [documents, setDocuments] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const docs = await store.listDocs();
      if (mountedRef.current) {
        setDocuments(docs);
        setError(null);
      }
    } catch (err: any) {
      console.error("goodnotes/library: failed to list documents", err);
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    // every store mutation (including ones made elsewhere in the app) re-reads
    const unsubscribe = store.subscribe(() => {
      void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  const actions = useMemo<DocumentActions>(
    () => ({
      refresh,
      create: (init: Partial<DocMeta> = {}) => store.createDoc(init),
      rename: (id: string, title: string) =>
        store.updateDocMeta(id, {
          title: title.trim() || store.DEFAULT_DOC_TITLE,
        }),
      remove: async (id: string) => {
        await store.trashDoc(id);
      },
      restore: async (id: string) => {
        await store.restoreDoc(id);
      },
      purge: (id: string) => store.deleteDoc(id),
      duplicate: (id: string) => store.duplicateDoc(id),
      setDueDate: (id: string, dueDate: number | null) =>
        store.updateDocMeta(id, { dueDate }),
      setCourse: (id: string, course: string | null) =>
        store.updateDocMeta(id, { course: normalizeCoursePath(course) }),
      addTag: async (id: string, tag: string) => {
        const value = tag.trim();
        const doc = await store.getDoc(id);
        if (!doc) {
          throw new Error(`goodnotes/library: no such document "${id}"`);
        }
        if (
          !value ||
          doc.tags.some((it) => it.toLowerCase() === value.toLowerCase())
        ) {
          return doc;
        }
        return store.updateDocMeta(id, { tags: [...doc.tags, value] });
      },
      removeTag: async (id: string, tag: string) => {
        const doc = await store.getDoc(id);
        if (!doc) {
          throw new Error(`goodnotes/library: no such document "${id}"`);
        }
        return store.updateDocMeta(id, {
          tags: doc.tags.filter(
            (it) => it.toLowerCase() !== tag.trim().toLowerCase(),
          ),
        });
      },
      setFavourite: async (id: string, favourite: boolean) => {
        const doc = await store.getDoc(id);
        if (!doc) {
          throw new Error(`goodnotes/library: no such document "${id}"`);
        }
        const without = doc.tags.filter(
          (it) => it.trim().toLowerCase() !== FAVOURITE_TAG,
        );
        const next = favourite ? [...without, FAVOURITE_TAG] : without;
        if (next.length === doc.tags.length && favourite === isFavourite(doc)) {
          return doc;
        }
        return store.updateDocMeta(id, { tags: next });
      },
      toggleFavourite: async (id: string) => {
        const doc = await store.getDoc(id);
        if (!doc) {
          throw new Error(`goodnotes/library: no such document "${id}"`);
        }
        const starred = isFavourite(doc);
        return store.updateDocMeta(id, {
          tags: starred
            ? doc.tags.filter((it) => it.trim().toLowerCase() !== FAVOURITE_TAG)
            : [...doc.tags, FAVOURITE_TAG],
        });
      },
      setArchived: async (id: string, archived: boolean) => {
        const [doc] = await store.setTagOnMany([id], ARCHIVED_TAG, archived);
        return doc ?? (await requireDoc(id));
      },
      toggleArchived: async (id: string) => {
        const doc = await requireDoc(id);
        const [next] = await store.setTagOnMany(
          [id],
          ARCHIVED_TAG,
          !isArchived(doc),
        );
        return next ?? doc;
      },
      setPinned: async (id: string, pinned: boolean) => {
        const [doc] = await store.setTagOnMany([id], PINNED_TAG, pinned);
        return doc ?? (await requireDoc(id));
      },
      togglePinned: async (id: string) => {
        const doc = await requireDoc(id);
        const [next] = await store.setTagOnMany(
          [id],
          PINNED_TAG,
          !isPinned(doc),
        );
        return next ?? doc;
      },
      setThumbnail: async (id: string, dataUrl: string) => {
        await store.setThumbnail(id, dataUrl);
      },
      bulkSetCourse: (ids, course) =>
        store.updateManyDocs(ids, { course: normalizeCoursePath(course) }),
      bulkSetDueDate: (ids, dueDate) => store.updateManyDocs(ids, { dueDate }),
      bulkAddTag: (ids, tag) =>
        tag.trim()
          ? store.setTagOnMany(ids, tag.trim(), true)
          : Promise.resolve([]),
      bulkRemoveTag: (ids, tag) =>
        tag.trim()
          ? store.setTagOnMany(ids, tag.trim(), false)
          : Promise.resolve([]),
      bulkSetFavourite: (ids, favourite) =>
        store.setTagOnMany(ids, FAVOURITE_TAG, favourite),
      bulkSetArchived: (ids, archived) =>
        store.setTagOnMany(ids, ARCHIVED_TAG, archived),
      bulkSetPinned: (ids, pinned) =>
        store.setTagOnMany(ids, PINNED_TAG, pinned),
      bulkDuplicate: (ids) => store.duplicateManyDocs(ids),
      bulkRemove: (ids) => store.trashManyDocs(ids),
      bulkRestore: (ids) => store.restoreManyDocs(ids),
      bulkPurge: (ids) => store.deleteManyDocs(ids),
      renameTag: (from: string, to: string) =>
        store.renameTagEverywhere(from, to),
      deleteTag: (tag: string) => store.deleteTagEverywhere(tag),
      renameCourse: async (from: string, to: string) => {
        const target = normalizeCoursePath(to);
        const source = normalizeCoursePath(from);
        if (!source || !target || source === target) {
          return 0;
        }
        // move the folder's colour/emoji with it before the documents move,
        // so the tree never renders a sub-course with a stranger's colour
        await renameCourseStyleTree(source, target);
        return store.renameCourseTree(source, target);
      },
      removeCourse: (course: string) => store.clearCourseTree(course),
      touch: async (id: string) => {
        await store.touchDoc(id);
      },
    }),
    [refresh],
  );

  const courses = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) {
      if (doc.course) {
        set.add(doc.course);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const courseTree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      if (doc.course) {
        counts.set(doc.course, (counts.get(doc.course) ?? 0) + 1);
      }
    }
    return buildCourseTree(courses, (path) => counts.get(path) ?? 0);
  }, [courses, documents]);

  const tags = useMemo(() => buildTagIndex(documents), [documents]);

  return { documents, loading, error, courses, courseTree, tags, actions };
};
