/**
 * The paged/continuous switch, persisted to `localStorage`.
 *
 * Paged is the default, but the infinite canvas stays one click away — some
 * documents (mind maps, scratch work) genuinely want it, and a view mode that
 * cannot be turned off is a trap.
 *
 * Framework-free, so the controller and the React surface share one source of
 * truth and a host that does not want the toggle UI can still read/write it.
 */

export type ViewMode = "paged" | "continuous";

export const DEFAULT_VIEW_MODE: ViewMode = "paged";

export const VIEW_MODE_STORAGE_KEY = "goodnotes:view-mode";

const listeners = new Set<(mode: ViewMode) => void>();

let cached: ViewMode | null = null;

const coerce = (raw: unknown): ViewMode =>
  raw === "continuous" || raw === "paged" ? raw : DEFAULT_VIEW_MODE;

/** Current view mode (reads `localStorage` once, then an in-memory cache). */
export const loadViewMode = (): ViewMode => {
  if (cached) {
    return cached;
  }
  if (typeof window === "undefined") {
    return DEFAULT_VIEW_MODE;
  }
  try {
    cached = coerce(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY));
  } catch {
    // private mode / quota / disabled storage — the default is always usable
    cached = DEFAULT_VIEW_MODE;
  }
  return cached;
};

/** Persists the mode and notifies every subscriber (including other tabs). */
export const saveViewMode = (mode: ViewMode): ViewMode => {
  const next = coerce(mode);
  cached = next;
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
  } catch {
    // non-fatal: the session still honours the change
  }
  listeners.forEach((listener) => listener(next));
  return next;
};

/** Subscribes to mode changes, this tab's and other tabs'. */
export const subscribeViewMode = (
  listener: (mode: ViewMode) => void,
): (() => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== VIEW_MODE_STORAGE_KEY) {
      return;
    }
    cached = null;
    listener(loadViewMode());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Test/host escape hatch: drop the in-memory cache. */
export const resetViewModeCache = () => {
  cached = null;
};
