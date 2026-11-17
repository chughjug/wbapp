/**
 * React binding for {@link openCrdtDoc}: one Y.Doc per notebook, IndexedDB
 * persistence, snapshot list, and role.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendSnapshot,
  listSnapshots,
  openCrdtDoc,
  readRole,
  setRole,
  type CrdtDocHandle,
  type CrdtRole,
  type CrdtSnapshot,
} from "./docStore";

export interface UseCrdtDocResult {
  ready: boolean;
  role: CrdtRole;
  snapshots: CrdtSnapshot[];
  setDocRole: (role: CrdtRole) => void;
  saveSnapshot: (label: string, payload: string, author?: string) => void;
  refresh: () => void;
}

export const useCrdtDoc = (
  docId: string | null | undefined,
): UseCrdtDocResult => {
  const handleRef = useRef<CrdtDocHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState<CrdtRole>("owner");
  const [snapshots, setSnapshots] = useState<CrdtSnapshot[]>([]);

  const refresh = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) {
      setSnapshots([]);
      return;
    }
    setRoleState(readRole(handle));
    setSnapshots(listSnapshots(handle));
  }, []);

  useEffect(() => {
    if (!docId) {
      handleRef.current?.destroy();
      handleRef.current = null;
      setReady(false);
      setSnapshots([]);
      return;
    }

    const handle = openCrdtDoc(docId);
    handleRef.current = handle;
    setReady(false);

    let cancelled = false;
    void handle.whenSynced.then(() => {
      if (cancelled) {
        return;
      }
      setReady(true);
      setRoleState(readRole(handle));
      setSnapshots(listSnapshots(handle));
    });

    const onUpdate = () => {
      if (!cancelled) {
        refresh();
      }
    };
    handle.ydoc.on("update", onUpdate);

    return () => {
      cancelled = true;
      handle.ydoc.off("update", onUpdate);
      handle.destroy();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
    };
  }, [docId, refresh]);

  const setDocRole = useCallback(
    (next: CrdtRole) => {
      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      setRole(handle, next);
      refresh();
    },
    [refresh],
  );

  const saveSnapshot = useCallback(
    (label: string, payload: string, author?: string) => {
      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      appendSnapshot(handle, { label, payload, author });
      refresh();
    },
    [refresh],
  );

  return { ready, role, snapshots, setDocRole, saveSnapshot, refresh };
};
