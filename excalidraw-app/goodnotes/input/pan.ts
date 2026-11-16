/**
 * One-finger panning — "drag the page with your finger", the tablet idiom.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * The editor pans with TWO pointers (`updateMultiTouchGesture` in
 * `packages/excalidraw/components/App.tsx` only acts when
 * `gesture.pointers.size === 2`), or with one pointer while the hand tool /
 * space-drag is engaged. A single finger is otherwise a *drawing* pointer.
 *
 * On a tablet that is the wrong default once a stylus is in play: the pen
 * writes, the finger moves the paper. And it is actively broken under palm
 * rejection — with `appState.penMode` raised, the editor *ignores* a touch
 * pointer on a drawing tool (`allowOnPointerDown`), so a one-finger drag did
 * precisely nothing: it could not draw and it could not scroll.
 *
 * This module is the missing half: when the finger is demonstrably NOT the
 * drawing instrument, a one-finger drag moves the viewport 1:1 with the
 * finger. See {@link canOneFingerPan} for the exact rule and `gestures.ts`
 * for where it is wired in.
 *
 * ── Clamping ───────────────────────────────────────────────────────────────
 * Paged mode installs `appState.scrollConstraints` (via
 * `setViewport({ lock })`), and the editor applies those constraints inside
 * its own `translate()`. We do not go through `translate()` — it is not on
 * the imperative API — so we apply the SAME clamp ourselves with
 * {@link clampViewport}, which `goodnotes/paged` keeps as a faithful mirror
 * of `constrainScrollAxis`. Net effect: a finger pan obeys the page lock
 * exactly like a wheel or a two-finger pan does, and can never walk into a
 * neighbouring page.
 *
 * With no constraints installed (continuous mode) the pan is free.
 *
 * ── Rubberband ─────────────────────────────────────────────────────────────
 * Paged mode deliberately installs `overscroll: false`, so the editor's own
 * rubberband is off. A rigid stop is right at the *resting* state, but it
 * makes the common "page already fits, nothing to scroll" case feel like a
 * dead screen — which is exactly what the bug report was about. So the pan
 * applies its own small, heavily damped give ({@link OVERSCROLL_MAX_PX},
 * asymptotic so it can never be pushed further) and springs back on release.
 * It is a *hint*, not navigation: it is far smaller than the page gap, so no
 * neighbouring page is ever revealed, and the viewport always ends the
 * gesture exactly on the clamp.
 */

import {
  EMPTY_INSETS,
  clampViewport,
  type CanvasBox,
  type Insets,
  type Rect,
  type Viewport,
} from "../paged/pagedView";

import {
  ONE_FINGER_PAN_SLOP_PX,
  OVERSCROLL_MAX_PX,
  OVERSCROLL_SPRING_MS,
} from "./constants";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** Tools for which the editor still honours a touch pointer in pen mode. */
const TOUCH_TOOLS_IN_PEN_MODE = new Set([
  "selection",
  "lasso",
  "text",
  "image",
]);

/**
 * May a single finger pan right now?
 *
 * THE RULE: only when the finger cannot be the drawing instrument — i.e.
 * when `appState.penMode` is up (palm rejection has seen a stylus, or
 * "pencil only" is on) **and** the active tool is one the editor refuses to
 * start from a `touch` pointer. That mirrors `allowOnPointerDown` in
 * `packages/excalidraw/components/App.tsx`, which is what makes this safe:
 * in exactly those cases the editor drops the touch on the floor, so there
 * is nothing to steal and no ambiguity to resolve. With the selection, lasso,
 * text or image tool the finger still selects/marquees as the editor
 * intends, and with pen mode off the finger is the user's pencil.
 *
 * The alternative ("one finger always pans") was rejected: it would have to
 * swallow `pointerdown` to stop the finger also drawing, and swallowing
 * touch `pointerdown` is what breaks pinch-zoom (see the header of
 * `gestures.ts`). A user who draws with a finger but still wants finger
 * panning has a supported route — turn on "Pencil-only drawing", which is
 * precisely the statement "my finger is not a pen".
 *
 * The hand tool is left alone: the editor already pans one-finger there.
 */
export const canOneFingerPan = (appState: {
  penMode: boolean;
  activeTool: { type: string };
}): boolean =>
  appState.penMode && !TOUCH_TOOLS_IN_PEN_MODE.has(appState.activeTool.type);

/** Asymptotic resistance: `d → max` as `d → ∞`, with slope 1 at the origin. */
export const resist = (distance: number, max = OVERSCROLL_MAX_PX): number =>
  max <= 0 ? 0 : (max * distance) / (distance + max);

export interface OneFingerPanHandle {
  /** A finger landed. Does not pan yet — it waits for the slop threshold. */
  start: (x: number, y: number) => void;
  /** The finger moved. Returns true once the pan has actually engaged. */
  move: (x: number, y: number) => boolean;
  /** The finger lifted: spring any overscroll back and stop. */
  end: () => void;
  /** A second finger arrived / the window blurred: hand back immediately. */
  cancel: () => void;
  /** True once the slop threshold has been passed. */
  isPanning: () => boolean;
  /** Stop everything (unmount). */
  destroy: () => void;
}

interface Limits {
  rect: Rect;
  box: CanvasBox;
  insets: Insets;
}

