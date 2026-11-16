/**
 * <SurfaceControls /> — "Rotate sheet" and the whiteboard switch, plus the
 * `aria-live` region that announces both.
 *
 * Keep the component mounted even if you drive the actions from your own
 * chrome: the live region is the only thing that tells a screen-reader user
 * that the sheet turned or that the pages went away. Pass `controls={false}`
 * to render the live region alone (zero layout area), the same convention
 * `goodnotes/paged`'s `PagedViewControls` uses.
 *
 * Colours come from Excalidraw's own CSS custom properties, so the control
 * is correct in light and dark with no second palette, and de-emphasised
 * text uses `--input-label-color` (NOT `--color-muted`, which is a
 * background grey and fails contrast as text).
 */

import clsx from "clsx";

import "./SurfaceControls.scss";

import type { SurfaceMode } from "./surfaceMode";

export interface SurfaceControlsProps {
  mode: SurfaceMode;
  /** `false` hides the rotate buttons: a whiteboard has no sheets to turn. */
  hasSheets: boolean;
  announcement: string;
  onToggleMode: () => void;
  onRotate: () => void;
  onRotateAll: () => void;
  /** Render the visible buttons. @default true */
  controls?: boolean;
  /** Offer "Rotate all sheets" next to "Rotate sheet". @default true */
  allowRotateAll?: boolean;
  className?: string;
}

const LiveRegion = ({ announcement }: { announcement: string }) => (
  <span
    className="goodnotes-surface-controls__live"
    role="status"
    aria-live="polite"
  >
    {announcement}
  </span>
);

const RotateIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="7" width="18" height="10" rx="1.5" />
    <path d="M8 4.5l2-2M8 4.5l2 2" />
  </svg>
);

const BoardIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="13" rx="1.5" />
    <path d="M12 17v3" />
  </svg>
);

export const SurfaceControls = ({
  mode,
  hasSheets,
  announcement,
  onToggleMode,
  onRotate,
  onRotateAll,
  controls = true,
  allowRotateAll = true,
  className,
}: SurfaceControlsProps) => {
  if (!controls) {
    return <LiveRegion announcement={announcement} />;
  }

  const isWhiteboard = mode === "whiteboard";

  return (
    <div
      className={clsx("goodnotes-surface-controls", className)}
      role="group"
      aria-label="Sheet and surface"
    >
      {hasSheets && (
        <button
          type="button"
          className="goodnotes-surface-controls__button"
          onClick={onRotate}
          title="Rotate this sheet between portrait and landscape"
        >
          <RotateIcon />
          <span>Rotate sheet</span>
        </button>
      )}
      {hasSheets && allowRotateAll && (
        <button
          type="button"
          className="goodnotes-surface-controls__button goodnotes-surface-controls__button--quiet"
          onClick={onRotateAll}
          title="Rotate every sheet in this document"
        >
          <span>All</span>
        </button>
      )}
      <button
        type="button"
        className={clsx("goodnotes-surface-controls__button", {
          "is-active": isWhiteboard,
        })}
        onClick={onToggleMode}
        aria-pressed={isWhiteboard}
        title={
          isWhiteboard
            ? "Back to paper — your pages are still here"
            : "Whiteboard — hide the pages and use the endless canvas"
        }
      >
        <BoardIcon />
        <span>Whiteboard</span>
      </button>
      <LiveRegion announcement={announcement} />
    </div>
  );
};

export default SurfaceControls;
