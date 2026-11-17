/**
 * The settings surface for the tablet input layer.
 *
 * Plain, labelled form controls on purpose: every switch is a real
 * `<input type="checkbox">` with a `<label>`, a `<fieldset>`/`<legend>`
 * grouping and an `aria-describedby` hint, so it is reachable and
 * understandable by keyboard and screen reader. Gestures are never the only
 * route to anything they do, and the panel says so.
 */

import React, { useId } from "react";

import "./InputSettingsPanel.scss";

import type { InputCapabilities } from "./gestures";
import type { InputSettings } from "./settings";

export interface InputSettingsPanelProps {
  settings: InputSettings;
  /** From `useInputGestures` — drives the "what this device can do" readout. */
  capabilities?: InputCapabilities;
  onChange: <K extends keyof InputSettings>(
    key: K,
    value: InputSettings[K],
  ) => void;
  /** Extra class on the root (e.g. to place it inside a popover). */
  className?: string;
  /** Adds the editor's `theme--dark` scope class. Defaults to `"light"`. */
  theme?: "light" | "dark";
}

interface Row {
  key: keyof InputSettings;
  label: string;
  hint: string;
}

const ROWS: Row[] = [
  {
    key: "palmRejection",
    label: "Palm rejection",
    hint: "While the stylus is in use, your hand can rest on the screen without drawing. Fingers still pan, pinch and tap.",
  },
  {
    key: "pencilOnly",
    label: "Pencil-only drawing",
    hint: "Only the stylus ever draws, even when it has been put down.",
  },
  {
    key: "oneFingerPan",
    label: "Drag the page with one finger",
    hint: "While the stylus is in use (or pencil-only is on), a one-finger drag moves the page. Two fingers always pan and pinch.",
  },
  {
    key: "swipePages",
    label: "Swipe between pages",
    hint: "Flick sideways with two fingers for the previous or next page. The page panel does the same thing.",
  },
  {
    key: "tapGestures",
    label: "Tap to undo and redo",
    hint: "Two-finger tap undoes, three-finger tap redoes. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z keep working.",
  },
  {
    key: "hoverPreview",
    label: "Stylus hover preview",
    hint: "Shows where the nib will land while the stylus hovers — only on hardware that reports hover.",
  },
];

export const InputSettingsPanel: React.FC<InputSettingsPanelProps> = ({
  settings,
  capabilities,
  onChange,
  className,
  theme = "light",
}) => {
  const idPrefix = useId();

  return (
    <section
      className={`excalidraw gn-input-settings${
        theme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      aria-labelledby={`${idPrefix}-title`}
    >
      <h2 className="gn-input-settings__title" id={`${idPrefix}-title`}>
        Pen &amp; touch
      </h2>

      <fieldset className="gn-input-settings__group">
        <legend className="gn-input-settings__legend">Input gestures</legend>

        {ROWS.map((row) => {
          const inputId = `${idPrefix}-${row.key}`;
          const hintId = `${inputId}-hint`;
          const disabled = row.key === "palmRejection" && settings.pencilOnly;
          return (
            <div className="gn-input-settings__row" key={row.key}>
              <input
                className="gn-input-settings__checkbox"
                type="checkbox"
                id={inputId}
                checked={settings[row.key] || disabled}
                disabled={disabled}
                aria-describedby={hintId}
                onChange={(event) => onChange(row.key, event.target.checked)}
              />
              <div className="gn-input-settings__text">
                <label className="gn-input-settings__label" htmlFor={inputId}>
                  {row.label}
                </label>
                <p className="gn-input-settings__hint" id={hintId}>
                  {row.hint}
                  {disabled ? " Always on while pencil-only is on." : ""}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>

      {capabilities && (
        <p className="gn-input-settings__status" role="status">
          {capabilities.penSeen
            ? `Stylus detected${
                capabilities.penHoverSupported
                  ? " — this device reports hover"
                  : " — no hover reported by this device"
              }.`
            : "No stylus seen yet on this device."}
          {capabilities.rejectingTouch ? " Finger drawing is off." : ""}
        </p>
      )}
    </section>
  );
};
