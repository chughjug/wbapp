/**
 * Freero-inspired version history + role controls, backed by the local Yjs
 * store. Additive chrome — safe to omit from the host.
 */

import React from "react";

import "./HistoryPanel.scss";

import type { CrdtRole, CrdtSnapshot } from "./docStore";

export interface HistoryPanelProps {
  ready: boolean;
  role: CrdtRole;
  snapshots: readonly CrdtSnapshot[];
  onRoleChange: (role: CrdtRole) => void;
  onSaveSnapshot: () => void;
  onRestoreSnapshot?: (snapshot: CrdtSnapshot) => void;
  theme?: "light" | "dark";
  className?: string;
}

const ROLES: CrdtRole[] = ["owner", "editor", "viewer"];

export const HistoryPanel = ({
  ready,
  role,
  snapshots,
  onRoleChange,
  onSaveSnapshot,
  onRestoreSnapshot,
  theme = "light",
  className,
}: HistoryPanelProps) => (
  <section
    className={`excalidraw${theme === "dark" ? " theme--dark" : ""} gn-history${
      className ? ` ${className}` : ""
    }`}
  >
    <header className="gn-history__head">
      <h2 className="gn-history__title">History &amp; access</h2>
      <p className="gn-history__muted">
        Local CRDT snapshots (Yjs + IndexedDB). Offline-safe; does not replace
        live collaboration.
      </p>
    </header>

    <div className="gn-history__row">
      <label className="gn-history__label" htmlFor="gn-history-role">
        Your role
      </label>
      <select
        id="gn-history-role"
        className="gn-history__select"
        value={role}
        disabled={!ready}
        onChange={(event) => onRoleChange(event.target.value as CrdtRole)}
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="gn-history__button"
        disabled={!ready || role === "viewer"}
        onClick={onSaveSnapshot}
      >
        Save version
      </button>
    </div>

    {!ready ? (
      <p className="gn-history__muted">Loading offline history…</p>
    ) : snapshots.length === 0 ? (
      <p className="gn-history__muted">No versions yet.</p>
    ) : (
      <ul className="gn-history__list">
        {snapshots.map((snap) => (
          <li key={snap.id} className="gn-history__item">
            <div className="gn-history__item-main">
              <span className="gn-history__item-label">{snap.label}</span>
              <span className="gn-history__muted">
                {new Date(snap.createdAt).toLocaleString()}
                {snap.author ? ` · ${snap.author}` : ""}
              </span>
            </div>
            {onRestoreSnapshot && (
              <button
                type="button"
                className="gn-history__button gn-history__button--quiet"
                disabled={role === "viewer"}
                onClick={() => onRestoreSnapshot(snap)}
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
    )}
  </section>
);
