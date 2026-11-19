/**
 * The recording and playback bar.
 *
 * Three states, one strip, deliberately never more than one row tall on a
 * phone:
 *
 *   idle      [ ● Record ]  [ ▸ 12 Nov, 14:02 · 48:11 ]
 *   recording [ ■ Stop ] [ ‖ ] 04:17 ●
 *   playing   [ ▸/‖ ] ——●——————— 04:17 / 48:11 [ × ]
 *
 * Anchored bottom-centre rather than in the toolbar, because during a
 * lecture the recording timer is the one piece of chrome that has to be
 * glanceable while writing, and the bottom of the screen is where a hand
 * resting on a tablet is not covering it.
 *
 * `aria-live="polite"` on the elapsed timer would announce every second,
 * so the live region carries state changes only ("Recording", "Paused")
 * and the timer itself is a plain readout a screen reader reaches on
 * demand.
 */

import React, { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";

import { formatTimecode } from "./marks";

import "./AudioBar.scss";

import type { AudioPhase } from "./useAudio";
import type { RecordingSummary } from "./store";

export interface AudioBarProps {
  phase: AudioPhase;
  elapsedMs: number;
  error: string | null;
  onClearError: () => void;

  recordings: readonly RecordingSummary[];
  playingId: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;

  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;

  onOpen: (id: string) => void;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  onClose: () => void;
  onDelete: (id: string) => void;

  /** Hide the whole thing (e.g. while presenting). */
  hidden?: boolean;
  theme?: "light" | "dark";
}

export const AudioBar: React.FC<AudioBarProps> = ({
  phase,
  elapsedMs,
  error,
  onClearError,
  recordings,
  playingId,
  isPlaying,
  positionMs,
  durationMs,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpen,
  onTogglePlay,
  onSeek,
  onClose,
  onDelete,
  hidden,
  theme,
}) => {
  const statusId = useId();
  const [listOpen, setListOpen] = useState(false);

  const recording = phase === "recording" || phase === "paused";
  const playing = playingId !== null;

  const onScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onSeek(Number(event.target.value));
    },
    [onSeek],
  );

  if (hidden) {
    return null;
  }

  // Nothing recorded, nothing recording, and no list worth opening: one
  // button. A bar full of transport controls for audio that does not
  // exist is the kind of chrome this app keeps removing.
  const idleAndEmpty = !recording && !playing && recordings.length === 0;

  const bar = (
    <div
      className={`gn-audio excalidraw${theme === "dark" ? " theme--dark" : ""}`}
    >
      {error && (
        <div className="gn-audio__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onClearError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <p className="gn-audio__sr" id={statusId} aria-live="polite">
        {phase === "recording"
          ? "Recording"
          : phase === "paused"
          ? "Recording paused"
          : ""}
      </p>

      <div className="gn-audio__bar">
        {!recording && (
          <button
            type="button"
            className="gn-audio__record"
            onClick={onStart}
            aria-describedby={statusId}
          >
            <span className="gn-audio__dot" aria-hidden="true" />
            Record
          </button>
        )}

        {recording && (
          <>
            <button
              type="button"
              className="gn-audio__stop"
              onClick={onStop}
              aria-label="Stop recording and save it"
            >
              <span className="gn-audio__square" aria-hidden="true" />
              Stop
            </button>
            <button
              type="button"
              className="gn-audio__ghost"
              onClick={phase === "paused" ? onResume : onPause}
              aria-label={
                phase === "paused" ? "Resume recording" : "Pause recording"
              }
            >
              {phase === "paused" ? "Resume" : "Pause"}
            </button>
            <span
              className={`gn-audio__time${
                phase === "recording" ? " gn-audio__time--live" : ""
              }`}
            >
              {formatTimecode(elapsedMs)}
            </span>
          </>
        )}

        {playing && !recording && (
          <>
            <button
              type="button"
              className="gn-audio__play"
              onClick={onTogglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "❙❙" : "▶"}
            </button>
            <input
              className="gn-audio__scrub"
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={Math.min(positionMs, durationMs)}
              onChange={onScrub}
              aria-label="Position in the recording"
              aria-valuetext={`${formatTimecode(
                positionMs,
              )} of ${formatTimecode(durationMs)}`}
            />
            <span className="gn-audio__time">
              {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
            </span>
            <button
              type="button"
              className="gn-audio__ghost"
              onClick={onClose}
              aria-label="Close the recording"
            >
              ×
            </button>
          </>
        )}

        {!idleAndEmpty && !recording && !playing && (
          <button
            type="button"
            className="gn-audio__ghost"
            aria-expanded={listOpen}
            onClick={() => setListOpen((open) => !open)}
          >
            {recordings.length} recording{recordings.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {listOpen && !recording && (
        <ul className="gn-audio__list">
          {recordings.map((item) => (
            <li key={item.id} className="gn-audio__item">
              <button
                type="button"
                className="gn-audio__item-open"
                onClick={() => {
                  onOpen(item.id);
                  setListOpen(false);
                }}
              >
                <span className="gn-audio__item-label">{item.label}</span>
                <span className="gn-audio__item-meta">
                  {formatTimecode(item.durationMs)}
                  {item.marks.length > 0
                    ? ` · ${item.marks.length} notes linked`
                    : ""}
                </span>
              </button>
              <button
                type="button"
                className="gn-audio__ghost"
                onClick={() => onDelete(item.id)}
                aria-label={`Delete the recording ${item.label}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {playing && (
        <p className="gn-audio__hint">
          Tap anything you wrote during this recording to jump to that moment.
        </p>
      )}
    </div>
  );

  // Portalled to the body like the other overlays. `position: fixed` is
  // relative to the nearest ancestor with a transform, filter or
  // backdrop-filter rather than to the viewport, and the editor shell has
  // several — rendered in place, the bar landed at the top of the window
  // across the tab strip instead of above the home indicator.
  return createPortal(bar, document.body);
};
