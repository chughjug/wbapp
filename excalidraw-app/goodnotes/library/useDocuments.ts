/**
 * React binding for the document library store.
 *
 * Holds the shelf's `DocMeta[]`, a loading flag, and the mutation actions.
 * The returned `actions` object is referentially stable for the lifetime of the
 * hook, so it can be passed to memoised children without defeating them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as store from "./store";

import type { DocMeta } from "../types";

export interface DocumentActions {
  /** Re-read the metadata store. */
  refresh: () => Promise<void>;
  /** Create a document; resolves with the new (already-listed) metadata. */
  create: (init?: Partial<DocMeta>) => Promise<DocMeta>;
  rename: (id: string, title: string) => Promise<DocMeta>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<DocMeta>;
  /** `null` clears the due date. */
  setDueDate: (id: string, dueDate: number | null) => Promise<DocMeta>;
  /** `null` or an empty string clears the course. */
  setCourse: (id: string, course: string | null) => Promise<DocMeta>;
  /** No-op when the tag is blank or already present (case-insensitive). */
  addTag: (id: string, tag: string) => Promise<DocMeta>;
  removeTag: (id: string, tag: string) => Promise<DocMeta>;
  setThumbnail: (id: string, dataUrl: string) => Promise<void>;
  /** Stamp `lastOpenedAt`; call this when routing into the editor. */
  touch: (id: string) => Promise<void>;
}

export interface UseDocumentsResult {
  documents: DocMeta[];
  /** True until the first read of the store resolves. */
  loading: boolean;
  error: Error | null;
  /** Distinct, sorted course names across the library (for the filter UI). */
  courses: string[];
  actions: DocumentActions;
}

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
      remove: (id: string) => store.deleteDoc(id),
      duplicate: (id: string) => store.duplicateDoc(id),
      setDueDate: (id: string, dueDate: number | null) =>
        store.updateDocMeta(id, { dueDate }),
      setCourse: (id: string, course: string | null) =>
        store.updateDocMeta(id, {
          course: course?.trim() ? course.trim() : null,
        }),
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
      setThumbnail: async (id: string, dataUrl: string) => {
        await store.setThumbnail(id, dataUrl);
      },
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

  return { documents, loading, error, courses, actions };
};
