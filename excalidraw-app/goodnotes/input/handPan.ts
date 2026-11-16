/**
 * The hand tool, reconciled with the paged viewport lock.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 * Excalidraw's hand tool (`appState.activeTool.type === "hand"`) is fully
 * implemented: `AppPan.start` turns a one-pointer drag into
 * `AppViewport.translate()`, which applies `appState.scrollConstraints`. In
 * paged mode that clamp is what pins one page to the workspace — and at the
 * FIT zoom the page box is smaller than the viewport, so the clamp has
 * nowhere to move the viewport to. Measured in the running app before this
 * module existed: a wheel, a space-drag and a hand-tool drag all left
 * `scrollX / scrollY` at `378.07 / 21.07`, i.e. 0.00 px of movement. The
 * hand tool was a dead control, and was correctly left out of the bar.
 *
 * Two changes bring it back, and they are deliberately split:
 *
 * 1. **Inside the page** — `goodnotes/paged` now installs the lock with
 *    `overscroll: PAGED_VIEW_OVERSCROLL_PX` instead of `false`. The editor's
 *    own rubberband then gives a hand drag ~28 CSS px of live, damped travel
 *    at fit zoom and springs it back on release, and zoomed in past the fit
 *    the clamp already permitted free panning within the page. No code here
 *    is involved in either case: the editor does all of it.
 * 2. **Between pages** — this module. A hand drag whose travel the viewport
 *    could NOT consume (because the clamp refused it) is an attempt to go
 *    somewhere the current page does not reach. Past
 *    {@link HAND_PAGE_TURN_PX} of such unconsumed travel, releasing turns the
 *    page through `goodnotes/paged`'s controller — the same animated, re-
 *    fitted, announced transition the two-finger flick and the page panel
 *    use.
 *
 * ── Why it cannot fight the editor ─────────────────────────────────────────
 * It writes NOTHING to the viewport while the pointer is down. Every
 * listener is passive and capture-phase on `document`; the editor's own pan
 * session runs untouched and remains the only thing moving the viewport
 * during the drag. The gesture is resolved on *release*, which is the same
 * contract the flick and tap recognisers in `gestures.ts` already hold — an
 * ambiguous drag simply stays with the editor.
 *
 * "Unconsumed" is measured, not assumed: it is the pointer's travel minus
 * the travel the viewport actually performed (`Δscroll × zoom`). So while
 * there is anywhere left to pan — zoomed in, mid-page — the figure stays at
 * zero and no page turn can fire, however far the user drags. It only grows
 * once the page has genuinely run out, which is exactly when "go to the next
 * page" is the right reading of the gesture.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getActivePagedView } from "../paged";

import {
  HAND_PAGE_TURN_COOLDOWN_MS,
  HAND_PAGE_TURN_DOMINANCE,
  HAND_PAGE_TURN_PX,
} from "./constants";

export interface HandOverdragOptions {
  /** Is the gesture switched on? Mirrors the page-flick setting. */
  isEnabled?: () => boolean;
  /** Fired when a page turn is claimed. `direction` is +1 next, -1 previous. */
  onPageTurn?: (direction: -1 | 1, from: number, to: number) => void;
}

export interface HandOverdragHandle {
  /** A pointer landed. Safe to call for every pointer. */
  pointerDown: (event: PointerEvent) => void;
  /** A pointer moved. */
  pointerMove: (event: PointerEvent) => void;
  /** A pointer lifted — where the gesture is resolved. */
  pointerUp: (event: PointerEvent) => void;
  /** Abandon the session without resolving (second finger, blur, cancel). */
  cancel: () => void;
  /** True while a hand drag is being tracked. */
  isTracking: () => boolean;
}

interface Session {
  pointerId: number;
  /** Where the pointer landed, in client px. */
  startX: number;
  startY: number;
  /** The viewport when it landed. */
  startScrollX: number;
  startScrollY: number;
  /** Furthest the pointer has been from where it landed, in client px. */
  maxTravel: number;
  x: number;
  y: number;
}

const isOnCanvas = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(".excalidraw__canvas");

