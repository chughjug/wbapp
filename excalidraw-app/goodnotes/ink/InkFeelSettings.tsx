/**
 * <InkFeelSettings /> — the handwriting "ink feel" control.
 *
 * Two shapes, as with <DarkModeToggle />:
 *
 *   - CONTROLLED (callback-shaped), for the consolidated Settings screen that
 *     another module owns: pass `settings` + `onChange` and own the state.
 *   - UNCONTROLLED: omit both and it drives `useInkFeel()` internally.
 *
 * The control is deliberately plain: a radiogroup of three presets plus one
 * checkbox. It carries its own description text because the trade-off
 * ("precise keeps small letters, smooth hides jitter") is not guessable from
 * the names alone.
 */

import clsx from "clsx";
import { useCallback, useId } from "react";

import { INK_FEELS, INK_FEEL_LABELS } from "./inkFeel";
import { useInkFeel } from "./useInkFeel";

import "./InkFeelSettings.scss";

import type {
  InkFeel,
  InkFeelSettings as InkFeelSettingsValue,
} from "./inkFeel";

export interface InkFeelSettingsProps {
  /** Controlled value. Omit for the self-managing variant. */
  settings?: InkFeelSettingsValue;
  /** Called with the full next value. Omit for the self-managing variant. */
  onChange?: (settings: InkFeelSettingsValue) => void;
  /** Hide the per-option description text. */
  compact?: boolean;
  /** Hide the "use real pen pressure" checkbox. */
  hidePressureOption?: boolean;
  className?: string;
  label?: string;
}

export const InkFeelSettings = ({
  settings,
  onChange,
  compact = false,
  hidePressureOption = false,
  className,
  label = "Ink feel",
}: InkFeelSettingsProps) => {
  // only used when uncontrolled; always called so hook order stays stable
  const internal = useInkFeel();

  const isControlled = settings !== undefined && onChange !== undefined;
  const current = isControlled ? settings : internal.settings;

  const groupId = useId();

  const commit = useCallback(
    (next: InkFeelSettingsValue) => {
      if (isControlled) {
        onChange?.(next);
      } else {
        internal.setFeel(next.feel);
        internal.setPreferRealPenPressure(next.preferRealPenPressure);
      }
    },
    [isControlled, onChange, internal],
  );

  const selectFeel = (feel: InkFeel) => commit({ ...current, feel });

  return (
    <div className={clsx("goodnotes-ink-feel", className)}>
      <div
        className="goodnotes-ink-feel__options"
        role="radiogroup"
        aria-label={label}
      >
        {INK_FEELS.map((feel) => {
          const checked = feel === current.feel;
          const copy = INK_FEEL_LABELS[feel];
          return (
            <button
              key={feel}
              id={`${groupId}-${feel}`}
              type="button"
              role="radio"
              aria-checked={checked}
              // roving tabindex: only the selected option is in the tab order
              tabIndex={checked ? 0 : -1}
              className={clsx("goodnotes-ink-feel__option", {
                "is-active": checked,
              })}
              title={copy.description}
              onClick={() => selectFeel(feel)}
            >
              <span className="goodnotes-ink-feel__option-label">
                {copy.label}
              </span>
              {!compact && (
                <span className="goodnotes-ink-feel__option-description">
                  {copy.description}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!hidePressureOption && (
        <label className="goodnotes-ink-feel__pressure">
          <input
            type="checkbox"
            checked={current.preferRealPenPressure}
            onChange={(event) =>
              commit({
                ...current,
                preferRealPenPressure: event.target.checked,
              })
            }
          />
          <span>
            <span className="goodnotes-ink-feel__pressure-label">
              Always use real pen pressure
            </span>
            {!compact && (
              <span className="goodnotes-ink-feel__option-description">
                Stops the editor guessing that a stylus has no pressure sensor.
                Turn off if your pen draws a flat, uniform line.
              </span>
            )}
          </span>
        </label>
      )}
    </div>
  );
};
