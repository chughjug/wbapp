/**
 * The open-document model behind the tab bar.
 *
 * This is deliberately *not* a scene multiplexer. It stores nothing but an
 * ordered list of document ids plus which one is active — the editor itself is
 * remounted per document by the host (`ExcalidrawWrapper` is keyed on `docId`).
 * Everything here is cheap, synchronous and serialisable.
 *
 * The state lives in a tiny external store (plain listeners + a snapshot) so it
 * can be consumed with `useSyncExternalStore` and mutated from outside React.
 * It is mirrored into `localStorage` on every change so a reload restores the
 * same strip of tabs, and `storage` events are applied so two browser windows
 * of the app do not fight over the list.
 */

/** Immutable snapshot of the open-tab strip. */
export interface OpenDocsState {
  /** Document ids, in tab order, left to right. Always unique. */
  readonly openIds: readonly string[];
  /** The active document id. `null` only when `openIds` is empty. */
  readonly activeId: string | null;
}

export const OPEN_DOCS_STORAGE_KEY = "goodnotes-open-docs";

/** Upper bound on simultaneously open tabs; the oldest inactive tab is evicted. */
export const MAX_OPEN_DOCS = 24;

const EMPTY_STATE: OpenDocsState = { openIds: [], activeId: null };

// ---------------------------------------------------------------------------
// pure reducers — exported so they can be unit-tested without the singleton
// ---------------------------------------------------------------------------

const sameState = (a: OpenDocsState, b: OpenDocsState): boolean =>
  a.activeId === b.activeId &&
  a.openIds.length === b.openIds.length &&
  a.openIds.every((id, index) => id === b.openIds[index]);

/**
 * Normalise an arbitrary (possibly persisted, possibly hostile) value into a
 * valid state: strings only, de-duplicated, length-capped, and an `activeId`
 * that is actually open.
 */
export const normalizeOpenDocs = (raw: unknown): OpenDocsState => {
  const source = (raw ?? {}) as Partial<OpenDocsState>;
  const seen = new Set<string>();
  const openIds: string[] = [];
  for (const id of Array.isArray(source.openIds) ? source.openIds : []) {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      openIds.push(id);
    }
  }
  const capped = openIds.slice(0, MAX_OPEN_DOCS);
  const activeId =
    typeof source.activeId === "string" && capped.includes(source.activeId)
      ? source.activeId
      : capped[0] ?? null;
  return { openIds: capped, activeId };
};

/**
 * Open `id`. Already-open documents are activated in place rather than
 * duplicated. A fresh document is appended after the active one — the same
 * "new tab opens next to the one it came from" behaviour browsers use — and,
 * at the cap, the oldest non-active tab is evicted to make room.
 */
export const openDocIn = (
  state: OpenDocsState,
  id: string,
): OpenDocsState => {
  if (!id) {
    return state;
  }
  if (state.openIds.includes(id)) {
    return state.activeId === id ? state : { ...state, activeId: id };
  }
  const next = [...state.openIds];
  const activeIndex = state.activeId ? next.indexOf(state.activeId) : -1;
  next.splice(activeIndex === -1 ? next.length : activeIndex + 1, 0, id);
  while (next.length > MAX_OPEN_DOCS) {
    const victim = next.findIndex((openId) => openId !== id);
    next.splice(victim === -1 ? 0 : victim, 1);
  }
  return { openIds: next, activeId: id };
};

/**
 * Close `id`. When the closed tab was active, its right-hand neighbour takes
 * over; if it was the last tab, the left-hand one does. Closing an inactive
 * tab never changes which document is active.
 */
export const closeDocIn = (state: OpenDocsState, id: string): OpenDocsState => {
  const index = state.openIds.indexOf(id);
  if (index === -1) {
    return state;
  }
  const openIds = state.openIds.filter((openId) => openId !== id);
  if (state.activeId !== id) {
    return { openIds, activeId: state.activeId };
  }
  const neighbour = openIds[index] ?? openIds[index - 1] ?? null;
  return { openIds, activeId: neighbour };
};

/** Make `id` active. Ignored when `id` is not open. */
export const activateDocIn = (
  state: OpenDocsState,
  id: string,
): OpenDocsState =>
  state.openIds.includes(id) && state.activeId !== id
    ? { ...state, activeId: id }
    : state;

