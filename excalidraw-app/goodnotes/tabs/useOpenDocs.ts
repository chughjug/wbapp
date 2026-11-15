/**
 * React binding for the open-document model.
 *
 * Joins two sources of truth:
 *
 *   1. `openDocs.ts` — which documents are open, in which order, which is
 *      active. Synchronous, persisted in localStorage.
 *   2. `../library/store` — the documents themselves (IndexedDB). Metadata is
 *      hydrated asynchronously and re-read whenever the library emits a
 *      change, so a rename or a thumbnail refresh shows up in the strip
 *      without a reload.
 *
 * Tabs whose document has been deleted are dropped automatically once the
 * library has been read at least once.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { listDocs, subscribe, touchDoc } from "../library/store";

import {
  activateDoc,
  closeAllDocs,
  closeDoc,
  closeOtherDocs,
  getOpenDocs,
  openDoc,
  pruneOpenDocs,
  reorderDoc,
  subscribeOpenDocs,
  syncOpenDocsAcrossWindows,
} from "./openDocs";

import type { DocMeta } from "../types";
import type { OpenDocsState } from "./openDocs";

/** One entry in the tab strip. */
export interface OpenTab {
  /** Document id. Stable; usable as a React key. */
  id: string;
  /**
   * Library metadata, or `null` while it is still being read (or if the
   * document vanished and the prune has not run yet). Render a placeholder
   * title rather than hiding the tab.
   */
  meta: DocMeta | null;
  /** Whether this tab is the active one. */
  isActive: boolean;
}

/** Stable mutation handles. The object identity never changes. */
export interface OpenDocsActions {
  /** Open a document, or focus it if it is already open. */
  open: (docId: string) => void;
  /** Close a tab; a neighbour becomes active if the closed tab was active. */
  close: (docId: string) => void;
  /** Activate an open tab. */
  activate: (docId: string) => void;
  /** Move a tab to `toIndex`, clamped into range. */
  reorder: (docId: string, toIndex: number) => void;
  /** Close every tab but this one. */
  closeOthers: (docId: string) => void;
  /** Close every tab. */
  closeAll: () => void;
}

export interface UseOpenDocsResult {
  /** The strip, in tab order. */
  tabs: OpenTab[];
  /** Active document id, or `null` when nothing is open. */
  activeId: string | null;
  /** Raw model snapshot, if you need the ids without the metadata. */
  state: OpenDocsState;
  /** False until the library has been read at least once. */
  isHydrated: boolean;
  actions: OpenDocsActions;
}

/** Module-level actions never change identity; hoist them out of the hook. */
const ACTIONS: OpenDocsActions = {
  open: openDoc,
  close: closeDoc,
  activate: activateDoc,
  reorder: reorderDoc,
  closeOthers: closeOtherDocs,
  closeAll: closeAllDocs,
};

/**
 * Subscribe to the open-tab strip.
 *
 * @param activeDocId the document the host is currently showing (its routing
 *   state — `/d/<id>`). When given, it is opened/activated in the model, which
 *   is what makes "navigate to a document" and "a tab exists for it" the same
 *   event. Pass `null` while the shelf is showing: the strip keeps its tabs
 *   and simply has nothing highlighted from the host's point of view.
 * @param options.touchOnActivate record `lastOpenedAt` on the library document
 *   when it becomes active. Defaults to `false`; turn it on only if the host
 *   does not already call `touchDoc` itself.
 */
export const useOpenDocs = (
  activeDocId?: string | null,
  options: { touchOnActivate?: boolean } = {},
): UseOpenDocsResult => {
  const { touchOnActivate = false } = options;

  const [state, setState] = useState<OpenDocsState>(getOpenDocs);
  const [metas, setMetas] = useState<ReadonlyMap<string, DocMeta>>(
    () => new Map(),
  );
  const [isHydrated, setIsHydrated] = useState(false);

  // --- model subscription -------------------------------------------------
  useEffect(() => {
    const sync = () => setState(getOpenDocs());
    const unsubscribe = subscribeOpenDocs(sync);
    const unsyncWindows = syncOpenDocsAcrossWindows();
    // the store may have changed between the initial render and this effect
    sync();
    return () => {
      unsubscribe();
      unsyncWindows();
    };
  }, []);

  // --- library hydration --------------------------------------------------
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let docs: DocMeta[];
      try {
        docs = await listDocs();
      } catch (error: any) {
        console.error("goodnotes/tabs: could not read the library", error);
        return;
      }
      if (cancelled || !isMountedRef.current) {
        return;
      }
      setMetas(new Map(docs.map((doc) => [doc.id, doc])));
      setIsHydrated(true);
      // a tab whose document was deleted has nothing to show and nothing to
      // open; drop it rather than render a ghost
      pruneOpenDocs(docs.map((doc) => doc.id));
    };
    void load();
    const unsubscribe = subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // --- host routing drives the strip --------------------------------------
  useEffect(() => {
    if (activeDocId) {
      openDoc(activeDocId);
    }
  }, [activeDocId]);

  useEffect(() => {
    if (touchOnActivate && activeDocId) {
      void touchDoc(activeDocId).catch(() => {});
    }
  }, [touchOnActivate, activeDocId]);

  const tabs = useMemo(
    () =>
      state.openIds.map((id) => ({
        id,
        meta: metas.get(id) ?? null,
        isActive: id === state.activeId,
      })),
    [state, metas],
  );

  return {
    tabs,
    activeId: state.activeId,
    state,
    isHydrated,
    actions: ACTIONS,
  };
};

/**
 * Convenience wrapper that returns just the metadata of the active tab —
 * handy for a title bar. Re-reads from the same subscriptions.
 */
export const useActiveDocMeta = (
  activeDocId?: string | null,
): DocMeta | null => {
  const { tabs, activeId } = useOpenDocs(activeDocId);
  return tabs.find((tab) => tab.id === activeId)?.meta ?? null;
};
