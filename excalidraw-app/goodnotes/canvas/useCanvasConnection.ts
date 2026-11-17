/**
 * React binding for the stored Canvas connection.
 *
 * The store is a module-level singleton with a subscribe callback, so every
 * mounted surface (connect dialog, course browser, a nav-bar badge) sees the
 * same connection the instant it is saved or cleared.
 */

import { useCallback, useEffect, useState } from "react";

import { isBridgePaired, subscribeBridgeSession } from "./bridge";
import { checkCanvasConnection } from "./client";
import {
  clearCanvasConnection,
  loadCanvasConnection,
  normalizeCanvasHost,
  saveCanvasConnection,
  subscribeCanvasConnection,
} from "./connection";
import { describeCanvasError } from "./errors";

import type { CanvasConnection } from "./connection";

export interface UseCanvasConnection {
  connection: CanvasConnection | null;
  isConnected: boolean;
  /** True when paired via the laptop Chrome extension (no PAT). */
  isBridgePaired: boolean;
  /** Display name Canvas reported for the token's account, if known. */
  userName: string | null;
  /** True while {@link connect} is verifying. */
  isChecking: boolean;
  /** Message for the last failed {@link connect}, already human-readable. */
  error: string | null;
  /**
   * Verify `host` + `token` against Canvas and, on success, store them.
   * Resolves with the account name, or `null` when the check failed (the
   * reason is in {@link UseCanvasConnection.error} — this never rejects).
   */
  connect: (host: string, token: string) => Promise<string | null>;
  /** Forget the stored token. Does not revoke it — only Canvas can do that. */
  disconnect: () => void;
  clearError: () => void;
}

export const useCanvasConnection = (): UseCanvasConnection => {
  const [connection, setConnection] = useState<CanvasConnection | null>(() =>
    loadCanvasConnection(),
  );
  const [bridgePaired, setBridgePaired] = useState(() => isBridgePaired());
  const [isChecking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // re-read on mount as well: the store may have changed before subscribing
    setConnection(loadCanvasConnection());
    setBridgePaired(isBridgePaired());
    const unsubscribe = subscribeCanvasConnection(() =>
      setConnection(loadCanvasConnection()),
    );
    const unsubBridge = subscribeBridgeSession(() =>
      setBridgePaired(isBridgePaired()),
    );
    return () => {
      unsubscribe();
      unsubBridge();
    };
  }, []);

  const connect = useCallback(async (host: string, token: string) => {
    const normalized = normalizeCanvasHost(host);
    const trimmed = token.trim();

    if (!normalized) {
      setError(
        "Enter your Canvas address, e.g. your-school.instructure.com — the host only, with no https:// and no path.",
      );
      return null;
    }
    if (!/\.[a-z]{2,}$/i.test(normalized)) {
      setError(
        `“${normalized}” doesn’t look like a Canvas address. It should be a full hostname, e.g. your-school.instructure.com.`,
      );
      return null;
    }
    if (!trimmed) {
      setError("Paste the access token you created in Canvas.");
      return null;
    }

    setChecking(true);
    setError(null);
    try {
      const candidate: CanvasConnection = { host: normalized, token: trimmed };
      const userName = await checkCanvasConnection(candidate);
      saveCanvasConnection({ ...candidate, userName, connectedAt: Date.now() });
      return userName;
    } catch (caught) {
      setError(describeCanvasError(caught, "connect"));
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearCanvasConnection();
    setError(null);
  }, []);

  return {
    connection,
    isConnected: connection !== null || bridgePaired,
    isBridgePaired: bridgePaired,
    userName: connection?.userName ?? null,
    isChecking,
    error,
    connect,
    disconnect,
    clearError: useCallback(() => setError(null), []),
  };
};
