/**
 * `useSync` — the one hook a host needs.
 *
 * It owns the session, the schedule and the status; it owns no documents.
 * Everything it does is additive: when sync is unconfigured or nobody is
 * signed in, it registers no listeners beyond a single auth probe, runs no
 * timers and makes no requests, and the app is exactly the app it was.
 *
 * ## When a pass runs
 *
 *  - on sign-in, and whenever the session changes;
 *  - {@link DEBOUNCE_MS} after the library changes (a stroke, a rename, a
 *    delete) — the library's own save is already debounced, so this sits
 *    behind it rather than racing it;
 *  - every {@link POLL_MS} while the tab is visible, which is how a second
 *    device's work arrives (there is no realtime subscription — see
 *    INTEGRATION.md);
 *  - when the tab becomes visible, and when the browser comes back online.
 *
 * Passes never overlap: a request arriving mid-pass sets a flag and a second
 * pass follows immediately after the first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { subscribe } from "../library";

import { signIn, signOut, signUp, subscribeAuth } from "./auth";
import { getClient } from "./client";
import { getConfigProblem, isSyncConfigured } from "./config";
import { getDeviceLabel } from "./device";
import { countPending, sanitizeMessage, syncAll } from "./engine";
import { bindAccount } from "./state";
import { createSupabaseBackend } from "./supabaseBackend";

import type { SyncUser } from "./auth";
import type { SyncBackend } from "./backend";
import type { ConflictRecord, SyncPhase, SyncStatus } from "./types";

/** How long after a local edit a pass is scheduled. */
export const DEBOUNCE_MS = 4000;

/** How often a visible, signed-in tab checks for other devices' work. */
export const POLL_MS = 60_000;

export interface UseSyncOptions {
  /**
   * The document open in the editor. Remote updates to it are held back
   * rather than applied under the user's pen — see `engine.ts`.
   */
  activeDocId?: string | null;
  /** Escape hatch for tests and for a host that wants to drive passes itself. */
  backend?: SyncBackend | null;
  /** Switch the scheduler off; `syncNow` still works. */
  autoSync?: boolean;
}

export interface UseSyncResult {
  status: SyncStatus;
  /** Run a pass now. Resolves when it finishes (or immediately if inert). */
  syncNow: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  /** Clear the conflict notices after the user has read them. */
  dismissConflicts: () => void;
  /** Last auth error, already user-safe. */
  authError: string | null;
  clearAuthError: () => void;
  busy: boolean;
}

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

export const useSync = (options: UseSyncOptions = {}): UseSyncResult => {
  const { activeDocId = null, backend: injectedBackend = null } = options;
  const autoSync = options.autoSync ?? true;

  const configured = isSyncConfigured();
  const [user, setUser] = useState<SyncUser | null>(null);
  const [phase, setPhase] = useState<SyncPhase>(
    configured ? "signed-out" : "disabled",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [deferred, setDeferred] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [error, setError] = useState<string | null>(() => getConfigProblem());
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backendRef = useRef<SyncBackend | null>(injectedBackend);
  const activeDocRef = useRef<string | null>(activeDocId);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const mountedRef = useRef(true);

  activeDocRef.current = activeDocId;
  if (injectedBackend) {
    backendRef.current = injectedBackend;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---- session ------------------------------------------------------------

  useEffect(() => {
    if (!configured && !injectedBackend) {
      return;
    }
    return subscribeAuth((next) => {
      if (mountedRef.current) {
        setUser(next);
      }
    });
  }, [configured, injectedBackend]);

  // Build (or tear down) the backend when the session changes.
  useEffect(() => {
    let cancelled = false;
    if (injectedBackend) {
      return;
    }
    if (!user) {
      backendRef.current = null;
      setPhase(configured ? "signed-out" : "disabled");
      return;
    }
    void (async () => {
      const client = await getClient();
      if (!client || cancelled) {
        return;
      }
      // Signing in as somebody else must not inherit this device's
      // watermarks — see state.ts.
      await bindAccount(user.id);
      backendRef.current = createSupabaseBackend(client, user.id);
      if (!cancelled && mountedRef.current) {
        setPhase("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, configured, injectedBackend]);

  // ---- the pass -----------------------------------------------------------

  const runPass = useCallback(async (): Promise<void> => {
    const backend = backendRef.current;
    if (!backend) {
      return;
    }
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    if (!isOnline()) {
      if (mountedRef.current) {
        setPhase("offline");
      }
      return;
    }
    runningRef.current = true;
    if (mountedRef.current) {
      setPhase("syncing");
      setBusy(true);
    }
    try {
      const report = await syncAll({
        backend,
        device: getDeviceLabel(),
        activeDocId: activeDocRef.current,
      });
      if (mountedRef.current) {
        setDeferred(report.deferred);
        if (report.conflicts.length) {
          setConflicts((current) => [...current, ...report.conflicts]);
        }
        setError(report.errors[0] ?? null);
        setLastSyncedAt(Date.now());
        setPhase(report.errors.length ? "error" : "idle");
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(sanitizeMessage(caught));
        setPhase(isOnline() ? "error" : "offline");
      }
    } finally {
      runningRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
        setPending(await countPending().catch(() => 0));
      }
      if (rerunRef.current) {
        rerunRef.current = false;
        void runPass();
      }
    }
  }, []);

  // ---- schedule -----------------------------------------------------------

  useEffect(() => {
    if (!autoSync || (!user && !injectedBackend)) {
      return;
    }
    void runPass();

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void runPass(), DEBOUNCE_MS);
    });

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void runPass();
      }
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void runPass();
      }
    };
    const onOnline = () => void runPass();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      clearTimeout(debounce);
      clearInterval(interval);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [autoSync, user, injectedBackend, runPass]);

  // Keep the "N not backed up yet" number honest while signed out, too: it
  // is the one piece of sync UI that is useful before you have an account.
  useEffect(() => {
    if (!configured) {
      return;
    }
    let cancelled = false;
    const read = () => {
      void countPending()
        .then((count) => {
          if (!cancelled && mountedRef.current) {
            setPending(count);
          }
        })
        .catch(() => undefined);
    };
    read();
    const unsubscribe = subscribe(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [configured]);

  // ---- actions ------------------------------------------------------------

  const doSignIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setAuthError(result.message);
      throw new Error(result.message);
    }
  }, []);

  const doSignUp = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setBusy(true);
    const result = await signUp(email, password);
    setBusy(false);
    if (!result.ok) {
      setAuthError(result.message);
      throw new Error(result.message);
    }
    return { needsConfirmation: Boolean(result.needsConfirmation) };
  }, []);

  const doSignOut = useCallback(async () => {
    await signOut();
    backendRef.current = null;
    if (mountedRef.current) {
      setUser(null);
      setPhase(isSyncConfigured() ? "signed-out" : "disabled");
      setDeferred([]);
    }
  }, []);

  const status = useMemo<SyncStatus>(
    () => ({
      configured,
      phase: configured ? phase : "disabled",
      email: user?.email ?? null,
      userId: user?.id ?? null,
      lastSyncedAt,
      pending,
      deferred,
      conflicts,
      error,
    }),
    [
      configured,
      phase,
      user,
      lastSyncedAt,
      pending,
      deferred,
      conflicts,
      error,
    ],
  );

  return {
    status,
    syncNow: runPass,
    signIn: doSignIn,
    signUp: doSignUp,
    signOut: doSignOut,
    dismissConflicts: useCallback(() => setConflicts([]), []),
    authError,
    clearAuthError: useCallback(() => setAuthError(null), []),
    busy,
  };
};
