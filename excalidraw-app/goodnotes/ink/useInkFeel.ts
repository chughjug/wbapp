/**
 * `useInkFeel()` — React access to the ink-feel preference.
 *
 * The preference lives outside React (the editor reads it synchronously on
 * pointerdown, which can happen between renders), so this hook is a thin
 * subscription over the store in `./inkFeel`.
 */

import { useCallback, useEffect, useState } from "react";

import {
  getInkFeelSettings,
  initInkFeel,
  subscribeToInkFeel,
  updateInkFeelSettings,
} from "./inkFeel";

import type { InkFeel, InkFeelSettings } from "./inkFeel";

export interface UseInkFeelResult extends InkFeelSettings {
  settings: InkFeelSettings;
  setFeel: (feel: InkFeel) => void;
  setPreferRealPenPressure: (prefer: boolean) => void;
  setUseStrokeModeler: (use: boolean) => void;
}

export const useInkFeel = (): UseInkFeelResult => {
  const [settings, setSettings] = useState<InkFeelSettings>(getInkFeelSettings);

  useEffect(() => {
    // idempotent: reads localStorage and pushes the result into the editor
    setSettings(initInkFeel());
    return subscribeToInkFeel(setSettings);
  }, []);

  const setFeel = useCallback(
    (feel: InkFeel) => updateInkFeelSettings({ feel }),
    [],
  );

  const setPreferRealPenPressure = useCallback(
    (preferRealPenPressure: boolean) =>
      updateInkFeelSettings({ preferRealPenPressure }),
    [],
  );

  const setUseStrokeModeler = useCallback(
    (useStrokeModeler: boolean) => updateInkFeelSettings({ useStrokeModeler }),
    [],
  );

  return {
    ...settings,
    settings,
    setFeel,
    setPreferRealPenPressure,
    setUseStrokeModeler,
  };
};
