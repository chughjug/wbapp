/**
 * `chromeVisibility` — the editor chrome gets out of the way while you write.
 *
 * THE FEATURE: the moment a stroke begins, the chrome fades out; it comes
 * back the instant you stop drawing — a tap on the page, any pointer that is
 * not the drawing instrument, a key press, or focus landing anywhere in the
 * chrome.
 *
 * WHY IT LIVES IN `goodnotes/input`: this module is the only one that already
 * knows what the pointer is doing — whether a stylus is down, whether palm
 * rejection is suppressing a finger, whether a two-finger gesture is in
 * flight. Re-deriving that in the shell would mean a second, worse copy of
 * the recogniser.
 *
 * ── The contract with the shell ─────────────────────────────────────────────
 * This module NEVER touches the shell's DOM. It offers two things:
 *
 *  1. **A subscribable store.** {@link getChromeVisibility} /
 *     {@link subscribeChromeVisibility} — read it from React (or anything
 *     else) and render the chrome accordingly.
 *  2. **One attribute on `<html>`.** `data-gn-chrome="visible" | "hidden"`,
 *     so a surface can opt in with CSS alone and nothing has to be re-wired
 *     when the shell is rebuilt. Mark a surface with the
 *     `data-gn-chrome-surface` attribute and `chromeVisibility.scss` fades it.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * Hidden chrome is **faded, never unmounted and never `display: none`**. It
 * stays in the accessibility tree, keeps its place in the tab order, and is
 * still reachable by screen reader review — `opacity: 0` is the one way of
 * visually hiding something that does *not* remove it from the a11y tree.
 * The reasoning is in `INTEGRATION.md`; the short version is that unmounting
 * the toolbar would silently change the tab order under a keyboard user
 * mid-task and make a screen reader user's mental model of the page depend on
 * whether a pen happened to be touching the glass.
 *
 * Two safety rails come with that:
 *
 *  - while hidden, the surfaces take `pointer-events: none`, so nothing is
 *    activated by a touch that lands on an invisible button;
 *  - focus — from Tab, from a screen reader, from anything — reveals the
 *    chrome immediately, in JS here and as a `:focus-within` rule in the CSS
 *    in case JS is late.
 *
 * And it refuses to hide at all while a menu or dialog is open, while a text
 * field has focus, or while the user is driving the app from the keyboard.
 */

import "./chromeVisibility.scss";

/** Why the chrome last changed state. Useful for tests and telemetry. */
export type ChromeVisibilityReason =
  | "initial"
  | "stroke"
  | "stroke-end"
  | "tap"
  | "pointer"
  | "gesture"
  | "keyboard"
  | "focus"
  | "blocked"
  | "disabled"
  | "host";

export interface ChromeVisibilityState {
  /** `false` while the user is drawing and the chrome has faded out. */
  visible: boolean;
  /** What last changed it. */
  reason: ChromeVisibilityReason;
  /**
   * The user asked for no animation. Mirrored into the store so a host that
   * animates in JS (or in React, via a transition) can swap instantly too —
   * the CSS in `chromeVisibility.scss` already honours it.
   */
  reducedMotion: boolean;
}

/** The attribute this module sets on `<html>`. */
export const CHROME_VISIBILITY_ATTRIBUTE = "data-gn-chrome";

/**
 * Mark any element with this attribute and `chromeVisibility.scss` fades it
 * with the rest of the chrome. The shell's own bar should use it rather than
 * having this module know its class names.
 */
export const CHROME_SURFACE_ATTRIBUTE = "data-gn-chrome-surface";

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

let state: ChromeVisibilityState = {
  visible: true,
  reason: "initial",
  reducedMotion: typeof window === "undefined" ? false : reducedMotion(),
};

const listeners = new Set<(state: ChromeVisibilityState) => void>();

const applyAttribute = (doc: Document | undefined) => {
  const root = (doc ?? (typeof document === "undefined" ? null : document))
    ?.documentElement;
  if (!root) {
    return;
  }
  root.setAttribute(
    CHROME_VISIBILITY_ATTRIBUTE,
    state.visible ? "visible" : "hidden",
  );
  root.toggleAttribute("data-gn-chrome-instant", state.reducedMotion);
};

