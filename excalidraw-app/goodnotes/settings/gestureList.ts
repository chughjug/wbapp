/**
 * The gesture and keyboard-shortcut reference, as data.
 *
 * THE POINT OF THIS FILE: the app grew a set of gestures that a user will
 * discover by accident or not at all. A hard-coded list of prose would fix
 * that for exactly as long as it took someone to re-tune a threshold or add a
 * switch. So every gesture row here is built FROM `goodnotes/input`'s own
 * exported constants and settings model:
 *
 *  - the finger counts come from `UNDO_TAP_POINTERS`, `REDO_TAP_POINTERS` and
 *    `SWIPE_POINTER_COUNT`, so "two-finger tap" cannot silently become three;
 *  - each gesture names the `InputSettings` key that turns it off, and that
 *    key is typed as `keyof InputSettings`, so deleting or renaming a switch
 *    in `goodnotes/input` is a TYPE ERROR here rather than a stale sentence;
 *  - {@link GESTURE_SETTING_COVERAGE} asserts at module scope that every
 *    gesture-bearing switch has at least one documented row.
 *
 * What this cannot catch: a gesture added to `goodnotes/input` with no new
 * settings key, or a keyboard shortcut added anywhere else in the app. The
 * keyboard rows below are therefore transcribed by hand from the modules that
 * bind them, each with a `source` naming the file to check.
 */

import {
  DEFAULT_INPUT_SETTINGS,
  PEN_ACTIVE_WINDOW_MS,
  REDO_TAP_POINTERS,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_POINTER_COUNT,
  TAP_MAX_DURATION_MS,
  UNDO_TAP_POINTERS,
} from "../input";

import type { InputSettings } from "../input";

