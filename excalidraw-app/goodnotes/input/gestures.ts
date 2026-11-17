/**
 * The tablet input layer: palm rejection, pencil-only drawing, one-finger
 * panning, two-finger page flicks and multi-finger taps for undo/redo.
 *
 * FRAMEWORK-FREE ON PURPOSE. `useInputGestures` is a thin wrapper around
 * {@link attachInputGestures}; keeping the recogniser out of React means it
 * can be attached to a bare editor (and driven from a test harness) and that
 * pointer moves never cause a re-render.
 *
 * ── How it coexists with the editor ─────────────────────────────────────────
 * Every listener is **passive and capture-phase on `document`**; nothing is
 * `stopPropagation`-ed or `preventDefault`-ed. That is a deliberate
 * constraint, not laziness:
 *
 *  - Swallowing a touch `pointerdown` would also hide it from the editor's
 *    `gesture.pointers` map, which is what drives pinch-zoom and two-finger
 *    pan — palm rejection by event-blocking silently breaks panning.
 *  - The editor already has the correct rejection logic behind
 *    `appState.penMode` (`allowOnPointerDown` in `components/App.tsx`: with
 *    pen mode on, a `touch` pointer cannot start a drawing tool, but still
 *    selects, pans and pinches). So palm rejection here *drives that flag*
 *    rather than re-implementing it.
 *
 * ── What it claims ──────────────────────────────────────────────────────────
 * Gestures are resolved when the last finger lifts, never mid-gesture, so an
 * ambiguous drag stays with the editor. A claimed page flick corrects the
 * stray pan the editor did in the meantime by scrolling to the page.
 *
 * THE HAND TOOL is handled the same way: `handPan.ts` watches a hand drag
 * and, on release, turns the page when the viewport demonstrably could not
 * consume the travel. It writes nothing while the pointer is down, so the
 * editor's own hand pan stays the only thing moving the viewport.
 *
 * ONE-FINGER PANNING is the exception to "resolved on lift" — a pan has to
 * track the finger live. It stays within the same no-preventDefault rule by
 * only running in the states where the editor has already decided to ignore
 * the touch (pen mode + a drawing tool); see `pan.ts`. The moment a second
 * finger lands the pan bows out and the editor's pinch/pan takes over.
 */

import { getStrokeWidthByKey } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  getPageIndexAtSceneY,
  getPages,
  prefersReducedMotion,
  scrollToPage,
} from "../pages";
import { getActivePagedView, playPageTurnAnimation } from "../paged";

import {
  PEN_ACTIVE_WINDOW_MS,
  REDO_TAP_POINTERS,
  SWIPE_COOLDOWN_MS,
  SWIPE_HORIZONTAL_DOMINANCE,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MAX_PINCH_RATIO,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MIN_VELOCITY_PX_PER_MS,
  SWIPE_PAGE_FIT,
  SWIPE_POINTER_COUNT,
  SWIPE_VELOCITY_WINDOW_MS,
  TAP_COOLDOWN_MS,
  TAP_MAX_DURATION_MS,
  TAP_MAX_MOVEMENT_PX,
  TAP_POINTER_JOIN_WINDOW_MS,
  UNDO_TAP_POINTERS,
} from "./constants";
import { createChromeAutoHide } from "./chromeVisibility";
import { requestRedo, requestUndo } from "./history";
import { createHoverPreview } from "./hoverPreview";
import { createHandOverdrag } from "./handPan";
import { canOneFingerPan, createOneFingerPan } from "./pan";
import { DEFAULT_INPUT_SETTINGS } from "./settings";

import type { InputSettings } from "./settings";

/** Something the layer actually claimed, reported for UI/telemetry. */
export type InputGestureEvent =
  | { type: "swipe"; direction: -1 | 1; from: number; to: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "palm-rejection"; active: boolean }
  | { type: "one-finger-pan" }
  /** A hand-tool drag the page lock could not consume turned the page. */
  | { type: "hand-page-turn"; direction: -1 | 1; from: number; to: number };

