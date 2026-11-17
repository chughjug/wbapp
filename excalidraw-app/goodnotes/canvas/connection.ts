/**
 * Canvas connection details: which instance, and the user's access token.
 *
 * The token is a Canvas *personal access token*. Canvas does not let a user
 * scope one to read-only, so it carries the full authority of their account.
 * It is kept in localStorage and sent per request to this app's own relay
 * (never to a third party), which is a deliberate, stated trade-off: it works
 * today without an account system, and the user can revoke it from Canvas at
 * any time. The connect UI says so plainly rather than hiding it.
 */

const STORAGE_KEY = "goodnotes:canvas-connection";

export interface CanvasConnection {
  /** Instance host, e.g. "canvas.instructure.com" — no scheme, no path. */
  host: string;
  token: string;
  /** Display name of the connected user, filled in after a successful check. */
  userName?: string;
  connectedAt?: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

export const subscribeCanvasConnection = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Strip scheme, path, and whitespace from whatever the user pasted. */
export const normalizeCanvasHost = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();

export const loadCanvasConnection = (): CanvasConnection | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CanvasConnection;
    return parsed?.host && parsed?.token ? parsed : null;
  } catch {
    return null;
  }
};

export const saveCanvasConnection = (connection: CanvasConnection) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  } catch {
    // storage full or blocked; the session still works, it just won't persist
  }
  notify();
};

export const clearCanvasConnection = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
};

/**
 * True when either a PAT is stored, or the iPad is paired with the laptop
 * Chrome extension bridge (session may exist before the first course sync).
 */
export const isCanvasConnected = (): boolean => {
  if (loadCanvasConnection()) {
    return true;
  }
  try {
    // lazy require to avoid a hard cycle at module init
    const raw = localStorage.getItem("goodnotes:canvas-bridge-session");
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as { roomId?: string; pairCode?: string };
    return Boolean(parsed?.roomId && parsed?.pairCode);
  } catch {
    return false;
  }
};
