/**
 * `goodnotes/input` — making the editor feel right under an Apple Pencil.
 *
 * Four things live here, and nothing else:
 *
 * 1. **Palm rejection.** Once a stylus has been used in the last
 *    {@link PEN_ACTIVE_WINDOW_MS}, fingers stop inking; they keep panning,
 *    pinching, scrolling and tapping. Implemented by driving the editor's own
 *    `appState.penMode` (which already gates drawing tools for `touch`
 *    pointers) — *not* by swallowing pointer events, which would break
 *    pinch-zoom.
 * 2. **Pencil-only drawing.** The same switch, pinned on.
 * 3. **One-finger panning.** While the finger is not the drawing instrument
 *    (pen mode up, drawing tool active) a one-finger drag moves the page,
 *    1:1 with the finger and clamped to the page lock in paged mode. Before
 *    this, a finger in that state did *nothing at all* — it could not draw
 *    (palm rejection) and the editor only pans with two pointers.
 * 4. **Two-finger horizontal flick = previous/next page**, via
 *    `goodnotes/pages`' `scrollToPage`. Claimed only when the flick is fast
 *    and decisively sideways, so ordinary two-finger panning is untouched.
 *    The HAND TOOL has the same reach: a hand drag whose travel the paged
 *    viewport lock could not consume turns the page on release
 *    ({@link createHandOverdrag}). Both are governed by the one
 *    `swipePages` switch.
 * 5. **Auto-hiding chrome.** A stroke begins → the editor chrome fades out;
 *    a tap, a non-drawing pointer, a key press or focus brings it straight
 *    back. Exposed as a subscribable store ({@link subscribeChromeVisibility})
 *    plus one `data-gn-chrome` attribute on `<html>`, so the shell renders
 *    from state and this module never touches the shell's DOM. Default on,
 *    switchable in {@link InputSettingsPanel}, and it refuses to hide while a
 *    menu or dialog is open, while a text field has focus, or while the user
 *    is navigating by keyboard.
 * 6. **Two-finger tap = undo, three-finger tap = redo**, plus
 *    {@link requestUndo} / {@link requestRedo} for buttons — the imperative
 *    API exposes only `history.clear`, so these dispatch the editor's own
 *    Cmd/Ctrl+Z shortcut (see `history.ts` for why that is the supported
 *    route).
 *
 * Nothing here is the *only* way to do anything: pages are also in the page
 * panel, undo is also Cmd/Ctrl+Z, and every switch is a labelled checkbox in
 * {@link InputSettingsPanel}.
 *
 * ```tsx
 * const input = useInputGestures(excalidrawAPI);
 * // …somewhere in a menu/popover:
 * <InputSettingsPanel {...input.settingsPanelProps} />
 * // …and the nav bar's undo/redo buttons:
 * <button onClick={input.undo}>Undo</button>
 * ```
 *
 * See `INTEGRATION.md` in this folder for copy-pasteable `App.tsx` changes.
 */

/** React entry point: installs the layer on a live editor. */
export { useInputGestures } from "./useInputGestures";
export type {
  UseInputGesturesOptions,
  UseInputGesturesResult,
} from "./useInputGestures";

/**
 * One-finger panning, standalone: the rule that decides whether a lone
 * finger may move the page, for hosts that want to mirror it in their UI.
 */
export { canOneFingerPan, createOneFingerPan } from "./pan";
export type { OneFingerPanHandle } from "./pan";

/**
 * The hand tool's reconciliation with paged mode: a drag the page lock
 * refused turns the page. Writes no viewport state of its own — the editor
 * keeps doing the panning. See `handPan.ts` for the whole argument.
 */
export { createHandOverdrag, unconsumedTravel } from "./handPan";
export type { HandOverdragHandle, HandOverdragOptions } from "./handPan";

/** Framework-free entry point (same behaviour, no React). */
export { attachInputGestures } from "./gestures";
export type {
  AttachInputGesturesOptions,
  InputGesturesHandle,
  InputGestureEvent,
  InputCapabilities,
} from "./gestures";

/**
 * Working undo/redo for app-level buttons. `excalidrawAPI.history` only has
 * `clear`; these dispatch the editor's own keyboard shortcut.
 */
export { requestUndo, requestRedo } from "./history";

/** The settings UI — labelled checkboxes, keyboard reachable. */
export { InputSettingsPanel } from "./InputSettingsPanel";
export type { InputSettingsPanelProps } from "./InputSettingsPanel";

/** Settings model: read/write/subscribe without React. */
export {
  DEFAULT_INPUT_SETTINGS,
  INPUT_SETTINGS_STORAGE_KEY,
  loadInputSettings,
  saveInputSettings,
  subscribeInputSettings,
  resetInputSettingsCache,
} from "./settings";
export type { InputSettings } from "./settings";

/** Every threshold, named and documented. Re-tune here. */
export {
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
  ONE_FINGER_PAN_SLOP_PX,
  OVERSCROLL_MAX_PX,
  OVERSCROLL_SPRING_MS,
  HAND_PAGE_TURN_PX,
  HAND_PAGE_TURN_DOMINANCE,
  HAND_PAGE_TURN_COOLDOWN_MS,
  TAP_COOLDOWN_MS,
  TAP_MAX_DURATION_MS,
  TAP_MAX_MOVEMENT_PX,
  TAP_POINTER_JOIN_WINDOW_MS,
  UNDO_TAP_POINTERS,
  HOVER_PREVIEW_IDLE_HIDE_MS,
  HOVER_PREVIEW_MIN_SIZE_PX,
  HOVER_PREVIEW_MAX_SIZE_PX,
} from "./constants";
