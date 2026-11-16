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

// ---------------------------------------------------------------------------
// the override — how a whiteboard document suspends paged view
// ---------------------------------------------------------------------------

/**
 * A document can be a *whiteboard* (`goodnotes/surface`), i.e. not made of
 * paper at all. Paged view is a paper idea — there is no page to fit — so
 * while such a document is open the surface module installs an OVERRIDE of
 * `"continuous"` here.
 *
 * The override is deliberately NOT written to `localStorage`: the user's
 * paged/continuous preference must survive opening a whiteboard and come
 * back untouched when they open a paper document again. Settings → View mode
 * therefore keeps reading `loadViewMode` / `subscribeViewMode` (the stored
 * preference), while the controller reads the EFFECTIVE mode below.
 */
let override: ViewMode | null = null;

const effectiveListeners = new Set<(mode: ViewMode) => void>();

/** The mode the viewport should actually be in right now. */
export const getEffectiveViewMode = (): ViewMode => override ?? loadViewMode();

/** The current override, or `null` when the stored preference is in charge. */
export const getViewModeOverride = (): ViewMode | null => override;

/** Installs (or, with `null`, removes) the override. Returns the effective mode. */
export const setViewModeOverride = (mode: ViewMode | null): ViewMode => {
  const next = mode === null ? null : coerce(mode);
  if (next === override) {
    return getEffectiveViewMode();
  }
  override = next;
  const effective = getEffectiveViewMode();
  effectiveListeners.forEach((listener) => listener(effective));
  return effective;
};

/**
 * Subscribes to the EFFECTIVE mode: fires both when the stored preference
 * changes (including from another tab) and when the override changes.
 */
export const subscribeEffectiveViewMode = (
  listener: (mode: ViewMode) => void,
): (() => void) => {
  effectiveListeners.add(listener);
  const unsubscribeStored = subscribeViewMode(() =>
    listener(getEffectiveViewMode()),
  );
  return () => {
    effectiveListeners.delete(listener);
    unsubscribeStored();
  };
};
