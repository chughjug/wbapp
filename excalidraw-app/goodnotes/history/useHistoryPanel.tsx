/**
 * The callback-shaped entry point a menu can call, matching the shape of
 * `useMathDialog` so hosts wire both the same way.
 *
 * ```tsx
 * const history = useHistoryPanel(docId, { onRestored: reloadScene });
 *
 * <FloatingBar items={[{ id: "history", label: "Earlier versions…", onSelect: history.open }]} />
 * {history.panel}
 * ```
 */

import React, { useCallback, useMemo, useState } from "react";

import { HistoryPanel } from "./HistoryPanel";
import { takeSnapshot } from "./store";

import type { DocScene } from "../types";

export interface UseHistoryPanelOptions {
  onRestored?: (docId: string) => void;
  theme?: "light" | "dark";
}

export interface HistoryPanelController {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Keep a snapshot of `scene` right now, pinned, whatever the rate limit. */
  markVersion: (scene: DocScene) => Promise<void>;
  /** Render this somewhere in the tree — it portals to `document.body`. */
  panel: React.ReactNode;
}

export const useHistoryPanel = (
  docId: string | null,
  options: UseHistoryPanelOptions = {},
): HistoryPanelController => {
  const [isOpen, setIsOpen] = useState(false);
  const { onRestored, theme } = options;

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const markVersion = useCallback(
    async (scene: DocScene) => {
      if (!docId) {
        return;
      }
      await takeSnapshot(docId, scene, Date.now(), "manual");
    },
    [docId],
  );

  const panel = useMemo(
    () =>
      isOpen && docId ? (
        <HistoryPanel
          docId={docId}
          onClose={close}
          onRestored={onRestored}
          theme={theme}
        />
      ) : null,
    [close, docId, isOpen, onRestored, theme],
  );

  return { isOpen, open, close, markVersion, panel };
};
