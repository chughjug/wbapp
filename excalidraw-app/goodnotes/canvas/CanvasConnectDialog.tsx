/**
 * The connect screen: Canvas address + access token.
 *
 * The warning panel is the first thing in the dialog, above the fields, and
 * is not collapsible. That is deliberate. A Canvas personal access token
 * **cannot be scoped to read-only** — it carries the full authority of the
 * account that made it, including the ability to submit work and change
 * grades where the account can. Telling a student that in a footnote under
 * the Connect button would be dishonest, so it is stated up front, next to
 * what we actually do with it and how to revoke it.
 *
 * Rendered into a portal on `document.body`. Mount it only while open so the
 * focus trap and focus restore stay simple.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BridgePairPanel } from "./bridge";
import { useCanvasConnection } from "./useCanvasConnection";

import "./canvas.scss";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ConnectTab = "bridge" | "token";

export interface CanvasConnectDialogProps {
  /** Called on Escape, backdrop click, Cancel, or Done. */
  onClose: () => void;
  /** Fired after Canvas accepts the token, with the account name. */
  onConnected?: (userName: string) => void;
  /** Fired after the stored token is forgotten. */
  onDisconnected?: () => void;
  theme?: "light" | "dark";
  /** Prefer laptop-extension pairing (default) or access-token form. */
  initialTab?: ConnectTab;
}

