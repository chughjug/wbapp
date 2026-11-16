/**
 * The first-run gestures hint: one small, quiet, dismissible pointer at the
 * "Gestures & shortcuts" section — and then never again.
 *
 * Deliberately NOT a tour. The app's gestures are all optional accelerators
 * with a visible equivalent elsewhere, so the cost of missing them is low and
 * the cost of a five-step overlay on first launch is high. One line of text
 * with a button to the reference, remembered forever, is the whole feature.
 */

/** `localStorage` key recording that the hint has been seen. */
export const GESTURES_HINT_STORAGE_KEY = "goodnotes:settings:gestures-hint";

/** Value written when the hint is dismissed. */
const DISMISSED = "dismissed";

const listeners = new Set<(dismissed: boolean) => void>();

let cached: boolean | null = null;

/** True once the user has dismissed (or acted on) the hint. */
export const isGesturesHintDismissed = (): boolean => {
  if (cached !== null) {
    return cached;
  }
  if (typeof window === "undefined") {
    // SSR: never flash a hint we cannot know the state of
    return true;
  }
  try {
    cached =
      window.localStorage.getItem(GESTURES_HINT_STORAGE_KEY) === DISMISSED;
  } catch {
    // storage disabled: showing the hint every launch would be worse than
    // never showing it, so treat it as already seen
    cached = true;
  }
  return cached;
};

/** Marks the hint seen. Idempotent; notifies subscribers on the first call. */
export const dismissGesturesHint = (): void => {
  if (cached === true) {
    return;
  }
  cached = true;
  try {
    window.localStorage.setItem(GESTURES_HINT_STORAGE_KEY, DISMISSED);
  } catch {
    // non-fatal: the hint stays hidden for this session at least
  }
  listeners.forEach((listener) => listener(true));
};

/** Test/host escape hatch: show the hint again on the next render. */
export const resetGesturesHint = (): void => {
  cached = false;
  try {
    window.localStorage.removeItem(GESTURES_HINT_STORAGE_KEY);
  } catch {
    // ignore
  }
  listeners.forEach((listener) => listener(false));
};

/** Subscribes to dismissal. Returns an unsubscribe function. */
export const subscribeGesturesHint = (
  listener: (dismissed: boolean) => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