/** What this device has turned out to be able to do. */
export interface InputCapabilities {
  /** A `pointerType: "pen"` event has been seen. */
  penSeen: boolean;
  /** A pen *hover* (pre-contact) event has been seen — see `hoverPreview.ts`. */
  penHoverSupported: boolean;
  /** A `pointerType: "touch"` event has been seen. */
  touchSeen: boolean;
  /** Palm rejection is currently suppressing finger ink. */
  rejectingTouch: boolean;
}

export interface AttachInputGesturesOptions {
  /** Read the live settings (so the host can change them without re-attaching). */
  getSettings?: () => InputSettings;
  /** Called whenever a gesture is claimed. */
  onGesture?: (event: InputGestureEvent) => void;
  /** Called when {@link InputCapabilities} change. */
  onCapabilities?: (capabilities: InputCapabilities) => void;
  /** Test seam. */
  document?: Document;
}

interface TrackedPointer {
  type: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  downAt: number;
  maxTravel: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  spread: number;
}

const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

const isInsideEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(".excalidraw");

const isOnCanvas = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(".excalidraw__canvas");

/**
 * Tools whose pointer-down starts a MARK — the thing auto-hide reacts to.
 *
 * `selection`, `hand`, `frame`, `laser` and friends are navigation, not
 * writing, so a drag with one of those leaves the chrome alone. `text` is
 * excluded on purpose: it opens a textarea, and a focused text field is one
 * of the states where hiding the chrome is forbidden.
 */
const MARK_TOOLS = new Set([
  "freedraw",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "diamond",
  "eraser",
  "image",
]);

/**
 * Attaches the input layer to a live editor.
 *
 * @returns a handle: `detach()` on unmount, `notifySettingsChanged()` when
 *   the settings object the host hands back from `getSettings` has changed
 *   (so "pencil only" can be applied without re-attaching).
 */
export interface InputGesturesHandle {
  /** Removes every listener and the hover overlay. */
  detach: () => void;
  /** Re-reads the settings and reconciles `appState.penMode`. */
  notifySettingsChanged: () => void;
}

