/**
 * The single, quiet, dismissible invitation shown when Canvas is not
 * connected.
 *
 * Deliberately NOT a banner with a warning colour, NOT an empty-state
 * illustration where the deadlines would be, and NOT repeated anywhere else
 * on the screen. A student who will never connect Canvas should read one
 * sentence, dismiss it once, and never think about it again — the screen
 * behind it is already complete.
 */

import React from "react";

export interface ConnectInviteProps {
  /** Omitted: the invitation explains where to connect instead of offering
   *  a button that would go nowhere. */
  onConnect?: () => void;
  onDismiss: () => void;
}

export const ConnectInvite = ({ onConnect, onDismiss }: ConnectInviteProps) => (
  <aside className="gn-dash__invite" aria-label="Canvas">
    <p className="gn-dash__invite-text">
      Connect Canvas to see what is due at the top of this screen.{" "}
      {onConnect ? null : "You can do that later in Settings."}
    </p>
    <div className="gn-dash__invite-actions">
      {onConnect && (
        <button type="button" className="gn-dash__button" onClick={onConnect}>
          Connect Canvas
        </button>
      )}
      <button
        type="button"
        className="gn-dash__button gn-dash__button--quiet"
        onClick={onDismiss}
      >
        No thanks
      </button>
    </div>
  </aside>
);
