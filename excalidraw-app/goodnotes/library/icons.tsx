/**
 * Decorative inline icons. Every one is `aria-hidden`: the control around it
 * always carries its own text or `aria-label`.
 */

import React from "react";

export const Icon = ({
  path,
  filled = false,
}: {
  path: string;
  /** Star uses fill to signal "on" — but never as the only signal. */
  filled?: boolean;
}) => (
  <svg
    className="gn-icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={path} />
  </svg>
);

export const ICON_PLUS = "M12 5v14M5 12h14";
export const ICON_PENCIL = "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z";
export const ICON_COPY =
  "M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM5 15V5a2 2 0 0 1 2-2h10";
export const ICON_TRASH = "M4 7h16M10 7V5h4v2m-7 0 1 13h8l1-13";
export const ICON_SEARCH = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4";
export const ICON_CLOSE = "M6 6l12 12M18 6L6 18";
export const ICON_CHECK = "M5 13l4 4L19 7";
export const ICON_STAR =
  "M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.95 6.75 19.7l1-5.85L3.5 9.7l5.9-.9L12 3.5z";
export const ICON_CLOCK = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2";
export const ICON_CALENDAR =
  "M4 8h16M7 3v3m10-3v3M5 21h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z";
export const ICON_FILES =
  "M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z";
export const ICON_GRID =
  "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z";
export const ICON_LIST = "M4 6h16M4 12h16M4 18h16";
export const ICON_CHEVRON_DOWN = "M6 9l6 6 6-6";
export const ICON_DATABASE =
  "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6";
export const ICON_PIN =
  "M15 3l6 6-3 1-4.5 4.5L13 19l-2 2-3.5-3.5L3 21l3.5-4.5L3 13l2-2 4.5-.5L14 6l1-3z";
export const ICON_ARCHIVE =
  "M3 6h18v3H3V6zm2 3h14v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9zm4 4h6";
export const ICON_TAG =
  "M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20 3 12.5zM7.5 7.5h.01";
export const ICON_CHEVRON_RIGHT = "M9 6l6 6-6 6";
export const ICON_MORE =
  "M5.4 12a.6.6 0 1 0 1.2 0 .6.6 0 1 0-1.2 0M11.4 12a.6.6 0 1 0 1.2 0 .6.6 0 1 0-1.2 0M17.4 12a.6.6 0 1 0 1.2 0 .6.6 0 1 0-1.2 0";
export const ICON_SORT = "M4 7h16M7 12h10M10 17h4";
export const ICON_FOLDER_OPEN =
  "M3 7a1 1 0 0 1 1-1h4l2 2h9a1 1 0 0 1 1 1v2H3V7zm0 4h18l-1.6 7.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3 11z";
