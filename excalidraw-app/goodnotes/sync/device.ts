/**
 * A short, human label for *this* device — "iPad", "Mac", "Windows PC".
 *
 * It exists for one reason: a conflict copy called "Lecture 4 (conflict from
 * iPad)" tells a student what happened, and "Lecture 4 (conflict)" does not.
 *
 * Derived from the user agent once, then stored so it stays stable, and
 * editable because the guess is only a guess. It is written into a row the
 * user owns and nowhere else; it is not an identifier and carries nothing
 * the user has not seen.
 */

/** `localStorage` key holding this device's label. */
export const DEVICE_LABEL_STORAGE_KEY = "goodnotes:sync:device";

const guess = (): string => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const touchPoints =
    typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) {
    return "iPad";
  }
  if (/iPhone/.test(ua)) {
    return "iPhone";
  }
  if (/Android/.test(ua)) {
    return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  }
  if (/Macintosh/.test(ua)) {
    return "Mac";
  }
  if (/Windows/.test(ua)) {
    return "Windows PC";
  }
  if (/Linux|X11|CrOS/.test(ua)) {
    return /CrOS/.test(ua) ? "Chromebook" : "Linux PC";
  }
  return "this device";
};

let cached: string | null = null;

/** This device's label, reading (and seeding) `localStorage` once. */
export const getDeviceLabel = (): string => {
  if (cached) {
    return cached;
  }
  try {
    const stored = window.localStorage.getItem(DEVICE_LABEL_STORAGE_KEY);
    if (stored && stored.trim()) {
      cached = stored.trim();
      return cached;
    }
  } catch {
    // private mode / storage disabled: fall through to the guess
  }
  cached = guess();
  try {
    window.localStorage.setItem(DEVICE_LABEL_STORAGE_KEY, cached);
  } catch {
    // nothing to do; the guess is recomputed next load
  }
  return cached;
};

/** Rename this device. Empty input restores the guess. */
export const setDeviceLabel = (label: string): string => {
  const next = label.trim().slice(0, 40) || guess();
  cached = next;
  try {
    window.localStorage.setItem(DEVICE_LABEL_STORAGE_KEY, next);
  } catch {
    // best effort
  }
  return next;
};
