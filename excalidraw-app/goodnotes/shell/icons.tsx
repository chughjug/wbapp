/**
 * The handful of icons the floating bar needs that `goodnotes/taskbar/icons`
 * does not ship. Same contract as that set: a bare 24x24 `<svg>` that inherits
 * `currentColor`, always `aria-hidden` (the accessible name comes from the
 * control), and no imports from `packages/excalidraw` internals.
 */

import type { ReactNode } from "react";

const svg = (children: ReactNode): ReactNode => (
  <svg
    className="gn-icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/** The "+" overflow: secondary insert tools. */
export const PlusIcon = () => svg(<path d="M12 5v14M5 12h14" />);

/** Light/dark toggle. A half-filled disc reads in both themes. */
export const ThemeIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none" />
    </>,
  );

/** Insert graph. */
export const GraphIcon = () =>
  svg(
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M7 16c3 0 3.5-8 6-8s2.5 5 5 5" />
    </>,
  );

/**
 * The hand (pan) tool. An open palm — four fingers and a thumb over a
 * rounded palm — which is the idiom every tablet note app uses for "move
 * the paper, don't mark it". Drawn with the same 1.6 stroke as the other
 * tool glyphs so it does not read as heavier than the pen beside it.
 */
export const HandIcon = () =>
  svg(
    <>
      {/* pinky + the palm's left edge, drawn as one outline */}
      <path d="M8.5 16.4V6.6a1.5 1.5 0 0 1 3 0v3.9" />
      {/* index finger */}
      <path d="M11.5 10.5V4.6a1.5 1.5 0 0 1 3 0v5.9" />
      {/* middle finger, then the palm and the thumb down to the wrist */}
      <path d="M14.5 10.5V6.1a1.5 1.5 0 0 1 3 0v8.4a6.5 6.5 0 0 1-6.5 6.5h-1a5 5 0 0 1-3.6-1.55l-3.05-3.25a1.5 1.5 0 0 1 2.2-2.05l2.45 2.6" />
    </>,
  );

/** Host commands appended to the "…" menu (settings and friends). */
export const SettingsIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
    </>,
  );
