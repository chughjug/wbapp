/**
 * Persistence for the one thing the dashboard is allowed to nag about: the
 * "connect Canvas" invitation.
 *
 * Dismissal is permanent and stored locally. A user who has said no once has
 * answered the question; re-asking on the next launch is exactly the
 * behaviour this screen is supposed to avoid.
 */

const KEY = "goodnotes:dashboard:connect-invite-dismissed";

export const isConnectInviteDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export const dismissConnectInvite = (): void => {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the invitation simply comes back next launch */
  }
};

/** Test/host escape hatch: show the invitation again. */
export const resetConnectInvite = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to undo */
  }
};
