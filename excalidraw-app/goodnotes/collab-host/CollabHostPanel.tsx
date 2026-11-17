/**
 * Settings / share surface for self-hosted excalidraw-room + classroom codes.
 */

import React, { useMemo, useState } from "react";

import {
  formatClassroomRoomCode,
  getCollabHostStatus,
  makeClassroomRoomCode,
} from "./config";

import "./CollabHostPanel.scss";

export interface CollabHostPanelProps {
  theme?: "light" | "dark";
  className?: string;
  /** Optional: start Excalidraw live collab with the generated room hint. */
  onStartCollab?: (roomCode: string) => void;
}

export const CollabHostPanel = ({
  theme = "light",
  className,
  onStartCollab,
}: CollabHostPanelProps) => {
  const status = useMemo(() => getCollabHostStatus(), []);
  const [roomCode, setRoomCode] = useState(() => makeClassroomRoomCode());

  return (
    <section
      className={`excalidraw${
        theme === "dark" ? " theme--dark" : ""
      } gn-collab-host${className ? ` ${className}` : ""}`}
    >
      <h2 className="gn-collab-host__title">Live collaboration</h2>
      <p className="gn-collab-host__muted">{status.message}</p>

      <div className="gn-collab-host__row">
        <span className="gn-collab-host__label">Classroom code</span>
        <code className="gn-collab-host__code">
          {formatClassroomRoomCode(roomCode)}
        </code>
        <button
          type="button"
          className="gn-collab-host__button"
          onClick={() => setRoomCode(makeClassroomRoomCode())}
        >
          New code
        </button>
        {onStartCollab && (
          <button
            type="button"
            className="gn-collab-host__button gn-collab-host__button--primary"
            disabled={!status.configured}
            onClick={() => onStartCollab(roomCode)}
          >
            Start room
          </button>
        )}
      </div>
    </section>
  );
};
