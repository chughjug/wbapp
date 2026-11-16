/**
 * Loads Canvas deadlines for the dashboard, with the three states that
 * actually occur in the wild treated as first-class rather than as edge
 * cases: not connected, failing, loading.
 *
 * DISCONNECTED IS NOT AN ERROR AND NOT A LOADING STATE. `isCanvasConnected()`
 * is read synchronously during the first render, so a user who never connects
 * Canvas — the default, and permanent for many people — never sees a
 * spinner, never sees a strip appear and vanish, and never sees a failure.
 * No request is issued at all in that state.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isCanvasConnected,
  listUpcomingWork,
  refreshLinkedDueDates,
} from "../canvas";

import type { AssignmentRow } from "../canvas";

export type UpcomingWorkStatus = "disconnected" | "loading" | "ready" | "error";

export interface UpcomingWorkState {
  status: UpcomingWorkStatus;
  rows: AssignmentRow[];
  /** User-readable failure text, or null. */
  errorMessage: string | null;
  /** True while a *re*-load runs over already-rendered data. */
  refreshing: boolean;
  lastSyncedAt: number | null;
  /**
   * Polite, human sentence describing the current state. The dashboard puts
   * it in an `aria-live="polite"` region, so it must always be a complete
   * statement and must change only when something really changed.
   */
  statusMessage: string;
  /** Re-read the connection and reload. Used by the retry button. */
  reload: () => void;
  /** Pull moved deadlines onto linked notebooks, then reload. */
  syncDueDates: () => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "Canvas could not be reached.";

export const useUpcomingWork = (): UpcomingWorkState => {
  // read synchronously: a disconnected user must never flash a loading state
  const [status, setStatus] = useState<UpcomingWorkStatus>(() =>
    isCanvasConnected() ? "loading" : "disconnected",
  );
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const mountedRef = useRef(true);
  /** Guards against an in-flight load from a previous connection state. */
  const runRef = useRef(0);

  const load = useCallback(async (options: { withDueDates: boolean }) => {
    if (!isCanvasConnected()) {
      runRef.current += 1;
      setStatus("disconnected");
      setRows([]);
      setErrorMessage(null);
      setRefreshing(false);
      return;
    }

    const run = ++runRef.current;
    setErrorMessage(null);
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    setRefreshing(true);

    try {
      let changed = 0;
      if (options.withDueDates) {
        changed = await refreshLinkedDueDates();
      }
      const next = await listUpcomingWork();
      if (!mountedRef.current || run !== runRef.current) {
        return;
      }
      setRows(next);
      setStatus("ready");
      setLastSyncedAt(Date.now());
      setSyncNote(
        options.withDueDates
          ? changed === 0
            ? "No due dates changed."
            : `Updated ${changed} ${changed === 1 ? "due date" : "due dates"}.`
          : null,
      );
    } catch (error) {
      if (!mountedRef.current || run !== runRef.current) {
        return;
      }
      // keep whatever rows we already had: a failed refresh must not blank
      // a strip the user is looking at
      setErrorMessage(messageOf(error));
      setStatus("error");
    } finally {
      if (mountedRef.current && run === runRef.current) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (isCanvasConnected()) {
      void load({ withDueDates: false });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // The connect flow lives outside this module (and may run in another tab),
  // so re-check on focus rather than assuming the connection is immutable.
  useEffect(() => {
    const recheck = () => {
      const connected = isCanvasConnected();
      if (connected && status === "disconnected") {
        void load({ withDueDates: false });
      } else if (!connected && status !== "disconnected") {
        runRef.current += 1;
        setStatus("disconnected");
        setRows([]);
        setErrorMessage(null);
      }
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [load, status]);

  const reload = useCallback(() => void load({ withDueDates: false }), [load]);
  const syncDueDates = useCallback(
    () => void load({ withDueDates: true }),
    [load],
  );

  let statusMessage = "";
  if (status === "loading") {
    statusMessage = "Checking Canvas for upcoming work…";
  } else if (status === "error") {
    statusMessage = `${
      errorMessage ?? "Canvas could not be reached."
    } Your documents are still here.`;
  } else if (status === "ready") {
    const count = rows.length;
    statusMessage = `${count} ${
      count === 1 ? "assignment" : "assignments"
    } from Canvas.${syncNote ? ` ${syncNote}` : ""}`;
  }

  return {
    status,
    rows,
    errorMessage,
    refreshing,
    lastSyncedAt,
    statusMessage,
    reload,
    syncDueDates,
  };
};