/**
 * Travel the pointer asked for that the viewport could not deliver, in CSS
 * px. Exported because it is the whole idea and deserves to be assertable.
 *
 * `scroll` is in SCENE units, so the delta is multiplied by the zoom to get
 * back to the screen px the finger moved through. The editor's rubberband
 * counts as consumed travel while it is held, which is right: those pixels
 * did move on screen.
 */
export const unconsumedTravel = (
  pointerDelta: number,
  scrollDelta: number,
  zoom: number,
): number => pointerDelta - scrollDelta * zoom;

export const createHandOverdrag = (
  api: ExcalidrawImperativeAPI,
  options: HandOverdragOptions = {},
): HandOverdragHandle => {
  const isEnabled = options.isEnabled ?? (() => true);

  let session: Session | null = null;
  /** Pointer ids currently down, so a second finger can bow out. */
  const down = new Set<number>();
  let lastTurnAt = -Infinity;

  const isHandDrag = (event: PointerEvent): boolean => {
    if (api.isDestroyed || !isEnabled() || !isOnCanvas(event.target)) {
      return false;
    }
    // secondary/middle buttons are the editor's own pan and context menu
    if (event.button !== 0 && event.button !== -1) {
      return false;
    }
    return api.getAppState().activeTool.type === "hand";
  };

  const cancel = () => {
    session = null;
  };

  return {
    pointerDown: (event) => {
      down.add(event.pointerId);
      if (down.size > 1) {
        // a pinch / two-finger pan: the editor owns it outright
        cancel();
        return;
      }
      if (!isHandDrag(event)) {
        return;
      }
      const appState = api.getAppState();
      session = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollX: appState.scrollX,
        startScrollY: appState.scrollY,
        maxTravel: 0,
        x: event.clientX,
        y: event.clientY,
      };
    },

    pointerMove: (event) => {
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      session.x = event.clientX;
      session.y = event.clientY;
      session.maxTravel = Math.max(
        session.maxTravel,
        Math.hypot(
          event.clientX - session.startX,
          event.clientY - session.startY,
        ),
      );
    },

    pointerUp: (event) => {
      down.delete(event.pointerId);
      const current = session;
      if (!current || event.pointerId !== current.pointerId) {
        if (down.size === 0) {
          cancel();
        }
        return;
      }
      session = null;
      if (api.isDestroyed) {
        return;
      }

      const paged = getActivePagedView();
      if (!paged) {
        // continuous / whiteboard: nothing is clamped, so there is no
        // unconsumed travel to interpret and no page to turn to
        return;
      }

      const now = performance.now();
      if (now - lastTurnAt < HAND_PAGE_TURN_COOLDOWN_MS) {
        return;
      }

      const appState = api.getAppState();
      const zoom = appState.zoom.value;
      const dx = current.x - current.startX;
      const dy = current.y - current.startY;
      const overdragX = unconsumedTravel(
        dx,
        appState.scrollX - current.startScrollX,
        zoom,
      );
      const overdragY = unconsumedTravel(
        dy,
        appState.scrollY - current.startScrollY,
        zoom,
      );

      // pages stack vertically, so only a vertical overdrag means "the next
      // page"; a sideways one is someone bumping the edge of a zoomed page
      if (
        Math.abs(overdragY) < HAND_PAGE_TURN_PX ||
        Math.abs(overdragY) < Math.abs(overdragX) * HAND_PAGE_TURN_DOMINANCE
      ) {
        return;
      }

      // dragging the paper UP pulls the next page into view, the way a
      // scroll does; dragging it DOWN reaches back for the previous one
      const direction: -1 | 1 = overdragY < 0 ? 1 : -1;
      const from = paged.getPageIndex();
      const moved =
        direction === 1
          ? paged.next({ animate: true, cause: "swipe" })
          : paged.prev({ animate: true, cause: "swipe" });
      if (moved) {
        lastTurnAt = now;
        options.onPageTurn?.(direction, from, from + direction);
      }
    },

    cancel: () => {
      down.clear();
      cancel();
    },

    isTracking: () => session !== null,
  };
};
