/**
 * Inline 20x20 icons for the nav bar.
 *
 * Self-contained on purpose: the bar must not import from
 * `packages/excalidraw` internals (not part of the public entrypoint) nor from
 * sibling `goodnotes/*` modules owned by other agents. Every icon is a bare
 * `<svg>` that inherits `currentColor`, so theming is automatic, and every one
 * is `aria-hidden` — the accessible name always comes from the control.
 */

import type { ReactNode } from "react";

const svg = (children: ReactNode, opts?: { fill?: boolean }): ReactNode => (
  <svg
    className="gn-icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill={opts?.fill ? "currentColor" : "none"}
    stroke={opts?.fill ? "none" : "currentColor"}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const SelectIcon = () =>
  svg(
    <>
      <path d="M5 3.5 18.5 12l-6.2 1.3L9.6 19 5 3.5Z" />
    </>,
  );

export const FuzzySelectIcon = () =>
  svg(
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M11 4h2M4 11v2M20 11v2M11 20h2" />
      <circle cx="12" cy="12" r="3.2" />
    </>,
  );

export const PenIcon = () =>
  svg(
    <>
      <path d="M16.6 3.9a2 2 0 0 1 2.8 2.8L8.4 17.7 4 20l2.3-4.4L16.6 3.9Z" />
      <path d="M14.6 5.9 18 9.3" />
    </>,
  );

export const HighlighterIcon = () =>
  svg(
    <>
      <path d="M13.5 3.8 20 10.3l-7.3 7.3H7.4l-1.6-1.6 7.7-12.2Z" />
      <path d="M4 20.5h16" />
    </>,
  );

export const EraserIcon = () =>
  svg(
    <>
      <path d="M8.5 19.5 3.9 14.9a1.9 1.9 0 0 1 0-2.7l8-8a1.9 1.9 0 0 1 2.7 0l5.4 5.4a1.9 1.9 0 0 1 0 2.7l-7.2 7.2H8.5Z" />
      <path d="M9 9.5 15 15.5" />
      <path d="M12.5 19.5H21" />
    </>,
  );

export const ShapesIcon = () =>
  svg(
    <>
      <rect x="3.5" y="10.5" width="10" height="10" rx="1.5" />
      <circle cx="16" cy="8" r="4.5" />
    </>,
  );

export const RectangleIcon = () =>
  svg(<rect x="3.5" y="5.5" width="17" height="13" rx="2" />);

export const EllipseIcon = () =>
  svg(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />);

export const DiamondIcon = () =>
  svg(<path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" />);

export const ArrowIcon = () =>
  svg(
    <>
      <path d="M4 18 20 6" />
      <path d="M12.5 6H20v7.5" />
    </>,
  );

export const LineIcon = () => svg(<path d="M4 19 20 5" />);

export const TextIcon = () =>
  svg(
    <>
      <path d="M5 5.5h14" />
      <path d="M12 5.5V19" />
      <path d="M9 19h6" />
    </>,
  );

export const ImageIcon = () =>
  svg(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.8" cy="9.5" r="1.6" />
      <path d="m4.5 17 4.8-4.6a1.6 1.6 0 0 1 2.2 0L20 19.5" />
    </>,
  );

export const BackdropIcon = () =>
  svg(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 13h8M8 16h5" />
    </>,
  );

export const ImportPdfIcon = () =>
  svg(
    <>
      <path d="M12 3.5v10" />
      <path d="m8.2 9.8 3.8 3.8 3.8-3.8" />
      <path d="M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16" />
    </>,
  );

export const ExportPdfIcon = () =>
  svg(
    <>
      <path d="M12 14.5v-10" />
      <path d="m8.2 8.3 3.8-3.8 3.8 3.8" />
      <path d="M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16" />
    </>,
  );

export const AddPageIcon = () =>
  svg(
    <>
      <path d="M5.5 3.5h8l5 5v12a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M12 12v6M9 15h6" />
    </>,
  );

export const MoreIcon = () =>
  svg(
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>,
    { fill: true },
  );

export const ChevronIcon = () => svg(<path d="m7 10 5 5 5-5" />);

// ---------------------------------------------------------------------------
// nav-bar zones (added with the three-zone shell)
// ---------------------------------------------------------------------------

export const LassoIcon = () =>
  svg(
    <>
      <path d="M4.2 11.2c0-3.6 3.5-6.4 7.8-6.4s7.8 2.8 7.8 6.4-3.5 6.4-7.8 6.4c-1.3 0-2.6-.2-3.7-.7" />
      <path d="M8.3 16.9c-1 .7-1.6 1.6-1.6 2.3 0 .7.6 1.3 1.4 1.3" />
    </>,
  );

export const StickyIcon = () =>
  svg(
    <>
      <path d="M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v8.2l-5.8 5.8H5.5a1 1 0 0 1-1-1v-13Z" />
      <path d="M19.5 13.7h-4.8a1 1 0 0 0-1 1v4.8" />
    </>,
  );

export const PagesPanelIcon = () =>
  svg(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>,
  );

export const SearchIcon = () =>
  svg(
    <>
      <circle cx="11" cy="11" r="6.3" />
      <path d="m15.6 15.6 4.4 4.4" />
    </>,
  );

export const UndoIcon = () =>
  svg(
    <>
      <path d="M8.5 7.5 4.5 11l4 3.5" />
      <path d="M4.5 11h9a5 5 0 0 1 0 10h-3" />
    </>,
  );

export const RedoIcon = () =>
  svg(
    <>
      <path d="M15.5 7.5 19.5 11l-4 3.5" />
      <path d="M19.5 11h-9a5 5 0 0 0 0 10h3" />
    </>,
  );

export const ShareIcon = () =>
  svg(
    <>
      <path d="M12 15.5V4" />
      <path d="m8 7.8 4-3.8 4 3.8" />
      <path d="M5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-5.5" />
    </>,
  );

export const WriteIcon = () =>
  svg(
    <>
      <path d="M15.8 4.6a1.8 1.8 0 0 1 2.6 2.6L9 16.6l-3.5 1 1-3.5 9.3-9.5Z" />
      <path d="M4 20.5h16" />
    </>,
  );

export const ReadIcon = () =>
  svg(
    <>
      <path d="M12 6.8C10.4 5.4 8.3 4.8 4.5 4.8v12.4c3.8 0 5.9.6 7.5 2 1.6-1.4 3.7-2 7.5-2V4.8c-3.8 0-5.9.6-7.5 2Z" />
      <path d="M12 6.8v12.4" />
    </>,
  );

export const CloseIcon = () =>
  svg(
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>,
  );

/** Back to the document library. */
export const HomeIcon = () => (
  <svg viewBox="0 0 24 24" className="gn-icon" aria-hidden="true">
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 10v9h12v-9" />
    <path d="M10 19v-5h4v5" />
  </svg>
);

/** Create a new document. */
export const NewDocumentIcon = () => (
  <svg viewBox="0 0 24 24" className="gn-icon" aria-hidden="true">
    <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M12 11v6M9 14h6" />
  </svg>
);