const readLimits = (api: ExcalidrawImperativeAPI): Limits | null => {
  const appState = api.getAppState();
  const constraints = appState.scrollConstraints;
  if (!constraints || !constraints.lockScroll) {
    return null;
  }
  const offsets = constraints.offsets ?? EMPTY_INSETS;
  return {
    rect: {
      x: constraints.x,
      y: constraints.y,
      width: constraints.width,
      height: constraints.height,
    },
    box: { width: appState.width, height: appState.height },
    insets: {
      top: offsets.top ?? 0,
      right: offsets.right ?? 0,
      bottom: offsets.bottom ?? 0,
      left: offsets.left ?? 0,
    },
  };
};

/** The clamped (resting) viewport for a desired one, honouring the lock. */
const clampToLock = (
  viewport: Viewport,
  limits: Limits | null,
): Viewport =>
  limits
    ? clampViewport(viewport, limits.rect, limits.box, limits.insets, 0)
    : viewport;

export interface CreateOneFingerPanOptions {
  /** Test seam. */
  window?: Window;
  /** Called the first time a gesture passes the slop threshold. */
  onEngage?: () => void;
}

export const createOneFingerPan = (
  api: ExcalidrawImperativeAPI,
  options: CreateOneFingerPanOptions = {},
): OneFingerPanHandle => {
  const win = options.window ?? window;

  let active = false;
  let engaged = false;
  let originX = 0;
  let originY = 0;
  /** Scroll the gesture would reach with no clamp at all, in scene units. */
  let desiredX = 0;
  let desiredY = 0;
  let limits: Limits | null = null;
  let frame = 0;
  let spring = 0;
  let pending: { x: number; y: number } | null = null;

  const cancelSpring = () => {
    if (spring) {
      win.cancelAnimationFrame(spring);
      spring = 0;
    }
  };

  const write = (scrollX: number, scrollY: number) => {
    api.updateScene({ appState: { scrollX, scrollY } });
  };

  /** Applies `desired` with rubberband give past the clamp. */
  const flush = () => {
    frame = 0;
    if (!active || !pending || api.isDestroyed) {
      return;
    }
    const appState = api.getAppState();
    const zoom = appState.zoom.value;
    const desired: Viewport = { scrollX: desiredX, scrollY: desiredY, zoom };
    const resting = clampToLock(desired, limits);

    // the give is measured (and capped) in SCREEN px, so it feels the same
    // at every zoom
    const giveX = (desired.scrollX - resting.scrollX) * zoom;
    const giveY = (desired.scrollY - resting.scrollY) * zoom;

    write(
      resting.scrollX + (Math.sign(giveX) * resist(Math.abs(giveX))) / zoom,
      resting.scrollY + (Math.sign(giveY) * resist(Math.abs(giveY))) / zoom,
    );
    pending = null;
  };

  const schedule = (x: number, y: number) => {
    pending = { x, y };
    if (!frame) {
      frame = win.requestAnimationFrame(flush);
    }
  };

  const settle = () => {
    if (api.isDestroyed) {
      return;
    }
    const appState = api.getAppState();
    const from = { scrollX: appState.scrollX, scrollY: appState.scrollY };
    const to = clampToLock(
      { ...from, zoom: appState.zoom.value },
      limits ?? readLimits(api),
    );
    const dx = to.scrollX - from.scrollX;
    const dy = to.scrollY - from.scrollY;
    const travel = Math.hypot(dx, dy) * appState.zoom.value;
    if (travel < 0.5) {
      return;
    }
    const startedAt = performance.now();
    const step = () => {
      spring = 0;
      if (api.isDestroyed || active) {
        return;
      }
      const t = Math.min(1, (performance.now() - startedAt) / OVERSCROLL_SPRING_MS);
      // ease-out cubic: fast release, soft landing
      const eased = 1 - (1 - t) ** 3;
      write(from.scrollX + dx * eased, from.scrollY + dy * eased);
      if (t < 1) {
        spring = win.requestAnimationFrame(step);
      }
    };
    cancelSpring();
    spring = win.requestAnimationFrame(step);
  };

  const stop = (withSpring: boolean) => {
    if (!active) {
      return;
    }
    active = false;
    if (frame) {
      win.cancelAnimationFrame(frame);
      frame = 0;
    }
    pending = null;
    const wasEngaged = engaged;
    engaged = false;
    if (withSpring && wasEngaged) {
      settle();
    }
  };

  return {
    start: (x, y) => {
      cancelSpring();
      active = true;
      engaged = false;
      originX = x;
      originY = y;
      limits = readLimits(api);
      const appState = api.getAppState();
      desiredX = appState.scrollX;
      desiredY = appState.scrollY;
    },
    move: (x, y) => {
      if (!active || api.isDestroyed) {
        return false;
      }
      if (!engaged) {
        if (Math.hypot(x - originX, y - originY) < ONE_FINGER_PAN_SLOP_PX) {
          return false;
        }
        engaged = true;
        // re-anchor at the moment of engagement so the page does not jump by
        // the slop distance
        originX = x;
        originY = y;
        // the lock may have been (re)installed between touch-down and here
        limits = readLimits(api);
        const appState = api.getAppState();
        desiredX = appState.scrollX;
        desiredY = appState.scrollY;
        options.onEngage?.();
        return true;
      }
      const zoom = api.getAppState().zoom.value;
      // 1:1 with the finger: the page sticks to the fingertip. (The editor's
      // two-finger pan uses a 2x multiplier; that is a centroid heuristic,
      // and applying it here would make the paper outrun the finger.)
      desiredX += (x - originX) / zoom;
      desiredY += (y - originY) / zoom;
      originX = x;
      originY = y;
      schedule(x, y);
      return true;
    },
    end: () => stop(true),
    cancel: () => stop(false),
    isPanning: () => engaged,
    destroy: () => {
      stop(false);
      cancelSpring();
    },
  };
};