/**
 * Move `id` to `toIndex` (clamped into range), keeping every other tab's
 * relative order. The active document is unchanged — reordering is not
 * navigation.
 */
export const reorderDocIn = (
  state: OpenDocsState,
  id: string,
  toIndex: number,
): OpenDocsState => {
  const from = state.openIds.indexOf(id);
  if (from === -1) {
    return state;
  }
  const to = Math.max(0, Math.min(state.openIds.length - 1, Math.trunc(toIndex)));
  if (to === from) {
    return state;
  }
  const openIds = [...state.openIds];
  openIds.splice(from, 1);
  openIds.splice(to, 0, id);
  return { openIds, activeId: state.activeId };
};

/** Close every tab except `id`, which becomes (or stays) active. */
export const closeOthersIn = (
  state: OpenDocsState,
  id: string,
): OpenDocsState =>
  state.openIds.includes(id) ? { openIds: [id], activeId: id } : state;

/**
 * Drop any tab whose document no longer exists in the library (deleted on this
 * device or another one). `existingIds` is the full set of known document ids.
 */
export const pruneDocsIn = (
  state: OpenDocsState,
  existingIds: Iterable<string>,
): OpenDocsState => {
  const alive = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const openIds = state.openIds.filter((id) => alive.has(id));
  if (openIds.length === state.openIds.length) {
    return state;
  }
  const activeId =
    state.activeId && openIds.includes(state.activeId)
      ? state.activeId
      : openIds[0] ?? null;
  return { openIds, activeId };
};

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

const readStorage = (): OpenDocsState => {
  try {
    const raw = window.localStorage.getItem(OPEN_DOCS_STORAGE_KEY);
    return raw ? normalizeOpenDocs(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    // private mode, quota games, corrupt JSON — an empty strip is always safe
    return EMPTY_STATE;
  }
};

const writeStorage = (state: OpenDocsState) => {
  try {
    window.localStorage.setItem(OPEN_DOCS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // persistence is a nicety; never let it break the UI
  }
};

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

let state: OpenDocsState =
  typeof window === "undefined" ? EMPTY_STATE : readStorage();

const listeners = new Set<() => void>();

const setState = (next: OpenDocsState, persist = true) => {
  if (sameState(next, state)) {
    return;
  }
  state = next;
  if (persist && typeof window !== "undefined") {
    writeStorage(next);
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: any) {
      console.error("goodnotes/tabs: listener threw", error);
    }
  }
};

/** Current snapshot. Referentially stable until something actually changes. */
export const getOpenDocs = (): OpenDocsState => state;

/**
 * Subscribe to open-tab changes. Returns an unsubscribe function; shaped for
 * `useSyncExternalStore`.
 */
export const subscribeOpenDocs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Open (or focus) a document. */
export const openDoc = (id: string): void => setState(openDocIn(state, id));

/** Close a tab, activating a sensible neighbour if it was the active one. */
export const closeDoc = (id: string): void => setState(closeDocIn(state, id));

/** Activate an already-open tab. */
export const activateDoc = (id: string): void =>
  setState(activateDocIn(state, id));

/** Move a tab to a new index. */
export const reorderDoc = (id: string, toIndex: number): void =>
  setState(reorderDocIn(state, id, toIndex));

/** Close every other tab. */
export const closeOtherDocs = (id: string): void =>
  setState(closeOthersIn(state, id));

/** Close everything. */
export const closeAllDocs = (): void => setState(EMPTY_STATE);

/** Forget tabs whose documents no longer exist. */
export const pruneOpenDocs = (existingIds: Iterable<string>): void =>
  setState(pruneDocsIn(state, existingIds));

/** Replace the whole strip (used by tests and by cross-window sync). */
export const setOpenDocs = (next: OpenDocsState): void =>
  setState(normalizeOpenDocs(next));

/**
 * Mirror changes made by another window of the app. Call once at startup; the
 * returned function detaches the listener. Safe to call more than once.
 */
export const syncOpenDocsAcrossWindows = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== OPEN_DOCS_STORAGE_KEY) {
      return;
    }
    // `persist: false` — this change came *from* storage, writing it back
    // would only bounce the event around
    setState(readStorage(), false);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};
