/**
 * <GesturesFirstRunHint /> — the one-time nudge.
 *
 * A single quiet line in the corner, shown once ever, saying that the app has
 * gestures and where to read about them. Two buttons: open the reference, or
 * dismiss. Opening the Settings screen also dismisses it, so a user who finds
 * the screen by themselves never sees the hint again either.
 *
 * It is `role="status"` rather than `role="alert"`: it is not urgent, it must
 * not steal focus, and it must not interrupt whatever is being announced when
 * it appears. Keyboard users reach its buttons in the normal tab order.
 *
 * Deliberately not a tour, not a spotlight, not a multi-step overlay.
 */

import { useEffect, useState } from "react";

import {
  dismissGesturesHint,
  isGesturesHintDismissed,
  subscribeGesturesHint,
} from "./firstRun";

import "./SettingsScreen.scss";

export interface GesturesFirstRunHintProps {
  /**
   * Open the Settings screen at the gestures section. The hint dismisses
   * itself first, so this never needs to.
   */
  onOpenGestures: () => void;
  theme?: "light" | "dark";
  /**
   * Wait this long after mount before appearing, so it does not compete with
   * the editor's own first paint. Defaults to 1200ms; pass 0 in tests.
   */
  delayMs?: number;
  className?: string;
}

export const GesturesFirstRunHint = ({
  onOpenGestures,
  theme = "light",
  delayMs = 1200,
  className,
}: GesturesFirstRunHintProps) => {
  const [dismissed, setDismissed] = useState(isGesturesHintDismissed);
  const [ready, setReady] = useState(delayMs === 0);

  useEffect(() => subscribeGesturesHint(setDismissed), []);

  useEffect(() => {
    if (ready) {
      return;
    }
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [ready, delayMs]);

  if (dismissed || !ready) {
    return null;
  }

  return (
    <div
      // NB: no `excalidraw` class on the positioned root. That class is a
      // full-size flex container, and it overrode this toast's fixed
      // positioning — it rendered as an opaque full-height panel over the
      // left third of the canvas, swallowing pen strokes. The editor's
      // colour tokens are pulled in by the stylesheet instead.
      className={`gn-settings-hint${theme === "dark" ? " theme--dark" : ""}${
        className ? ` ${className}` : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <p>
        This app has a few gestures — two fingers to turn the page, two-finger
        tap to undo. They are all listed in Settings.
      </p>
      <button
        type="button"
        className="gn-settings-button is-primary"
        onClick={() => {
          dismissGesturesHint();
          onOpenGestures();
        }}
      >
        Show me
      </button>
      <button
        type="button"
        className="gn-settings-button"
        onClick={() => dismissGesturesHint()}
      >
        Dismiss
      </button>
    </div>
  );
};
