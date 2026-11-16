/**
 * Every tunable in the input layer, in one place.
 *
 * These numbers are the whole difference between "the app feels like
 * GoodNotes" and "the app fights me", so they are named, documented and
 * exported rather than buried in the recognisers. They were chosen against
 * the measurements in `INTEGRATION.md` (§ "Measured behaviour") and are safe
 * to re-tune without touching the recogniser code.
 */

// ---------------------------------------------------------------------------
// horizontal page swipe
// ---------------------------------------------------------------------------

/**
 * How many fingers a page swipe takes.
 *
 * Two, not one: a one-finger horizontal drag is a drawing stroke (or, with
 * the hand tool, a pan) and must stay that way.
 */
export const SWIPE_POINTER_COUNT = 2;

/** Minimum horizontal travel of the two-finger centroid, in CSS px. */
export const SWIPE_MIN_DISTANCE_PX = 90;

/**
 * `|dx|` must exceed this multiple of `|dy|`.
 *
 * This is the main guard against stealing a two-finger *pan*: a pan is
 * usually diagonal or vertical, a page flick is decisively sideways.
 */
export const SWIPE_HORIZONTAL_DOMINANCE = 2;

/**
 * Minimum terminal speed of the centroid, in CSS px per ms (≈ 450 px/s).
 *
 * A slow sideways drag is someone positioning the canvas and is left to the
 * editor's own pan; only a *flick* claims the gesture.
 */
export const SWIPE_MIN_VELOCITY_PX_PER_MS = 0.45;

/** Terminal speed is measured over this trailing slice of the gesture. */
export const SWIPE_VELOCITY_WINDOW_MS = 120;

/** A gesture longer than this is a pan/pinch, never a flick. */
export const SWIPE_MAX_DURATION_MS = 600;

/**
 * Maximum relative change of the distance between the two fingers.
 * Anything beyond this is a pinch-zoom, not a swipe.
 */
export const SWIPE_MAX_PINCH_RATIO = 0.25;

/** Ignore further swipes for this long after one is claimed (de-bounce). */
export const SWIPE_COOLDOWN_MS = 450;

/**
 * How the viewport frames the destination page **in continuous mode**.
 *
 * `"none"` keeps the current zoom — swiping to the next page while zoomed in
 * to write must not zoom back out. (`scrollToPage`'s own default is
 * `"scale-down"`, which is right for the page panel but wrong here.)
 *
 * In PAGED mode this constant is unused: the flick is handed to
 * `goodnotes/paged`'s controller, which always re-fits the destination page
 * to the workspace (that is the whole point of the mode).
 */
export const SWIPE_PAGE_FIT = "none" as const;

// ---------------------------------------------------------------------------
// palm rejection
// ---------------------------------------------------------------------------

/**
 * A stylus counts as "in use" for this long after the last pen event
 * (contact *or* hover). While it is in use, fingers may pan, pinch, scroll
 * and tap — but not draw.
 *
 * Long enough to cover pausing mid-sentence; short enough that putting the
 * pencil down and drawing with a finger starts working again by itself.
 */
export const PEN_ACTIVE_WINDOW_MS = 5000;

// ---------------------------------------------------------------------------
// multi-finger taps
// ---------------------------------------------------------------------------

/** Fingers must all be off the glass again within this long. */
export const TAP_MAX_DURATION_MS = 260;

/** No finger may travel further than this, or it is a drag, not a tap. */
export const TAP_MAX_MOVEMENT_PX = 18;

/** All fingers must land within this window of the first one. */
export const TAP_POINTER_JOIN_WINDOW_MS = 250;

/** Fingers for undo. */
export const UNDO_TAP_POINTERS = 2;

/** Fingers for redo. */
export const REDO_TAP_POINTERS = 3;

/** Ignore further taps for this long after one fires (de-bounce). */
export const TAP_COOLDOWN_MS = 220;

// ---------------------------------------------------------------------------
// stylus hover preview
// ---------------------------------------------------------------------------

/** Hide the hover dot when no hover event has arrived for this long. */
export const HOVER_PREVIEW_IDLE_HIDE_MS = 400;

/** Floor/ceiling for the hover dot's on-screen diameter, in CSS px. */
export const HOVER_PREVIEW_MIN_SIZE_PX = 6;
export const HOVER_PREVIEW_MAX_SIZE_PX = 64;
