/**
 * `useSettingsScreen()` — the whole module in one hook.
 *
 * The host needs four things: a way to open the screen (replacing the old
 * "Pen & touch…" menu item), the screen itself, the first-run hint, and a way
 * to open the screen *at* the gestures section when the hint is acted on. This
 * hook owns all four so `App.tsx` gains one hook call and two render slots.
 *
 * ```tsx
 * const settings = useSettingsScreen({ theme: editorTheme });
 * // …in the overflow menu:
 * { id: "settings", label: "Settings…", onSelect: settings.open }
 * // …at the end of the tree:
 * {settings.screen}
 * {settings.firstRunHint}
 * ```
 */

import { useCallback, useMemo, useState } from "react";

import { createElement } from "react";

import { GesturesFirstRunHint } from "./FirstRunHint";
import { SettingsScreen } from "./SettingsScreen";

import type { SettingsSectionId } from "./SettingsScreen";
import type { ReactElement, ReactNode } from "react";

export interface UseSettingsScreenOptions {
  /** Resolved editor theme, from `useDarkMode().theme`. */
  theme?: "light" | "dark";
  /**
   * Called after a restore has written to IndexedDB. The library's in-process
   * listeners do not see those writes, so the host should reload or re-read
   * the document list. Defaults to nothing.
   */
  onRestored?: () => void;
  /** Suppress the first-run hint entirely (e.g. on the home shelf). */
  hint?: boolean;
  /** Delay before the hint appears, in ms. Defaults to 1200. */
  hintDelayMs?: number;
  /** Host-owned sections appended after Storage (collab, history, …). */
  extraSections?: ReactNode;
}

export interface UseSettingsScreenResult {
  isOpen: boolean;
  /** Open the screen (optionally scrolled to a section). */
  open: (section?: SettingsSectionId) => void;
  close: () => void;
  /** The screen, or `null` when closed. Render it near the end of the tree. */
  screen: ReactElement | null;
  /** The one-time gestures hint, or `null`. Render it next to `screen`. */
  firstRunHint: ReactElement | null;
}

export const useSettingsScreen = (
  options: UseSettingsScreenOptions = {},
): UseSettingsScreenResult => {
  const {
    theme = "light",
    onRestored,
    hint = true,
    hintDelayMs,
    extraSections,
  } = options;

  const [openSection, setOpenSection] = useState<
    SettingsSectionId | null | false
  >(false);

  const open = useCallback((section?: SettingsSectionId) => {
    setOpenSection(section ?? null);
  }, []);
  const close = useCallback(() => setOpenSection(false), []);

  const isOpen = openSection !== false;

  const screen = useMemo(
    () =>
      isOpen
        ? createElement(SettingsScreen, {
            onClose: close,
            theme,
            onRestored,
            initialSection: openSection ?? undefined,
            extraSections,
          })
        : null,
    [isOpen, openSection, close, theme, onRestored, extraSections],
  );

  const firstRunHint = useMemo(
    () =>
      hint && !isOpen
        ? createElement(GesturesFirstRunHint, {
            theme,
            delayMs: hintDelayMs,
            onOpenGestures: () => open("gestures"),
          })
        : null,
    [hint, isOpen, theme, hintDelayMs, open],
  );

  return { isOpen, open, close, screen, firstRunHint };
};
