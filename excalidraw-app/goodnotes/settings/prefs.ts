/**
 * Preferences this module owns outright.
 *
 * Everything else on the Settings screen is a *view* onto another module's
 * settings model (`goodnotes/input`'s `InputSettings`, `goodnotes/dark`'s
 * preference, `goodnotes/paged`'s view mode, `goodnotes/pens`' presets). Those
 * modules stay the single source of truth and this module never shadows them.
 *
 * Two things had no home anywhere, so they live here:
 *
 *  1. **The default paper template for new pages.** `goodnotes/pages` remembers
 *     the *last* choice per document; nothing expressed "start every new page
 *     lined". This key is that preference. It is read by the host when it seeds
 *     the new-page dialog (see `INTEGRATION.md` — the module cannot wire it
 *     itself without editing `goodnotes/pages`, which it does not own).
 *  2. **Whether the first-run gestures hint has been dismissed** (`firstRun.ts`).
 *
 * Framework-free and `localStorage`-backed, matching the conventions of the
 * modules it sits beside: load / save / subscribe, cross-tab aware, and total
 * in the face of private mode, quota errors and corrupt JSON.
 */

import type { PaperTemplateId } from "../types";

/** `localStorage` key holding the default paper template for new pages. */
export const DEFAULT_PAPER_STORAGE_KEY = "goodnotes:settings:default-paper";

/** Used when nothing has been chosen (matches `goodnotes/pages`' own default). */
export const DEFAULT_PAPER_TEMPLATE: PaperTemplateId = "lined";

const TEMPLATE_IDS: readonly PaperTemplateId[] = [
  "blank",
  "lined",
  "grid",
  "dotted",
  "cornell",
  "staff",
];

const listeners = new Set<(template: PaperTemplateId) => void>();

let cached: PaperTemplateId | null = null;

const coerce = (raw: unknown): PaperTemplateId =>
  typeof raw === "string" && TEMPLATE_IDS.includes(raw as PaperTemplateId)
    ? (raw as PaperTemplateId)
    : DEFAULT_PAPER_TEMPLATE;

/** The preferred paper for new pages (reads storage once, then a cache). */
export const loadDefaultPaper = (): PaperTemplateId => {
  if (cached) {
    return cached;
  }
  if (typeof window === "undefined") {
    return DEFAULT_PAPER_TEMPLATE;
  }
  try {
    cached = coerce(window.localStorage.getItem(DEFAULT_PAPER_STORAGE_KEY));
  } catch {
    cached = DEFAULT_PAPER_TEMPLATE;
  }
  return cached;
};

/** Persists the preference and notifies every subscriber. */
export const saveDefaultPaper = (
  template: PaperTemplateId,
): PaperTemplateId => {
  const next = coerce(template);
  cached = next;
  try {
    window.localStorage.setItem(DEFAULT_PAPER_STORAGE_KEY, next);
  } catch {
    // non-fatal: the session still honours the change
  }
  listeners.forEach((listener) => listener(next));
  return next;
};

/** Subscribes to changes, this tab's and other tabs'. Returns unsubscribe. */
export const subscribeDefaultPaper = (
  listener: (template: PaperTemplateId) => void,
): (() => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== DEFAULT_PAPER_STORAGE_KEY) {
      return;
    }
    cached = null;
    listener(loadDefaultPaper());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Test/host escape hatch: drop the in-memory cache. */
export const resetDefaultPaperCache = () => {
  cached = null;
};