/** The current state. Cheap — no DOM reads. */
export const getChromeVisibility = (): ChromeVisibilityState => state;

/**
 * Subscribe to chrome visibility. Fires immediately with the current state so
 * a subscriber never has to read it separately, and returns an unsubscribe.
 */
export const subscribeChromeVisibility = (
  listener: (state: ChromeVisibilityState) => void,
): (() => void) => {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Set the chrome's visibility. Exported so a host can force it (e.g. reveal
 * the chrome when it opens something of its own) and so tests can drive it.
 */
export const setChromeVisible = (
  visible: boolean,
  reason: ChromeVisibilityReason = "host",
  doc?: Document,
): ChromeVisibilityState => {
  const next: ChromeVisibilityState = {
    visible,
    reason,
    reducedMotion: typeof window === "undefined" ? false : reducedMotion(),
  };
  const changed =
    next.visible !== state.visible ||
    next.reducedMotion !== state.reducedMotion;
  state = next;
  applyAttribute(doc);
  if (changed) {
    listeners.forEach((listener) => listener(state));
  }
  return state;
};

/** Test seam: back to "visible", no listeners fired. */
export const resetChromeVisibility = (doc?: Document) => {
  state = { visible: true, reason: "initial", reducedMotion: false };
  applyAttribute(doc);
};

/* -------------------------------------------------------------------------- */
/*  The "may we hide?" rules                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Anything that means a menu, popover or dialog is open. Hiding the chrome
 * under an open menu would animate the thing the user is reading.
 *
 * Deliberately broad and selector-based: this module must not import the
 * shell, the settings screen or the tool menu to ask them.
 */
export const BLOCKING_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[aria-modal="true"]',
  "dialog[open]",
  ".gn-settings-backdrop",
  ".excalidraw .Dialog",
  ".excalidraw .Modal",
  ".excalidraw .popover",
  ".excalidraw .dropdown-menu",
  ".excalidraw-modal-container",
] as const;

const isVisibleElement = (el: Element): boolean => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** Is a menu, popover or dialog currently up? */
export const isMenuOrDialogOpen = (doc: Document = document): boolean =>
  BLOCKING_SELECTORS.some((selector) => {
    const found = doc.querySelectorAll(selector);
    for (const el of found) {
      if (isVisibleElement(el)) {
        return true;
      }
    }
    return false;
  });

/**
 * Does a text field have focus? Includes Excalidraw's own canvas text editor
 * (`.excalidraw-wysiwyg`), which is a real textarea over the canvas — typing
 * a label is not "writing a stroke" and must not hide the toolbar.
 */
export const isTextFieldFocused = (doc: Document = document): boolean => {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "checkbox" && type !== "radio" && type !== "button";
  }
  return false;
};

/**
 * How long after a key press the user still counts as "navigating by
 * keyboard". Long enough to cover the gap between Tab presses, short enough
 * that putting the keyboard down and picking up the pen works at once.
 */
export const KEYBOARD_GRACE_MS = 2500;

export interface ChromeAutoHideOptions {
  /** Live read of the user's switch. */
  isEnabled?: () => boolean;
  /** Test seam. */
  document?: Document;
  /** Called on every change (same payload as the store). */
  onChange?: (state: ChromeVisibilityState) => void;
}

export interface ChromeAutoHideHandle {
  /** A mark-making pointer went down: fade the chrome out. */
  strokeStart: (pointerId?: number, x?: number, y?: number) => void;
  /**
   * That pointer came up. A pointer that barely moved was a tap, not a
   * stroke, so the chrome comes straight back — this is the "tap on empty
   * canvas brings it back" route, and it is also what stops a stray dot from
   * leaving the user with no toolbar.
   */
  strokeEnd: (pointerId?: number, x?: number, y?: number) => void;
  /** A pointer that is not drawing (a finger pan, a mouse on a button, …). */
  reveal: (reason?: ChromeVisibilityReason) => void;
  /** A multi-pointer gesture started: never a stroke. */
  gesture: () => void;
  /** Re-evaluate after the settings changed (turning it off reveals). */
  notifySettingsChanged: () => void;
  /** Is hiding currently forbidden, and why. */
  blockedBy: () => "menu" | "text-field" | "keyboard" | null;
  detach: () => void;
}