/** How many fingers, spelled the way a person reads it. */
const fingers = (count: number): string =>
  count === 1
    ? "One finger"
    : count === 2
    ? "Two fingers"
    : count === 3
    ? "Three fingers"
    : `${count} fingers`;

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10}s`;

export interface ReferenceEntry {
  /** Stable id (also the React key). */
  id: string;
  /** What the user does: "Two-finger tap", "Ctrl/Cmd + Z". */
  trigger: string;
  /** What happens. One sentence, no jargon. */
  effect: string;
  /**
   * The always-available equivalent. Every gesture in this app has one — that
   * is a design rule, and stating it here is what makes the gestures safe to
   * forget.
   */
  alsoBy?: string;
  /**
   * The `goodnotes/input` switch that turns this gesture off, when it has one.
   * Typed against the real settings model so it cannot rot.
   */
  setting?: keyof InputSettings;
}

export interface ReferenceGroup {
  id: string;
  title: string;
  /** Where the behaviour is implemented — a breadcrumb for the next maintainer. */
  source: string;
  entries: ReferenceEntry[];
}

/** Touch and stylus gestures, derived from `goodnotes/input`'s constants. */
export const GESTURE_GROUP: ReferenceGroup = {
  id: "gestures",
  title: "Touch and stylus gestures",
  source: "goodnotes/input",
  entries: [
    {
      id: "swipe-pages",
      trigger: `${fingers(SWIPE_POINTER_COUNT)}, flick sideways`,
      effect: `Turns to the previous or next page. The flick has to be quick and decisively sideways (at least ${SWIPE_MIN_DISTANCE_PX}px), so ordinary two-finger panning is untouched.`,
      alsoBy: "The page panel, the page controls, and PageUp / PageDown.",
      setting: "swipePages",
    },
    {
      id: "tap-undo",
      trigger: `${fingers(UNDO_TAP_POINTERS)}, tap`,
      effect: "Undo.",
      alsoBy: "Ctrl/Cmd + Z, and the undo button in the toolbar.",
      setting: "tapGestures",
    },
    {
      id: "tap-redo",
      trigger: `${fingers(REDO_TAP_POINTERS)}, tap`,
      effect: "Redo.",
      alsoBy: "Ctrl/Cmd + Shift + Z, and the redo button in the toolbar.",
      setting: "tapGestures",
    },
    {
      id: "palm",
      trigger: "Rest your hand on the page while writing",
      effect: `Nothing is drawn by the hand. Once the stylus has been used, fingers stop inking for ${seconds(
        PEN_ACTIVE_WINDOW_MS,
      )} after the last pen contact — they keep panning, pinching and tapping. Put the pencil down and fingers draw again.`,
      alsoBy: "Pencil-only drawing, below, makes this permanent.",
      setting: "palmRejection",
    },
    {
      id: "pencil-only",
      trigger: "Draw with a finger while pencil-only drawing is on",
      effect:
        "Nothing is drawn. Only the stylus ever inks; fingers always pan, pinch, scroll and tap.",
      alsoBy: "Turn it off in Pen & touch, above, to draw with a finger.",
      setting: "pencilOnly",
    },
    {
      id: "hover",
      trigger: "Hold the stylus just above the page",
      effect:
        "A nib-sized dot shows where the next stroke will land, on hardware that reports hover.",
      setting: "hoverPreview",
    },
    {
      id: "tap-active-tool",
      trigger: "Tap the tool you are already using",
      effect:
        "Opens that tool's settings — colour, width, opacity — as a band under the toolbar.",
      alsoBy: "The tool's own button menu.",
    },
    {
      id: "long-press-course",
      trigger: "Press and hold a course folder on the home screen",
      effect: "Opens its colour and emoji editor.",
      alsoBy: "The folder's ••• button.",
    },
    {
      id: "tap-max",
      trigger: "Taps have to be quick",
      effect: `A multi-finger tap only counts if every finger is off the glass within ${TAP_MAX_DURATION_MS}ms and barely moved. Anything slower is a pan, and is left alone.`,
    },
  ],
};

/** Keyboard shortcuts, transcribed from the modules that bind them. */
export const KEYBOARD_GROUPS: ReferenceGroup[] = [
  {
    id: "keys-editing",
    title: "Editing",
    source: "goodnotes/input, Excalidraw",
    entries: [
      { id: "undo", trigger: "Ctrl/Cmd + Z", effect: "Undo." },
      { id: "redo", trigger: "Ctrl/Cmd + Shift + Z", effect: "Redo." },
      {
        id: "copy",
        trigger: "Ctrl/Cmd + C / V / X",
        effect: "Copy, paste, cut.",
      },
      {
        id: "dup",
        trigger: "Ctrl/Cmd + D",
        effect: "Duplicate the selection.",
      },
      {
        id: "selectall",
        trigger: "Ctrl/Cmd + A",
        effect: "Select everything on the canvas.",
      },
      {
        id: "delete",
        trigger: "Delete / Backspace",
        effect: "Delete the selection.",
      },
      {
        id: "escape",
        trigger: "Escape",
        effect: "Close the open panel, menu or dialog; drop the selection.",
      },
    ],
  },
  {
    id: "keys-tools",
    title: "Tools",
    source: "goodnotes/shell (NavBar), goodnotes/pens",
    entries: [
      { id: "t-select", trigger: "V", effect: "Select tool." },
      { id: "t-pen", trigger: "P", effect: "Pen." },
      { id: "t-high", trigger: "H", effect: "Highlighter." },
      { id: "t-eraser", trigger: "E", effect: "Eraser." },
      { id: "t-text", trigger: "T", effect: "Text." },
      { id: "t-sticky", trigger: "N", effect: "Sticky note." },
      { id: "t-lasso", trigger: "Q", effect: "Lasso select." },
      {
        id: "t-pens",
        trigger: "1 – 9",
        effect:
          "Switch to that saved pen in the pen tray — colour, width and opacity in one key.",
        alsoBy: "Clicking the pen in the tray.",
      },
    ],
  },
  {
    id: "keys-pages",
    title: "Pages and view",
    source: "goodnotes/paged",
    entries: [
      { id: "p-next", trigger: "PageDown", effect: "Next page." },
      { id: "p-prev", trigger: "PageUp", effect: "Previous page." },
      { id: "p-home", trigger: "Home", effect: "First page." },
      { id: "p-end", trigger: "End", effect: "Last page." },
      {
        id: "p-arrows",
        trigger: "Arrow keys",
        effect:
          "Previous / next page — but only when nothing is selected, so arrows can still nudge an object.",
      },
      {
        id: "p-zoom",
        trigger: "Ctrl/Cmd + scroll, or pinch",
        effect:
          "Zoom. In paged view, zooming in past the page fit unlocks free panning inside that page.",
      },
    ],
  },
];

/** Every group, in display order. */
export const REFERENCE_GROUPS: ReferenceGroup[] = [
  GESTURE_GROUP,
  ...KEYBOARD_GROUPS,
];

/**
 * Drift guard, evaluated at module load.
 *
 * Maps each `InputSettings` key to the gesture rows that document it. A key
 * with no rows means `goodnotes/input` grew a switch the reference never
 * mentions — exactly the failure this whole section exists to prevent — and
 * {@link UNDOCUMENTED_GESTURE_SETTINGS} will be non-empty so the screen can
 * say so out loud instead of quietly lying.
 */
export const GESTURE_SETTING_COVERAGE: Record<keyof InputSettings, string[]> = (
  Object.keys(DEFAULT_INPUT_SETTINGS) as (keyof InputSettings)[]
).reduce((acc, key) => {
  acc[key] = GESTURE_GROUP.entries
    .filter((entry) => entry.setting === key)
    .map((entry) => entry.id);
  return acc;
}, {} as Record<keyof InputSettings, string[]>);

/** Switches in `goodnotes/input` that no reference row documents. */
export const UNDOCUMENTED_GESTURE_SETTINGS: (keyof InputSettings)[] = (
  Object.keys(GESTURE_SETTING_COVERAGE) as (keyof InputSettings)[]
).filter((key) => GESTURE_SETTING_COVERAGE[key].length === 0);
