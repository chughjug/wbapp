/**
 * Fuzzy select — activation.
 *
 * The overlay is always mounted (it is inert and pointer-transparent when
 * off); turning the *tool* on and off goes through this tiny observable
 * store.
 *
 * It is deliberately framework-free and callback-shaped so that a
 * centralized taskbar — built by another module, possibly outside React —
 * can wire a button to {@link activateFuzzySelect} without importing the
 * component or sharing React state:
 *
 * ```ts
 * import { activateFuzzySelect, toggleFuzzySelect } from "./goodnotes/fuzzy-select";
 *
 * <button onClick={toggleFuzzySelect}>Fuzzy select</button>
 * ```
 *
 * …and read the on/off state for the button's pressed styling:
 *
 * ```ts
 * const active = useFuzzySelectActive();
 * ```
 */

import { useSyncExternalStore } from "react";

export type FuzzySelectListener = (active: boolean) => void;

export interface FuzzySelectActivation {
  /** Turn the tool on. Idempotent. */
  activate: () => void;
  /** Turn the tool off, discarding any in-progress selection. Idempotent. */
  deactivate: () => void;
  /** Flip the tool. @returns the new state. */
  toggle: () => boolean;
  /** Set the tool state explicitly. */
  setActive: (active: boolean) => void;
  isActive: () => boolean;
  /** @returns an unsubscribe function. */
  subscribe: (listener: FuzzySelectListener) => () => void;
}

export const createFuzzySelectActivation = (
  initialActive = false,
): FuzzySelectActivation => {
  let active = initialActive;
  const listeners = new Set<FuzzySelectListener>();

  const setActive = (next: boolean) => {
    if (next === active) {
      return;
    }
    active = next;
    for (const listener of [...listeners]) {
      listener(active);
    }
  };

  return {
    activate: () => setActive(true),
    deactivate: () => setActive(false),
    toggle: () => {
      setActive(!active);
      return active;
    },
    setActive,
    isActive: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * The app-wide fuzzy-select switch. One per app; the overlay subscribes to
 * it unless given an explicit `active` prop.
 */
export const fuzzySelectActivation = createFuzzySelectActivation();

/** Callback-shaped entry point for a taskbar button. */
export const activateFuzzySelect = (): void => fuzzySelectActivation.activate();

/** Callback-shaped entry point for turning the tool back off. */
export const deactivateFuzzySelect = (): void =>
  fuzzySelectActivation.deactivate();

/** Callback-shaped toggle. @returns the new state. */
export const toggleFuzzySelect = (): boolean => fuzzySelectActivation.toggle();

/** Whether the tool is currently on (non-reactive read). */
export const isFuzzySelectActive = (): boolean =>
  fuzzySelectActivation.isActive();

/** React binding for the activation store, for `aria-pressed` and styling. */
export const useFuzzySelectActive = (
  store: FuzzySelectActivation = fuzzySelectActivation,
): boolean =>
  useSyncExternalStore(
    store.subscribe,
    store.isActive,
    // server snapshot — the tool is never on during SSR
    () => false,
  );