export const CanvasConnectDialog: React.FC<CanvasConnectDialogProps> = ({
  onClose,
  onConnected,
  onDisconnected,
  theme,
  initialTab = "bridge",
}) => {
  const { connection, isChecking, error, connect, disconnect, clearError } =
    useCanvasConnection();

  const [tab, setTab] = useState<ConnectTab>(initialTab);
  const [host, setHost] = useState(connection?.host ?? "");
  const [token, setToken] = useState("");
  const [successName, setSuccessName] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const titleId = useId();
  const warningId = useId();
  const hostId = useId();
  const hostHintId = useId();
  const tokenId = useId();
  const tokenHintId = useId();
  const errorId = useId();
  const statusId = useId();

  // --- focus: move in on mount, restore on unmount -------------------------
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(id);
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (successName) {
      doneButtonRef.current?.focus();
    }
  }, [successName]);

  // --- Escape + focus trap -------------------------------------------------
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSuccessName(null);
      const name = await connect(host, token);
      if (name) {
        setSuccessName(name);
        setToken("");
        onConnected?.(name);
      }
    },
    [connect, host, token, onConnected],
  );

  const onDisconnect = useCallback(() => {
    disconnect();
    setSuccessName(null);
    setToken("");
    onDisconnected?.();
  }, [disconnect, onDisconnected]);

  const describedBy =
    [error ? errorId : null, warningId, tokenHintId]
      .filter(Boolean)
      .join(" ") || undefined;

  return createPortal(
    <div
      // mirrors Excalidraw's own portal containers: the theme custom
      // properties are scoped to `.excalidraw`, so a portal outside the
      // editor needs these classes for light/dark to work at all.
      className={`excalidraw gn-canvas-backdrop${
        theme === "dark" ? " theme--dark" : ""
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="gn-canvas-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="gn-canvas-dialog__head">
          <h2 id={titleId} className="gn-canvas-dialog__title">
            Connect Canvas
          </h2>
          <button
            type="button"
            className="gn-canvas-iconbutton"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="gn-canvas-lede">
          Pull courses, deadlines and files onto this device. Prefer the laptop
          Chrome extension on iPad — no access token required.
        </p>

        <div
          className="gn-canvas-mode-tabs"
          role="tablist"
          aria-label="How to connect Canvas"
        >
          <button
            type="button"
            role="tab"
            id={`${titleId}-tab-bridge`}
            aria-selected={tab === "bridge"}
            className={`gn-canvas-mode-tab${
              tab === "bridge" ? " gn-canvas-mode-tab--active" : ""
            }`}
            onClick={() => setTab("bridge")}
          >
            Laptop extension
          </button>
          <button
            type="button"
            role="tab"
            id={`${titleId}-tab-token`}
            aria-selected={tab === "token"}
            className={`gn-canvas-mode-tab${
              tab === "token" ? " gn-canvas-mode-tab--active" : ""
            }`}
            onClick={() => setTab("token")}
          >
            Access token
          </button>
        </div>

        {tab === "bridge" ? (
          <>
            <BridgePairPanel
              onPaired={() => onConnected?.("Laptop bridge")}
              onSynced={() => onConnected?.("Laptop bridge")}
            />
            <div className="gn-canvas-actions">
              <span className="gn-canvas-actions__spacer" />
              <button
                type="button"
                className="gn-canvas-button gn-canvas-button--quiet"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            {/* The warning. Up front, not a footnote. */}
            <section
              id={warningId}
              className="gn-canvas-warning"
              aria-labelledby={`${warningId}-title`}
            >
              <h3
                id={`${warningId}-title`}
                className="gn-canvas-warning__title"
              >
                <span aria-hidden="true" className="gn-canvas-warning__glyph">
                  !
                </span>
                Read this before you paste a token
              </h3>
              <ul className="gn-canvas-warning__list">
                <li>
                  <strong>
                    A Canvas access token cannot be limited to read-only.
                  </strong>{" "}
                  Canvas offers no scopes for personal tokens, so the one you
                  paste carries the{" "}
                  <strong>full access of your Canvas account</strong> — anything
                  you can do in Canvas, that token can do.
                </li>
                <li>
                  <strong>It is stored in this browser</strong> (localStorage on
                  this device) and sent with each request to this app’s own
                  read-only relay. It is never sent anywhere else, and never to
                  a third party.
                </li>
                <li>
                  <strong>This app only reads</strong> your courses, assignments
                  and course files. It never submits work, posts, or changes
                  anything in Canvas.
                </li>
                <li>
                  <strong>You can revoke it at any time</strong> in Canvas under{" "}
                  <strong>Account → Settings → Approved Integrations</strong>.
                  Revoking takes effect immediately and breaks nothing here
                  except this connection.
                </li>
              </ul>
            </section>

            <form className="gn-canvas-form" onSubmit={onSubmit}>
              <div className="gn-canvas-field">
                <label htmlFor={hostId}>Canvas address</label>
                <input
                  ref={firstFieldRef}
                  id={hostId}
                  className="gn-canvas-input"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="your-school.instructure.com"
                  value={host}
                  onChange={(event) => {
                    setHost(event.target.value);
                    clearError();
                  }}
                  aria-describedby={
                    error ? `${hostHintId} ${errorId}` : hostHintId
                  }
                />
                <p id={hostHintId} className="gn-canvas-hint">
                  The host only — no https:// and no path.
                </p>
              </div>

              <div className="gn-canvas-field">
                <label htmlFor={tokenId}>Access token</label>
                <input
                  id={tokenId}
                  className="gn-canvas-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your Canvas access token"
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value);
                    clearError();
                  }}
                  aria-describedby={describedBy}
                />
                <p id={tokenHintId} className="gn-canvas-hint">
                  Create one in Canvas: <strong>Account → Settings</strong>,
                  scroll to <strong>Approved Integrations</strong>, then{" "}
                  <strong>+ New Access Token</strong>. The same page is where
                  you revoke it.
                </p>
              </div>

              {error ? (
                <p id={errorId} className="gn-canvas-alert" role="alert">
                  {error}
                </p>
              ) : null}

              {successName ? (
                <p className="gn-canvas-success" role="status">
                  Connected as <strong>{successName}</strong>.
                </p>
              ) : null}

              <div
                className="gn-canvas-status"
                aria-live="polite"
                id={statusId}
              >
                {isChecking ? "Checking with Canvas…" : ""}
              </div>

              <div className="gn-canvas-actions">
                {connection ? (
                  <button
                    type="button"
                    className="gn-canvas-button gn-canvas-button--quiet"
                    onClick={onDisconnect}
                  >
                    Disconnect
                  </button>
                ) : null}
                <span className="gn-canvas-actions__spacer" />
                <button
                  type="button"
                  className="gn-canvas-button gn-canvas-button--quiet"
                  onClick={onClose}
                >
                  {successName ? "Close" : "Cancel"}
                </button>
                {successName ? (
                  <button
                    ref={doneButtonRef}
                    type="button"
                    className="gn-canvas-button gn-canvas-button--primary"
                    onClick={onClose}
                  >
                    Done
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="gn-canvas-button gn-canvas-button--primary"
                    disabled={isChecking}
                  >
                    {isChecking ? "Checking…" : "Connect"}
                  </button>
                )}
              </div>
            </form>

            {connection && !successName ? (
              <p className="gn-canvas-foot">
                Currently connected to <strong>{connection.host}</strong>
                {connection.userName ? (
                  <>
                    {" "}
                    as <strong>{connection.userName}</strong>
                  </>
                ) : null}
                . Pasting a new token replaces it.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
