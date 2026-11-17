/**
 * Horizontal slide cue when the user turns a page with a swipe.
 *
 * Pages are stored in a vertical stack, so the viewport animation from
 * `setViewport` is a vertical ease. This overlay adds the left/right motion
 * people expect from a notebook page flick without changing the page model.
 */

export type PageTurnDirection = -1 | 1;

const NEXT_CLASS = "gn-page-turn--next";
const PREV_CLASS = "gn-page-turn--prev";
const ACTIVE_CLASSES = [NEXT_CLASS, PREV_CLASS] as const;

const DEFAULT_SELECTOR = ".gn-shell-canvas";

let clearTimer: number | undefined;

const prefersReducedMotion = (): boolean => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  try {
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true
    );
  } catch {
    return false;
  }
};

/**
 * Play a short horizontal page-turn on the canvas stage.
 *
 * `direction` matches the swipe: `1` = next (content exits left / enters from
 * the right), `-1` = previous.
 */
export const playPageTurnAnimation = (
  direction: PageTurnDirection,
  root?: ParentNode | null,
): void => {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    return;
  }
  const scope: ParentNode = root ?? document;
  const el =
    scope instanceof HTMLElement && scope.matches(DEFAULT_SELECTOR)
      ? scope
      : "querySelector" in scope
      ? scope.querySelector<HTMLElement>(DEFAULT_SELECTOR)
      : null;
  if (!el) {
    return;
  }

  for (const name of ACTIVE_CLASSES) {
    el.classList.remove(name);
  }
  // force a reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add(direction === 1 ? NEXT_CLASS : PREV_CLASS);

  if (typeof window !== "undefined") {
    window.clearTimeout(clearTimer);
  }
  const clear = () => {
    el.classList.remove(NEXT_CLASS, PREV_CLASS);
  };
  el.addEventListener("animationend", clear, { once: true });
  clearTimer = window.setTimeout(clear, 420);
};
