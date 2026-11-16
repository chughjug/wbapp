/**
 * Modal focus plumbing: trap Tab inside the dialog, restore focus on close.
 *
 * Written here rather than pulled from a library because the behaviour has to
 * be exactly three things and no more:
 *
 *  1. On open, move focus into the dialog (the first focusable element, or the
 *     container itself if the dialog happens to be empty).
 *  2. While open, `Tab` and `Shift+Tab` wrap at the ends of the dialog's
 *     focusable set, recomputed on every keypress so controls that appear
 *     (a confirmation panel, a progress button) join the cycle immediately.
 *  3. On close, return focus to whatever had it before — the menu item that
 *     opened the dialog — so the keyboard user is not dumped at `<body>`.
 */

import { useEffect } from "react";

import type { RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      // `offsetParent === null` also catches `display: none` ancestors, which
      // is what the visually-hidden legends and inactive panels use
      element.offsetParent !== null ||
      element.getClientRects().length > 0 ||
      element === document.activeElement,
  );

export const useFocusTrap = (
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
) => {
  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const initial = focusableWithin(container)[0] ?? container;
    // the container carries tabindex={-1} so it is always a valid target
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active_ = document.activeElement as HTMLElement | null;

      if (!active_ || !container.contains(active_)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active_ === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active_ === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // the opener may itself have been unmounted; guard the restore
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef]);
};
