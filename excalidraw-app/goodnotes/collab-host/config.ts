/**
 * Self-host helpers inspired by excalidraw-room + Freero checklists.
 *
 * Live collab still uses Excalidraw's socket.io client pointed at
 * `VITE_APP_WS_SERVER_URL`. This module makes that configuration visible and
 * adds WBO-style short classroom room codes for share UX.
 */

export interface CollabHostStatus {
  /** True when a websocket collab server URL is configured. */
  configured: boolean;
  /** The WS URL, or null. */
  wsUrl: string | null;
  /** Human-readable hint for Settings / share dialogs. */
  message: string;
}

export const getCollabHostStatus = (): CollabHostStatus => {
  const raw = (import.meta.env.VITE_APP_WS_SERVER_URL || "").trim();
  if (!raw) {
    return {
      configured: false,
      wsUrl: null,
      message:
        "Live collaboration is off. Set VITE_APP_WS_SERVER_URL to your self-hosted excalidraw-room (or compatible) server.",
    };
  }
  return {
    configured: true,
    wsUrl: raw,
    message: `Collaborating via ${raw}`,
  };
};

/** Crockford-ish alphabet — no I/L/O/U to keep classroom codes readable. */
const ROOM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short share code for classroom boards (WBO-inspired simplicity). */
export const makeClassroomRoomCode = (bytes = 5): string => {
  const out: string[] = [];
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    for (const value of buf) {
      out.push(ROOM_ALPHABET[value % ROOM_ALPHABET.length]);
    }
  } else {
    for (let i = 0; i < bytes; i++) {
      out.push(ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]);
    }
  }
  return out.join("");
};

export const formatClassroomRoomCode = (code: string): string => {
  const compact = code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
};