/**
 * The auto-hide state machine. One per attached editor; `gestures.ts` owns
 * the instance and feeds it pointer facts, while the controller itself owns
 * the keyboard and focus rules (which have nothing to do with the stylus).
 */
export const createChromeAutoHide = (
  options: ChromeAutoHideOptions = {},
): ChromeAutoHideHandle => {
  const doc = options.document ?? document;
  const win = doc.defaultView ?? window;
  const isEnabled = options.isEnabled ?? (() => true);

  /** How far a pointer may travel and still count as a tap, in px. */
  const TAP_SLOP_PX = 8;

  let lastKeyAt = -Infinity;
  let stroke: { id: number; x: number; y: number } | null = null;

  const emit = (visible: boolean, reason: ChromeVisibilityReason) => {
    const before = getChromeVisibility().visible;
    const next = setChromeVisible(visible, reason, doc);
    if (before !== next.visible) {
      options.onChange?.(next);
    }
  };

  const blockedBy = (): "menu" | "text-field" | "keyboard" | null => {
    if (isMenuOrDialogOpen(doc)) {
      return "menu";
    }
    if (isTextFieldFocused(doc)) {
      return "text-field";
    }
    if (performance.now() - lastKeyAt < KEYBOARD_GRACE_MS) {
      return "keyboard";
    }
    return null;
  };

  const reveal = (reason: ChromeVisibilityReason = "pointer") => {
    if (!getChromeVisibility().visible) {
      emit(true, reason);
    }
  };

  const strokeStart = (pointerId = -1, x = 0, y = 0) => {
    stroke = { id: pointerId, x, y };
    if (!isEnabled()) {
      return;
    }
    const blocked = blockedBy();
    if (blocked) {
      // a menu is up / a field has focus / they are on the keyboard —
      // hiding the toolbar under their hands is worse than the clutter
      reveal("blocked");
      return;
    }
    emit(false, "stroke");
  };

  const strokeEnd = (pointerId = -1, x = 0, y = 0) => {
    const current = stroke;
    stroke = null;
    if (!current || (pointerId !== -1 && current.id !== pointerId)) {
      return;
    }
    const travel = Math.hypot(x - current.x, y - current.y);
    if (travel <= TAP_SLOP_PX) {
      // a tap, not a stroke
      reveal("tap");
    }
  };

  const onKeyDown = () => {
    lastKeyAt = performance.now();
    reveal("keyboard");
  };

  const onFocusIn = (event: FocusEvent) => {
    // A stroke in progress moves focus by itself: the editor focuses its own
    // container on pointer-down. That is the very gesture that just hid the
    // chrome, so it must not immediately un-hide it. `stroke` is already set
    // here because the recogniser listens in the capture phase, ahead of the
    // editor's own handler.
    if (stroke) {
      return;
    }
    const target = event.target as Element | null;
    if (target instanceof Element && target.closest(".excalidraw__canvas")) {
      return;
    }
    reveal("focus");
  };

  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("focusin", onFocusIn, true);

  const motion = (() => {
    try {
      return win.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return null;
    }
  })();
  const onMotionChange = () =>
    setChromeVisible(getChromeVisibility().visible, "host", doc);
  motion?.addEventListener?.("change", onMotionChange);

  // publish the initial attribute so CSS has something to match from boot
  setChromeVisible(true, "initial", doc);

  return {
    strokeStart,
    strokeEnd,
    reveal,
    gesture: () => reveal("gesture"),
    notifySettingsChanged: () => {
      if (!isEnabled()) {
        reveal("disabled");
      }
    },
    blockedBy,
    detach: () => {
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("focusin", onFocusIn, true);
      motion?.removeEventListener?.("change", onMotionChange);
      setChromeVisible(true, "disabled", doc);
    },
  };
};
