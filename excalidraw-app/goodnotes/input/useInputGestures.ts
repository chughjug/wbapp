/**
 * React binding for the tablet input layer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { attachInputGestures } from "./gestures";
import { requestRedo, requestUndo } from "./history";
import {
  loadInputSettings,
  saveInputSettings,
  subscribeInputSettings,
} from "./settings";

import type { InputCapabilities, InputGestureEvent } from "./gestures";
import type { InputSettings } from "./settings";

export interface UseInputGesturesOptions {
  /** Observe claimed gestures (page flips, undo/redo, palm-rejection flips). */
  onGesture?: (event: InputGestureEvent) => void;
}

export interface UseInputGesturesResult {
  /** Live settings (shared across tabs via `localStorage`). */
  settings: InputSettings;
  /** Flip one switch. */
  setSetting: <K extends keyof InputSettings>(
    key: K,
    value: InputSettings[K],
  ) => void;
  /** Set several at once. */
  setSettings: (patch: Partial<InputSettings>) => void;
  /** What this device turned out to support (pen, pen hover, touch). */
  capabilities: InputCapabilities;
  /** Undo/redo that actually work from app code — see `history.ts`. */
  undo: () => boolean;
  redo: () => boolean;
  /** Spread onto {@link InputSettingsPanel}. */
  settingsPanelProps: {
    settings: InputSettings;
    capabilities: InputCapabilities;
    onChange: <K extends keyof InputSettings>(
      key: K,
      value: InputSettings[K],
    ) => void;
  };
}

const INITIAL_CAPABILITIES: InputCapabilities = {
  penSeen: false,
  penHoverSupported: false,
  touchSeen: false,
  rejectingTouch: false,
};

/**
 * Installs palm rejection, pencil-only drawing, two-finger page flicks and
 * multi-finger undo/redo taps on a live editor.
 *
 * `excalidrawAPI` may be `null` while the editor boots; the hook attaches as
 * soon as it arrives and detaches on unmount.
 */
export const useInputGestures = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options: UseInputGesturesOptions = {},
): UseInputGesturesResult => {
  const [settings, setSettingsState] =
    useState<InputSettings>(loadInputSettings);
  const [capabilities, setCapabilities] =
    useState<InputCapabilities>(INITIAL_CAPABILITIES);

  // refs so the recogniser never has to be re-attached
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onGestureRef = useRef(options.onGesture);
  onGestureRef.current = options.onGesture;

  useEffect(() => subscribeInputSettings(setSettingsState), []);

  const handleRef = useRef<ReturnType<typeof attachInputGestures> | null>(null);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const handle = attachInputGestures(excalidrawAPI, {
      getSettings: () => settingsRef.current,
      onGesture: (event) => onGestureRef.current?.(event),
      onCapabilities: setCapabilities,
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.detach();
    };
  }, [excalidrawAPI]);

  // apply a settings change (e.g. "pencil only") without re-attaching
  useEffect(() => {
    handleRef.current?.notifySettingsChanged();
  }, [settings]);

  const setSettings = useCallback((patch: Partial<InputSettings>) => {
    setSettingsState(saveInputSettings(patch));
  }, []);

  const setSetting = useCallback(
    <K extends keyof InputSettings>(key: K, value: InputSettings[K]) => {
      setSettings({ [key]: value } as Partial<InputSettings>);
    },
    [setSettings],
  );

  const undo = useCallback(() => requestUndo(), []);
  const redo = useCallback(() => requestRedo(), []);

  return useMemo(
    () => ({
      settings,
      setSetting,
      setSettings,
      capabilities,
      undo,
      redo,
      settingsPanelProps: {
        settings,
        capabilities,
        onChange: setSetting,
      },
    }),
    [settings, setSetting, setSettings, capabilities, undo, redo],
  );
};