export const attachInputGestures = (
  api: ExcalidrawImperativeAPI,
  options: AttachInputGesturesOptions = {},
): InputGesturesHandle => {
  const doc = options.document ?? document;
  const win = doc.defaultView ?? window;
  const getSettings = options.getSettings ?? (() => DEFAULT_INPUT_SETTINGS);
  const hover = createHoverPreview(doc);
  // the chrome recedes while a mark is being made; this module is where the
  // facts it needs (stylus down, palm rejected, gesture in flight) already are
  const chrome = createChromeAutoHide({
    document: doc,
    // Auto-hide removed: chrome (dock, tabs, …) stays visible while writing.
    isEnabled: () => false,
  });
  const pan = createOneFingerPan(api, {
    window: win,
    onEngage: () => options.onGesture?.({ type: "one-finger-pan" }),
  });
  // the hand tool's half of paged navigation: a drag the page lock could not
  // consume turns the page on release. Writes no viewport state, so it never
  // competes with the editor's own hand pan — see `handPan.ts`.
  const handOverdrag = createHandOverdrag(api, {
    isEnabled: () => getSettings().swipePages,
    onPageTurn: (direction, from, to) =>
      options.onGesture?.({ type: "hand-page-turn", direction, from, to }),
  });

  const pointers = new Map<number, TrackedPointer>();

  let lastPenActivityAt = -Infinity;
  /** true when *we* raised `appState.penMode` (so we may lower it again). */
  let penModeRaisedByUs = false;
  /**
   * The last value we asked the editor for. `updateScene` applies on the next
   * render, so `getAppState()` still reports the old value for a moment —
   * without this, a burst of pen events would queue the same update again and
   * again (and re-emit `palm-rejection`).
   */
  let penModeRequested: boolean | null = null;
  let penReleaseTimer: number | undefined;

  let lastSwipeAt = -Infinity;
  let lastTapAt = -Infinity;

  const capabilities: InputCapabilities = {
    penSeen: false,
    penHoverSupported: false,
    touchSeen: false,
    rejectingTouch: false,
  };

  // --- session -------------------------------------------------------------

  let session: {
    startedAt: number;
    lastDownAt: number;
    maxTouchPointers: number;
    sawPen: boolean;
    onCanvas: boolean;
    initialSpread: number;
    /** Furthest any finger of this session has travelled from where it landed. */
    maxTravel: number;
    samples: Sample[];
  } | null = null;

  const startSession = (now: number, onCanvas: boolean) => {
    session = {
      startedAt: now,
      lastDownAt: now,
      maxTouchPointers: 0,
      sawPen: false,
      onCanvas,
      initialSpread: 0,
      maxTravel: 0,
      samples: [],
    };
  };

  /**
   * Would this pointer-down actually put ink on the page? That is the whole
   * test for "a stroke began": the active tool has to be a mark-making one,
   * the pointer has to be on the canvas, and — for a finger — palm rejection
   * must not already be holding it off (`appState.penMode`, the editor's own
   * flag, which `syncPenMode` below drives).
   */
  const isMarkPointer = (event: PointerEvent): boolean => {
    if (api.isDestroyed || !isOnCanvas(event.target)) {
      return false;
    }
    const appState = api.getAppState();
    if (!MARK_TOOLS.has(appState.activeTool.type)) {
      return false;
    }
    if (event.pointerType === "touch" && appState.penMode) {
      return false;
    }
    return true;
  };

  // --- palm rejection ------------------------------------------------------

  const emitCapabilities = () => options.onCapabilities?.({ ...capabilities });

  const isPenActive = () =>
    performance.now() - lastPenActivityAt < PEN_ACTIVE_WINDOW_MS;

  /**
   * Reconciles `appState.penMode` with the settings and the pen's recency.
   *
   * `penMode` is the editor's own "fingers don't draw" switch; the editor
   * also raises it by itself the first time it sees a pen. We only ever lower
   * it again if this module was the one that raised it.
   */
  const syncPenMode = () => {
    if (api.isDestroyed) {
      return;
    }
    const settings = getSettings();
    const want =
      settings.pencilOnly || (settings.palmRejection && isPenActive());
    const current = api.getAppState().penMode;

    if (want === penModeRequested && want !== current) {
      // already asked for it; the editor just hasn't re-rendered yet
      return;
    }

    if (want === current) {
      penModeRequested = want;
      if (capabilities.rejectingTouch !== want) {
        capabilities.rejectingTouch = want;
        emitCapabilities();
      }
      return;
    }

    if (!want && !penModeRaisedByUs) {
      // the user (or the editor's own first-pen heuristic, before we were
      // attached) owns this flag — don't yank it from under them
      return;
    }

    api.updateScene({
      appState: want
        ? { penMode: true, penDetected: true }
        : { penMode: false, penDetected: true },
    });
    penModeRequested = want;
    penModeRaisedByUs = want;
    lastSeenPenMode = want;
    capabilities.rejectingTouch = want;
    options.onGesture?.({ type: "palm-rejection", active: want });
    emitCapabilities();
  };

  /**
   * The `penMode` value we last saw in the editor. Anything that moves the
   * flag without going through {@link syncPenMode} — most importantly the
   * app loading a document, which pushes a whole restored `appState` and
   * resets `penMode` to `false` — invalidates `penModeRequested`, which
   * otherwise reads "already asked for, just not rendered yet" forever and
   * silently leaves "pencil only" off for the rest of the session.
   */
  let lastSeenPenMode = api.isDestroyed ? false : api.getAppState().penMode;

  const onEditorChange = () => {
    if (api.isDestroyed) {
      return;
    }
    const current = api.getAppState().penMode;
    if (current !== lastSeenPenMode) {
      lastSeenPenMode = current;
      if (penModeRequested !== null && current !== penModeRequested) {
        penModeRequested = null;
      }
    }
    // cheap: a no-op write-free check unless the flag has actually drifted
    // away from what the settings ask for
    syncPenMode();
  };

  const notePenActivity = () => {
    lastPenActivityAt = performance.now();
    if (!capabilities.penSeen) {
      capabilities.penSeen = true;
      emitCapabilities();
    }
    syncPenMode();
    win.clearTimeout(penReleaseTimer);
    penReleaseTimer = win.setTimeout(syncPenMode, PEN_ACTIVE_WINDOW_MS + 50);
  };

  // --- page navigation -----------------------------------------------------

  const currentPageIndex = (): number => {
    const appState = api.getAppState();
    const sceneCentreY =
      appState.height / 2 / appState.zoom.value - appState.scrollY;
    return getPageIndexAtSceneY(getPages(api.getSceneElements()), sceneCentreY);
  };

  const flipPage = (direction: -1 | 1): boolean => {
    // PAGED VIEW OWNS THE VIEWPORT when it is on: ask it to turn the page, so
    // a flick lands exactly where the arrow keys and the page controls land
    // (animated, re-fitted, announced) instead of free-scrolling the canvas
    // out of the lock. `getActivePagedView()` is null in continuous mode and
    // before the editor has mounted, which falls through to the scroll below.
    const paged = getActivePagedView();
    if (paged) {
      const from = paged.getPageIndex();
      const moved =
        direction === 1
          ? paged.next({ animate: true, cause: "swipe" })
          : paged.prev({ animate: true, cause: "swipe" });
      if (moved) {
        playPageTurnAnimation(direction);
        options.onGesture?.({
          type: "swipe",
          direction,
          from,
          to: from + direction,
        });
      }
      return moved;
    }

    const from = currentPageIndex();
    if (from === -1) {
      return false;
    }
    const to = from + direction;
    const moved = scrollToPage(api, to, {
      fit: SWIPE_PAGE_FIT,
      animate: !prefersReducedMotion(),
    });
    if (moved) {
      playPageTurnAnimation(direction);
      options.onGesture?.({ type: "swipe", direction, from, to });
    }
    return moved;
  };

  // --- recognisers ---------------------------------------------------------

  const recogniseTap = (now: number): boolean => {
    const settings = getSettings();
    if (!settings.tapGestures || !session || session.sawPen) {
      return false;
    }
    if (now - lastTapAt < TAP_COOLDOWN_MS) {
      return false;
    }
    const fingers = session.maxTouchPointers;
    if (fingers !== UNDO_TAP_POINTERS && fingers !== REDO_TAP_POINTERS) {
      return false;
    }
    if (now - session.startedAt > TAP_MAX_DURATION_MS) {
      return false;
    }
    if (session.lastDownAt - session.startedAt > TAP_POINTER_JOIN_WINDOW_MS) {
      return false;
    }
    if (session.maxTravel > TAP_MAX_MOVEMENT_PX) {
      return false;
    }

    const ok =
      fingers === UNDO_TAP_POINTERS ? requestUndo(doc) : requestRedo(doc);
    if (!ok) {
      return false;
    }
    lastTapAt = now;
    options.onGesture?.({
      type: fingers === UNDO_TAP_POINTERS ? "undo" : "redo",
    });
    return true;
  };

  const canOneFingerPageSwipe = (): boolean => {
    if (!api || api.isDestroyed) {
      return false;
    }
    // one-finger flicks only when we are not mid-ink — otherwise a stroke
    // start would fight the page turn
    const type = api.getAppState().activeTool.type;
    return type === "hand" || type === "selection" || type === "lasso";
  };

  const recogniseSwipe = (now: number): boolean => {
    const settings = getSettings();
    if (!settings.swipePages || !session || session.sawPen) {
      return false;
    }
    if (!session.onCanvas) {
      return false;
    }
    if (now - lastSwipeAt < SWIPE_COOLDOWN_MS) {
      return false;
    }
    const fingers = session.maxTouchPointers;
    const allowOneFinger = fingers === 1 && canOneFingerPageSwipe();
    if (fingers !== SWIPE_POINTER_COUNT && !allowOneFinger) {
      return false;
    }
    const duration = now - session.startedAt;
    if (duration > SWIPE_MAX_DURATION_MS) {
      return false;
    }

    const samples = session.samples;
    if (samples.length < 2) {
      return false;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];

    const dx = last.x - first.x;
    const dy = last.y - first.y;

    if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) {
      return false;
    }
    if (Math.abs(dx) < SWIPE_HORIZONTAL_DOMINANCE * Math.abs(dy)) {
      return false;
    }
    // a pinch is not a swipe, however sideways it looks
    if (
      first.spread > 0 &&
      Math.abs(last.spread - first.spread) / first.spread >
        SWIPE_MAX_PINCH_RATIO
    ) {
      return false;
    }

    // terminal velocity over the trailing slice — a slow drag is a pan
    const windowStart =
      samples.find((sample) => last.t - sample.t <= SWIPE_VELOCITY_WINDOW_MS) ??
      first;
    const dt = Math.max(1, last.t - windowStart.t);
    const velocity = Math.abs(last.x - windowStart.x) / dt;
    if (velocity < SWIPE_MIN_VELOCITY_PX_PER_MS) {
      return false;
    }

    // swipe left (content pushed left) = next page, as when turning a page
    const direction: -1 | 1 = dx < 0 ? 1 : -1;
    if (!flipPage(direction)) {
      return false;
    }
    lastSwipeAt = now;
    return true;
  };

  const endSession = (now: number) => {
    if (!session) {
      return;
    }
    // taps first: a tap can never satisfy the swipe distance anyway
    if (!recogniseTap(now)) {
      recogniseSwipe(now);
    }
    session = null;
  };

  // --- listeners -----------------------------------------------------------

  const onPointerDown = (event: PointerEvent) => {
    if (!isInsideEditor(event.target)) {
      return;
    }
    const now = performance.now();

    // the hand tool is driven by every pointer type — mouse, stylus and
    // finger alike — so it is tracked ahead of the pen/touch split below
    handOverdrag.pointerDown(event);

    if (event.pointerType === "pen") {
      hover.hide();
      // the nib wins over a finger already on the glass: whatever that touch
      // was doing (a pan, a resting palm) stops here
      pan.cancel();
      notePenActivity();
      if (session) {
        session.sawPen = true;
      }
      if (isMarkPointer(event)) {
        chrome.strokeStart(event.pointerId, event.clientX, event.clientY);
      } else {
        chrome.reveal("pointer");
      }
      return;
    }
    if (event.pointerType !== "touch") {
      // mouse / trackpad: never a tablet gesture, and must not arm palm
      // rejection. It can still be drawing, though, and auto-hide is not a
      // tablet-only feature.
      if (isMarkPointer(event)) {
        chrome.strokeStart(event.pointerId, event.clientX, event.clientY);
      } else {
        chrome.reveal("pointer");
      }
      return;
    }
    if (!capabilities.touchSeen) {
      capabilities.touchSeen = true;
      emitCapabilities();
    }

    if (pointers.size === 0) {
      startSession(now, isOnCanvas(event.target));
    }
    pointers.set(event.pointerId, {
      type: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      downAt: now,
      maxTravel: 0,
    });

    if (pointers.size === 1) {
      // a lone finger may become a pan — decided here (pen mode, active
      // tool, settings), tracked from the first move past the slop
      if (
        getSettings().oneFingerPan &&
        isOnCanvas(event.target) &&
        canOneFingerPan(api.getAppState())
      ) {
        pan.start(event.clientX, event.clientY);
      }
      // a finger only marks the page when palm rejection is NOT holding it
      // off; otherwise it is panning or resting, and the chrome stays
      if (isMarkPointer(event)) {
        chrome.strokeStart(event.pointerId, event.clientX, event.clientY);
      } else {
        chrome.reveal("pointer");
      }
    } else {
      // a second finger: this is a pinch / two-finger pan / page flick, all
      // of which belong to the editor and to the recognisers below
      pan.cancel();
      chrome.gesture();
    }

    if (session) {
      session.lastDownAt = now;
      session.maxTouchPointers = Math.max(
        session.maxTouchPointers,
        pointers.size,
      );
      if (pointers.size === SWIPE_POINTER_COUNT) {
        // (re)start the centroid trace the moment the pair is complete
        session.samples = [];
        session.initialSpread = spreadOf();
        pushSample(now);
      }
    }
  };

  const spreadOf = (): number => {
    const list = [...pointers.values()];
    if (list.length < 2) {
      return 0;
    }
    return distance(list[0].x, list[0].y, list[1].x, list[1].y);
  };

  const pushSample = (t: number) => {
    if (!session || pointers.size !== SWIPE_POINTER_COUNT) {
      return;
    }
    const list = [...pointers.values()];
    session.samples.push({
      t,
      x: (list[0].x + list[1].x) / 2,
      y: (list[0].y + list[1].y) / 2,
      spread: spreadOf(),
    });
  };

  const onPointerMove = (event: PointerEvent) => {
    handOverdrag.pointerMove(event);
    if (event.pointerType === "pen") {
      if (event.buttons === 0 && isInsideEditor(event.target)) {
        // hovering, not touching
        noteHover(event);
      }
      notePenActivity();
      return;
    }

    const tracked = pointers.get(event.pointerId);
    if (!tracked) {
      return;
    }
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    tracked.maxTravel = Math.max(
      tracked.maxTravel,
      distance(tracked.startX, tracked.startY, tracked.x, tracked.y),
    );
    if (session) {
      session.maxTravel = Math.max(session.maxTravel, tracked.maxTravel);
    }
    if (pointers.size === 1) {
      pan.move(event.clientX, event.clientY);
    }
    pushSample(performance.now());
  };

  const noteHover = (event: PointerEvent) => {
    if (!capabilities.penHoverSupported) {
      capabilities.penHoverSupported = true;
      emitCapabilities();
    }
    if (!getSettings().hoverPreview || !isOnCanvas(event.target)) {
      hover.hide();
      return;
    }
    const appState = api.getAppState();
    const nibWidth = getStrokeWidthByKey(
      "freedraw",
      appState.currentItemStrokeWidthKey,
    );
    hover.show(
      event.clientX,
      event.clientY,
      nibWidth * appState.zoom.value * 2,
    );
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === "pen" && event.buttons === 0) {
      noteHover(event);
      notePenActivity();
    }
  };

  const onPointerOut = (event: PointerEvent) => {
    if (event.pointerType === "pen") {
      hover.hide();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    chrome.strokeEnd(event.pointerId, event.clientX, event.clientY);
    // resolved on release, like the flick and the taps — see `handPan.ts`.
    // This handler is bound to `pointercancel` too, and a cancelled gesture
    // must be abandoned, not interpreted.
    if (event.type === "pointerup") {
      handOverdrag.pointerUp(event);
    } else {
      handOverdrag.cancel();
    }
    if (event.pointerType === "pen") {
      notePenActivity();
      return;
    }
    if (!pointers.delete(event.pointerId)) {
      return;
    }
    if (pointers.size === 0) {
      pan.end();
      endSession(performance.now());
    }
  };

  const onBlur = () => {
    pointers.clear();
    session = null;
    pan.cancel();
    handOverdrag.cancel();
    hover.hide();
    // the window lost focus mid-stroke: never leave the chrome hidden
    chrome.reveal("host");
  };

  const unsubscribeChange = api.onChange(onEditorChange);

  const capture = { capture: true, passive: true } as const;
  doc.addEventListener("pointerdown", onPointerDown, capture);
  doc.addEventListener("pointermove", onPointerMove, capture);
  doc.addEventListener("pointerup", onPointerUp, capture);
  doc.addEventListener("pointercancel", onPointerUp, capture);
  doc.addEventListener("pointerover", onPointerOver, capture);
  doc.addEventListener("pointerout", onPointerOut, capture);
  win.addEventListener("blur", onBlur);

  // apply "pencil only" straight away, before any pen has been seen
  syncPenMode();

  return {
    notifySettingsChanged: () => {
      syncPenMode();
      chrome.notifySettingsChanged();
    },
    detach: () => {
      doc.removeEventListener("pointerdown", onPointerDown, capture);
      doc.removeEventListener("pointermove", onPointerMove, capture);
      doc.removeEventListener("pointerup", onPointerUp, capture);
      doc.removeEventListener("pointercancel", onPointerUp, capture);
      doc.removeEventListener("pointerover", onPointerOver, capture);
      doc.removeEventListener("pointerout", onPointerOut, capture);
      win.removeEventListener("blur", onBlur);
      unsubscribeChange();
      win.clearTimeout(penReleaseTimer);
      pan.destroy();
      handOverdrag.cancel();
      hover.destroy();
      chrome.detach();
    },
  };
};
