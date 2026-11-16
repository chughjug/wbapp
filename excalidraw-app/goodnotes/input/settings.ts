/**
 * The input layer's user-visible switches, persisted to `localStorage`.
 *
 * Kept deliberately framework-free so the recogniser (`gestures.ts`) and the
 * React surface (`useInputGestures.ts`, `InputSettingsPanel.tsx`) share one
 * source of truth, and so a host that does not want the panel can still
 * read/write the settings.
 */

export interface InputSettings {
  /**
   * Only a stylus may draw. Fingers pan, pinch, scroll and tap — never ink,
   * whether or not a pen has ever been seen.
   */
  pencilOnly: boolean;
  /**
   * Automatic palm rejection: once a stylus has been used in the last
   * {@link PEN_ACTIVE_WINDOW_MS}, fingers stop inking (they keep panning,
   * pinching and tapping). Put the pencil down and fingers ink again.
   */
  palmRejection: boolean;
  /** Two-finger horizontal flick moves to the previous/next page. */
  swipePages: boolean;
  /** Two-finger tap = undo, three-finger tap = redo. */
  tapGestures: boolean;
  /** Show a nib-sized dot under a hovering stylus (if the browser reports hover). */
  hoverPreview: boolean;
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  pencilOnly: false,
  palmRejection: true,
  swipePages: true,
  tapGestures: true,
  hoverPreview: true,
};

export const INPUT_SETTINGS_STORAGE_KEY = "goodnotes:input-settings";

const listeners = new Set<(settings: InputSettings) => void>();

let cached: InputSettings | null = null;

const coerce = (raw: unknown): InputSettings => {
  const source = (raw ?? {}) as Partial<Record<keyof InputSettings, unknown>>;
  const next = { ...DEFAULT_INPUT_SETTINGS };
  (Object.keys(DEFAULT_INPUT_SETTINGS) as (keyof InputSettings)[]).forEach(
    (key) => {
      if (typeof source[key] === "boolean") {
        next[key] = source[key] as boolean;
      }
    },
  );
  return next;
};

/** Current settings (reads `localStorage` once, then an in-memory cache). */
export const loadInputSettings = (): InputSettings => {
  if (cached) {
    return cached;
  }
  if (typeof window === "undefined") {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(INPUT_SETTINGS_STORAGE_KEY);
    cached = coerce(raw ? JSON.parse(raw) : null);
  } catch {
    // private mode, quota, corrupt JSON — defaults are always usable
    cached = { ...DEFAULT_INPUT_SETTINGS };
  }
  return cached;
};

/** Replaces the settings, persists them and notifies every subscriber. */
export const saveInputSettings = (
  patch: Partial<InputSettings>,
): InputSettings => {
  const next = coerce({ ...loadInputSettings(), ...patch });
  cached = next;
  try {
    window.localStorage.setItem(
      INPUT_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // non-fatal: the session still honours the change
  }
  listeners.forEach((listener) => listener(next));
  return next;
};

/**
 * Subscribes to settings changes — both this tab's writes and another tab's
 * (via the `storage` event). Returns an unsubscribe function.
 */
export const subscribeInputSettings = (
  listener: (settings: InputSettings) => void,
): (() => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== INPUT_SETTINGS_STORAGE_KEY) {
      return;
    }
    cached = null;
    listener(loadInputSettings());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Test/host escape hatch: drop the in-memory cache. */
export const resetInputSettingsCache = () => {
  cached = null;
};
