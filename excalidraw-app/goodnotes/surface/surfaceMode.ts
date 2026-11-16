/**
 * "Is this document made of paper?" — the surface mode, persisted PER
 * DOCUMENT.
 *
 * WHY PER DOCUMENT AND NOT A THIRD `ViewMode`: paged-vs-continuous is a way
 * of *looking* at a document; whiteboard-vs-paper is what the document *is*.
 * A lecture notebook is 40 sheets of A4 whether you are looking at one page
 * or scrolling the stack, and a mind map is not three sheets of A4 just
 * because the viewport happens to be in paged mode. Making it a `ViewMode`
 * would also make it global: turning one scratch document into a whiteboard
 * would blank the pages of every other document the user opens.
 *
 * WHERE IT IS STORED: `localStorage`, keyed by the document id (the same
 * two-tier-ish convention `goodnotes/pages/newPageChoice.ts` uses for the
 * remembered new-page format). `goodnotes/types.ts` is owned by the
 * integrator and has no field for this; a `DocMeta.surface?: "paper" |
 * "whiteboard"` would be the better home and is requested in
 * `INTEGRATION.md`. Until then this tier is the only one, which means the
 * mode is per-browser, not per-device-sync (documented as a gap).
 *
 * NOTHING HERE TOUCHES THE SCENE. Switching to whiteboard changes
 * `appState.frameRendering` and the paper layer's input — not a single
 * element. That is what makes the round trip non-destructive by
 * construction: there is no page data to lose because no page data is
 * written.
 */

export type SurfaceMode = "paper" | "whiteboard";

export const DEFAULT_SURFACE_MODE: SurfaceMode = "paper";

/** `goodnotes:surface-mode:<docId>` */
export const SURFACE_MODE_STORAGE_PREFIX = "goodnotes:surface-mode:";

/** Key used for a transient scene (a shared link with no document id). */
export const TRANSIENT_DOC_KEY = "__transient__";

export const surfaceModeStorageKey = (docId?: string | null): string =>
  `${SURFACE_MODE_STORAGE_PREFIX}${docId ?? TRANSIENT_DOC_KEY}`;

const coerce = (raw: unknown): SurfaceMode =>
  raw === "whiteboard" || raw === "paper" ? raw : DEFAULT_SURFACE_MODE;

/** `/d/<id>` → `<id>`. Same convention as `goodnotes/pages`. */
export const getCurrentDocId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const listeners = new Set<(mode: SurfaceMode, docId: string | null) => void>();

/** The surface mode of one document. Safe in SSR / private mode. */
export const loadSurfaceMode = (docId?: string | null): SurfaceMode => {
  if (typeof localStorage === "undefined") {
    return DEFAULT_SURFACE_MODE;
  }
  try {
    return coerce(localStorage.getItem(surfaceModeStorageKey(docId)));
  } catch {
    return DEFAULT_SURFACE_MODE;
  }
};

/** Persists the mode for one document and notifies every subscriber. */
export const saveSurfaceMode = (
  docId: string | null | undefined,
  mode: SurfaceMode,
): SurfaceMode => {
  const next = coerce(mode);
  try {
    localStorage.setItem(surfaceModeStorageKey(docId), next);
  } catch {
    // private mode / quota: the session still honours the change
  }
  listeners.forEach((listener) => listener(next, docId ?? null));
  return next;
};

/**
 * Subscribes to surface-mode changes, this tab's and (via `storage`) other
 * tabs'. The listener receives the document the change applies to, so a host
 * watching one document can ignore the others.
 */
export const subscribeSurfaceMode = (
  listener: (mode: SurfaceMode, docId: string | null) => void,
): (() => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(SURFACE_MODE_STORAGE_PREFIX)) {
      return;
    }
    const key = event.key.slice(SURFACE_MODE_STORAGE_PREFIX.length);
    listener(coerce(event.newValue), key === TRANSIENT_DOC_KEY ? null : key);
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};
