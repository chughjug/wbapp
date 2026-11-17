/**
 * Heroku relay URL for iPad ↔ laptop Chrome extension sync.
 *
 * Set `VITE_CANVAS_BRIDGE_URL` at build time (e.g.
 * https://your-wbapp-canvas-bridge.herokuapp.com). Falls back to localhost
 * for local relay development.
 */

const readEnv = (): string => {
  try {
    const raw = (import.meta.env.VITE_CANVAS_BRIDGE_URL as string | undefined)
      ?.trim();
    return raw || "";
  } catch {
    return "";
  }
};

/** Live ratings Heroku dyno (canvas-bridge mount). Override with env/localStorage. */
export const DEFAULT_BRIDGE_URL =
  "https://chess-tournament-director-6ce5e76147d7.herokuapp.com/api/canvas-bridge";

export const getBridgeUrl = (): string => {
  const fromEnv = readEnv();
  const stored =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("goodnotes:canvas-bridge-url")
      : null;
  const raw = (stored || fromEnv || DEFAULT_BRIDGE_URL).trim();
  return raw.replace(/\/$/, "");
};

export const setBridgeUrlOverride = (url: string) => {
  const cleaned = url.trim().replace(/\/$/, "");
  try {
    if (cleaned) {
      localStorage.setItem("goodnotes:canvas-bridge-url", cleaned);
    } else {
      localStorage.removeItem("goodnotes:canvas-bridge-url");
    }
  } catch {
    // ignore
  }
};

export const isBridgeConfigured = () => Boolean(getBridgeUrl());
