/**
 * <DarkModeToggle /> — the control for TRUE DARK MODE.
 *
 * Two shapes, both exported:
 *
 *   - CONTROLLED (callback-shaped), for the nav bar / taskbar that another
 *     module owns: pass `preference` + `onChange` and own the state yourself
 *     (e.g. from `useDarkMode()`).
 *   - UNCONTROLLED: omit both and it drives `useDarkMode()` internally, so a
 *     host can drop it anywhere with zero wiring.
 *
 * Variants: "segmented" (light / dark / system radiogroup) and "icon" (one
 * button that flips light <-> dark; long-press is NOT used, keyboard users
 * get the segmented control).
 */

import clsx from "clsx";
import { useCallback, useId } from "react";

import { resolveDarkModeTheme } from "./darkMode";
import { useDarkMode } from "./useDarkMode";

import "./DarkModeToggle.scss";

import type { JSX } from "react";

import type { DarkModePreference } from "./darkMode";

export interface DarkModeToggleProps {
  /** Controlled preference. Omit for the self-managing variant. */
  preference?: DarkModePreference;
  /** Called with the new preference. Omit for the self-managing variant. */
  onChange?: (preference: DarkModePreference) => void;
  /** "segmented" (default) shows light/dark/system; "icon" is a single button. */
  variant?: "segmented" | "icon";
  /** Hide the text labels in the segmented variant (icons stay, with a11y names). */
  compact?: boolean;
  className?: string;
  /** Accessible name for the group / button. */
  label?: string;
}

const OPTIONS: {
  value: DarkModePreference;
  label: string;
  title: string;
  icon: JSX.Element;
}[] = [
  {
    value: "light",
    label: "Light",
    title: "Light paper",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" />
        <g strokeLinecap="round">
          <path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
        </g>
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    title: "Dark paper",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 14.2A8.4 8.4 0 1 1 9.8 4a6.9 6.9 0 0 0 10.2 10.2z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Auto",
    title: "Follow system",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
        <path d="M8.5 20h7" strokeLinecap="round" />
      </svg>
    ),
  },
];

export const DarkModeToggle = ({
  preference,
  onChange,
  variant = "segmented",
  compact = false,
  className,
  label = "Page appearance",
}: DarkModeToggleProps) => {
  // only used when uncontrolled; the hook is cheap and always called so the
  // hook order stays stable
  const internal = useDarkMode();

  const isControlled = preference !== undefined && onChange !== undefined;
  const current = isControlled ? preference : internal.preference;

  const groupId = useId();

  const commit = useCallback(
    (next: DarkModePreference) => {
      if (isControlled) {
        onChange?.(next);
      } else {
        internal.setPreference(next);
      }
    },
    [isControlled, onChange, internal],
  );

  if (variant === "icon") {
    const resolved = resolveDarkModeTheme(current);
    const next: DarkModePreference = resolved === "dark" ? "light" : "dark";
    const option = OPTIONS.find((o) => o.value === resolved) ?? OPTIONS[0];

    return (
      <button
        type="button"
        className={clsx("goodnotes-dark-toggle", "is-icon", className)}
        aria-label={`${label}: ${option.title}. Switch to ${
          next === "dark" ? "dark" : "light"
        } paper.`}
        aria-pressed={resolved === "dark"}
        title={option.title}
        onClick={() => commit(next)}
      >
        <span className="goodnotes-dark-toggle__icon">{option.icon}</span>
      </button>
    );
  }

  return (
    <div
      className={clsx(
        "goodnotes-dark-toggle",
        "is-segmented",
        { "is-compact": compact },
        className,
      )}
      role="radiogroup"
      aria-label={label}
    >
      {OPTIONS.map((option) => {
        const checked = option.value === current;
        return (
          <button
            key={option.value}
            id={`${groupId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={checked}
            // roving tabindex: only the selected option is in the tab order
            tabIndex={checked ? 0 : -1}
            className={clsx("goodnotes-dark-toggle__option", {
              "is-active": checked,
            })}
            title={option.title}
            onClick={() => commit(option.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowRight" &&
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowUp" &&
                event.key !== "ArrowDown"
              ) {
                return;
              }
              event.preventDefault();
              const delta =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : -1;
              const index = OPTIONS.findIndex((o) => o.value === current);
              const nextOption =
                OPTIONS[(index + delta + OPTIONS.length) % OPTIONS.length];
              commit(nextOption.value);
              document
                .getElementById(`${groupId}-${nextOption.value}`)
                ?.focus();
            }}
          >
            <span className="goodnotes-dark-toggle__icon">{option.icon}</span>
            {!compact && (
              <span className="goodnotes-dark-toggle__label">
                {option.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default DarkModeToggle;
