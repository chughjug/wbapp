/**
 * Remembering that this device has a stylus.
 *
 * Opening a notebook with the Pen already selected is obviously right on a
 * tablet with a stylus and obviously wrong on a phone: there, a one-finger
 * drag IS a drawing stroke, and palm rejection only suppresses fingers
 * *while a stylus is in use* — so Pen-by-default would have phone users
 * drawing a line every time they tried to scroll. That is why this app has
 * always opened on the selection tool, and why "just default to Pen" was
 * turned down earlier in this build.
 *
 * The distinction that makes it safe is not the screen size or the user
 * agent — both lie, and a tablet with a stylus in the bag is the same
 * device as a tablet without one. It is whether a `pointerType: "pen"`
 * event has ever actually arrived. `InputCapabilities.penSeen` already
 * tracks that, but only for the current session: it is false at mount,
 * which is exactly when the default tool is chosen, so on its own it can
 * never influence that decision.
 *
 * So the fact is persisted. The first stroke a student makes with a stylus
 * is a one-off cost; from then on every notebook opens ready to write.
 *
 * Deliberately sticky and deliberately per-device:
 *
 * - **Never unset by a touch event.** Someone who owns a stylus still uses
 *   a finger sometimes, and flipping the default back and forth depending
 *   on what they last touched the glass with would make the tool on open
 *   unpredictable — far worse than either default on its own.
 * - **`localStorage`, not synced metadata.** A phone and a tablet signed
 *   into the same account need different answers, and this is a property
 *   of the hardware in your hand, not of your account.
 */

/** Storage key. Versioned, so the meaning can change without misreading. */
export const STYLUS_SEEN_KEY = "goodnotes:stylus-seen:v1";

/**
 * Has a stylus ever been used on this device?
 *
 * Returns false when storage is unavailable (private browsing, a locked-
 * down embed), which is the safe answer: the selection tool is usable with
 * every input, and the Pen is not.
 */
export const hasSeenStylus = (storage?: Storage): boolean => {
  try {
    const store = storage ?? window.localStorage;
    return store.getItem(STYLUS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Record that a stylus has been used here.
 *
 * Idempotent and cheap to call from a pointer handler: it reads before it
 * writes, so the common case (already recorded) does no write at all.
 */
export const rememberStylusSeen = (storage?: Storage): void => {
  try {
    const store = storage ?? window.localStorage;
    if (store.getItem(STYLUS_SEEN_KEY) !== "1") {
      store.setItem(STYLUS_SEEN_KEY, "1");
    }
  } catch {
    // a device that cannot remember simply keeps opening on selection
  }
};

/** Forget it again — the settings screen's escape hatch, and for tests. */
export const forgetStylusSeen = (storage?: Storage): void => {
  try {
    (storage ?? window.localStorage).removeItem(STYLUS_SEEN_KEY);
  } catch {
    // nothing to forget
  }
};

/**
 * The tool a document should open with.
 *
 * `"freedraw"` once a stylus has been seen on this device, `"selection"`
 * otherwise. Separated from the storage above so the rule itself can be
 * asserted without touching `localStorage`.
 */
export const defaultToolForDevice = (
  stylusSeen: boolean,
): "freedraw" | "selection" => (stylusSeen ? "freedraw" : "selection");
