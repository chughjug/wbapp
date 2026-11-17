/**
 * Persisted bridge pairing (iPad side). Separate from the PAT connection.
 */

import type { BridgeSession } from "./types";

const STORAGE_KEY = "goodnotes:canvas-bridge-session";

type Listener = () => void;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

export const subscribeBridgeSession = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const loadBridgeSession = (): BridgeSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as BridgeSession;
    return parsed?.roomId && parsed?.pairCode && parsed?.bridgeUrl
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export const saveBridgeSession = (session: BridgeSession) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
  notify();
};

export const clearBridgeSession = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
};

export const isBridgePaired = () => loadBridgeSession() !== null;
