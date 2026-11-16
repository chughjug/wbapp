/**
 * `useDarkMode()` — the single source of truth for the viewing theme.
 *
 * Drop-in replacement for the app's `useHandleAppTheme()`: it returns the
 * same `{ editorTheme, appTheme, setAppTheme }` triple (so existing call
 * sites keep working) plus the dark-mode-specific fields. It persists to the
 * same localStorage key, so the two can even coexist during a migration.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  getStoredDarkModePreference,
  resolveDarkModeTheme,
  setStoredDarkModePreference,
  subscribeToSystemTheme,
} from "./darkMode";

import type { DarkModePreference, ResolvedTheme } from "./darkMode";

export interface UseDarkModeResult {
  /** What the user picked: light / dark / system. */
  preference: DarkModePreference;
  /** Set the preference (persisted). */
  setPreference: (preference: DarkModePreference) => void;
  /** The resolved theme — pass this to `<Excalidraw theme={...} />`. */
  theme: ResolvedTheme;
  /** `theme === "dark"`. */
  isDark: boolean;

  /* ---- `useHandleAppTheme()` compatibility aliases ---- */
  /** Alias of `theme`. */
  editorTheme: ResolvedTheme;
  /** Alias of `preference`. */
  appTheme: DarkModePreference;
  /** Alias of `setPreference`. */
  setAppTheme: (preference: DarkModePreference) => void;
}

export const useDarkMode = (): UseDarkModeResult => {
  const [preference, setPreferenceState] = useState<DarkModePreference>(
    getStoredDarkModePreference,
  );
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    resolveDarkModeTheme(getStoredDarkModePreference()),
  );

  // persist + resolve, before paint so there is no light flash
  useLayoutEffect(() => {
    setStoredDarkModePreference(preference);
    setTheme(resolveDarkModeTheme(preference));
  }, [preference]);

  // follow the OS only while the preference says so
  useEffect(() => {
    if (preference !== "system") {
      return;
    }
    return subscribeToSystemTheme(setTheme);
  }, [preference]);

  // another tab (or `useHandleAppTheme`) changed the shared key
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === undefined) {
        return;
      }
      const next = getStoredDarkModePreference();
      setPreferenceState((current) => (current === next ? current : next));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: DarkModePreference) => {
    setPreferenceState(next);
  }, []);

  return {
    preference,
    setPreference,
    theme,
    isDark: theme === "dark",
    editorTheme: theme,
    appTheme: preference,
    setAppTheme: setPreference,
  };
};
