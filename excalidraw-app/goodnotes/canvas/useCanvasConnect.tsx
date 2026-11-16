/**
 * The callback-shaped entry point a nav bar, shelf or empty state can call
 * to open the connect screen.
 *
 * ```tsx
 * const canvas = useCanvasConnect({ theme });
 *
 * <button onClick={canvas.open}>Connect Canvas…</button>
 * {canvas.dialog}
 * ```
 *
 * `dialog` is `null` while closed, so mounting it costs nothing.
 */

import React, { useCallback, useMemo, useState } from "react";

import { CanvasConnectDialog } from "./CanvasConnectDialog";
import { useCanvasConnection } from "./useCanvasConnection";

import type { CanvasConnection } from "./connection";

export interface UseCanvasConnectOptions {
  onConnected?: (userName: string) => void;
  onDisconnected?: () => void;
  theme?: "light" | "dark";
}

export interface CanvasConnectController {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Open the dialog only when there is no connection yet. */
  openIfNeeded: () => boolean;
  isConnected: boolean;
  connection: CanvasConnection | null;
  /** Render this somewhere in the tree — it portals to `document.body`. */
  dialog: React.ReactNode;
}

export const useCanvasConnect = (
  options: UseCanvasConnectOptions = {},
): CanvasConnectController => {
  const [isOpen, setOpen] = useState(false);
  const { connection, isConnected } = useCanvasConnection();
  const { onConnected, onDisconnected, theme } = options;

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const openIfNeeded = useCallback(() => {
    if (isConnected) {
      return false;
    }
    setOpen(true);
    return true;
  }, [isConnected]);

  const dialog = useMemo(
    () =>
      isOpen ? (
        <CanvasConnectDialog
          onClose={close}
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          theme={theme}
        />
      ) : null,
    [isOpen, close, onConnected, onDisconnected, theme],
  );

  return { isOpen, open, close, openIfNeeded, isConnected, connection, dialog };
};
