/**
 * `<SyncPanel />` — the whole of sync's UI, in one mountable section.
 *
 * Signed out it is a sign-in / create-account form; signed in it is a status
 * line, a "Sync now" button, a sign-out button and any conflict notices.
 * Unconfigured it renders **nothing at all** (pass `showWhenUnconfigured` to
 * see the reason during setup), because an app with no Supabase project
 * should look exactly like an app that never had sync.
 *
 * It renders no modal and owns no layout: the host drops it into the
 * Settings screen (or anywhere else) and decides where it sits. It never
 * reaches into shell DOM.
 *
 * Accessibility notes that are load-bearing:
 *  - every control has a visible, associated label; the status line is an
 *    `aria-live="polite"` region that is present from first paint so its
 *    updates are announced rather than missed;
 *  - the status dot is decorative (`aria-hidden`) — the state is in the text,
 *    never in colour alone;
 *  - the pulse on the dot is switched off under `prefers-reduced-motion`.
 */

import { useCallback, useId, useState } from "react";

import { formatRelativeTime } from "./format";

import "./SyncPanel.scss";

import type { UseSyncResult } from "./useSync";

export interface SyncPanelProps {
  sync: UseSyncResult;
  theme?: "light" | "dark";
  /** Show the "not configured" explanation instead of rendering nothing. */
  showWhenUnconfigured?: boolean;
  /** Heading id to point `aria-labelledby` at, when the host renders one. */
  headingId?: string;
}

const phaseText = (
  sync: UseSyncResult,
): { label: string; detail: string | null } => {
  const { status } = sync;
  switch (status.phase) {
    case "disabled":
      return { label: "Sync is off for this app", detail: null };
    case "signed-out":
      return {
        label: "Not signed in",
        detail:
          status.pending > 0
            ? `${status.pending} ${
                status.pending === 1 ? "notebook is" : "notebooks are"
              } saved on this device only.`
            : "Notebooks are saved on this device only.",
      };
    case "syncing":
      return { label: "Syncing…", detail: null };
    case "offline":
      return {
        label: "Offline",
        detail: "Changes are saved here and will sync when you reconnect.",
      };
    case "error":
      return { label: "Sync had a problem", detail: status.error };
    case "idle":
    default:
      return {
        label:
          status.pending > 0
            ? `${status.pending} waiting to sync`
            : "Up to date",
        detail: status.lastSyncedAt
          ? `Last synced ${formatRelativeTime(status.lastSyncedAt)}.`
          : null,
      };
  }
};

export const SyncPanel = ({
  sync,
  theme = "light",
  showWhenUnconfigured = false,
  headingId,
}: SyncPanelProps) => {
  const { status } = sync;
  const emailId = useId();
  const passwordId = useId();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setNotice(null);
      try {
        if (mode === "sign-up") {
          const { needsConfirmation } = await sync.signUp(email, password);
          setNotice(
            needsConfirmation
              ? "Account created. Check your email for the confirmation link, then sign in."
              : "Account created — you're signed in.",
          );
        } else {
          await sync.signIn(email, password);
        }
        setPassword("");
      } catch {
        // the message is already in sync.authError and rendered below
      }
    },
    [email, mode, password, sync],
  );

  if (!status.configured && !showWhenUnconfigured) {
    return null;
  }

  const { label, detail } = phaseText(sync);

  return (
    <div
      className={`gn-sync gn-sync--${status.phase} ${
        theme === "dark" ? "theme--dark" : ""
      }`}
      aria-labelledby={headingId}
    >
      <p className="gn-sync__status" aria-live="polite">
        <span className="gn-sync__dot" aria-hidden="true" />
        <span>{label}</span>
        {detail ? <span className="gn-sync__dim">{detail}</span> : null}
      </p>

      {!status.configured ? (
        <p className="gn-sync__dim">
          {status.error ??
            "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to switch sync on. Everything else works without it."}
        </p>
      ) : null}

      {status.configured && !status.userId ? (
        <form className="gn-sync__form" onSubmit={submit}>
          <div className="gn-sync__field">
            <label className="gn-sync__label" htmlFor={emailId}>
              Email
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="gn-sync__field">
            <label className="gn-sync__label" htmlFor={passwordId}>
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="gn-sync__row">
            <button
              type="submit"
              className="gn-sync__primary"
              disabled={sync.busy}
            >
              {mode === "sign-up" ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              className="gn-sync__link"
              onClick={() => {
                sync.clearAuthError();
                setNotice(null);
                setMode(mode === "sign-up" ? "sign-in" : "sign-up");
              }}
            >
              {mode === "sign-up"
                ? "I already have an account"
                : "Create an account"}
            </button>
          </div>
        </form>
      ) : null}

      {status.userId ? (
        <div className="gn-sync__row">
          <span className="gn-sync__dim">Signed in as {status.email}</span>
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            disabled={sync.busy}
          >
            Sync now
          </button>
          <button type="button" onClick={() => void sync.signOut()}>
            Sign out
          </button>
        </div>
      ) : null}

      {sync.authError ? (
        <p className="gn-sync__error" role="alert">
          {sync.authError}
        </p>
      ) : null}

      {notice ? <p className="gn-sync__dim">{notice}</p> : null}

      {status.deferred.length > 0 ? (
        <p className="gn-sync__dim">
          {status.deferred.length === 1
            ? "A newer version of the notebook you have open is waiting. Close it to load it."
            : `${status.deferred.length} open notebooks have newer versions waiting. Close them to load.`}
        </p>
      ) : null}

      {status.conflicts.length > 0 ? (
        <ul className="gn-sync__conflicts">
          {status.conflicts.map((conflict) => (
            <li key={conflict.copyId}>
              Edited in two places. Your version is untouched; the version from{" "}
              {conflict.fromDevice} was saved as “{conflict.copyTitle}”.
            </li>
          ))}
          <li>
            <button
              type="button"
              className="gn-sync__link"
              onClick={sync.dismissConflicts}
            >
              Dismiss
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
};
