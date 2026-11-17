/**
 * Compact circular ink control in the lower-right corner.
 *
 * Shows the current stroke colour (or eraser brush) as a persistent orb so
 * colour/size stays one thumb-reach away without hunting the under-dock.
 * Tap expands a small popover with the same colour / width / eraser-size
 * chips the under-dock carries.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_ERASER_SIZE_ID,
  ERASER_SIZE_OPTIONS,
  getEraserSizeId,
  setEraserSizeId,
  type EraserSizeId,
} from "@excalidraw/excalidraw/eraser/size";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  PEN_WIDTH_STOPS,
  clampPenWidth,
  formatPenWidth,
  savePenWidth,
} from "../pens/presets";
import {
  applyInk,
  readInkWidth,
  toolFromAppState,
  type ToolMenuToolId,
} from "../tool-menu/editor";

import "./DockInkOrb.scss";

const ERASER_SIZE_STORAGE_KEY = "goodnotes-eraser-size";

const INK_SWATCHES = [
  "#1e1e1e",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
] as const;

const HIGHLIGHTER_SWATCHES = [
  "#ffd43b",
  "#a9e34b",
  "#66d9e8",
  "#ffa8a8",
  "#d0bfff",
] as const;

const ORB_TOOLS = new Set<ToolMenuToolId>(["pen", "highlighter", "eraser"]);

const isEraserSizeId = (value: unknown): value is EraserSizeId =>
  value === "s" || value === "m" || value === "l" || value === "xl";

export interface DockInkOrbProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  activeTool?: ToolMenuToolId | null;
  className?: string;
}

export const DockInkOrb = ({
  excalidrawAPI,
  activeTool: controlledTool,
  className,
}: DockInkOrbProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<ToolMenuToolId | null>(null);
  const [strokeColor, setStrokeColor] = useState("#1e1e1e");
  const [width, setWidth] = useState(0.5);
  const [eraserSize, setEraserSize] = useState<EraserSizeId>(() => {
    try {
      const raw = localStorage.getItem(ERASER_SIZE_STORAGE_KEY);
      if (isEraserSizeId(raw)) {
        setEraserSizeId(raw);
        return raw;
      }
    } catch {
      // ignore
    }
    return getEraserSizeId() || DEFAULT_ERASER_SIZE_ID;
  });

  useEffect(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    const sync = () => {
      const appState = excalidrawAPI.getAppState();
      setTool(toolFromAppState(appState));
      setStrokeColor(appState.currentItemStrokeColor);
      setWidth(readInkWidth(appState));
    };
    sync();
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const resolvedTool = controlledTool ?? tool;
  const visible = !!resolvedTool && ORB_TOOLS.has(resolvedTool);

  const onColor = useCallback(
    (color: string) => {
      applyInk(excalidrawAPI, { color });
      setStrokeColor(color);
    },
    [excalidrawAPI],
  );

  const onWidth = useCallback(
    (next: number) => {
      const clamped = clampPenWidth(next);
      applyInk(excalidrawAPI, { width: clamped });
      if (resolvedTool === "pen" || resolvedTool === "highlighter") {
        savePenWidth(resolvedTool, clamped);
      }
      setWidth(clamped);
    },
    [excalidrawAPI, resolvedTool],
  );

  const onEraser = useCallback(
    (id: EraserSizeId) => {
      setEraserSizeId(id);
      setEraserSize(id);
      try {
        localStorage.setItem(ERASER_SIZE_STORAGE_KEY, id);
      } catch {
        // ignore
      }
      if (excalidrawAPI && !excalidrawAPI.isDestroyed) {
        if (excalidrawAPI.getAppState().activeTool.type === "eraser") {
          excalidrawAPI.resetCursor();
        }
      }
    },
    [excalidrawAPI],
  );

  if (!visible) {
    return null;
  }

  const swatches =
    resolvedTool === "highlighter" ? HIGHLIGHTER_SWATCHES : INK_SWATCHES;
  const orbFill =
    resolvedTool === "eraser" ? "transparent" : strokeColor || "#1e1e1e";
  const sizeLabel =
    ERASER_SIZE_OPTIONS.find((option) => option.id === eraserSize)?.label ??
    "Medium";

  return (
    <div
      ref={rootRef}
      className={`gn-ink-orb${open ? " gn-ink-orb--open" : ""}${
        className ? ` ${className}` : ""
      }`}
      data-testid="goodnotes-ink-orb"
      data-tool={resolvedTool}
    >
      {open && (
        <div
          className="gn-ink-orb__panel"
          role="dialog"
          aria-label={
            resolvedTool === "eraser" ? "Eraser size" : "Ink colour and width"
          }
        >
          {resolvedTool === "eraser" ? (
            <div className="gn-ink-orb__row">
              {ERASER_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="gn-ink-orb__chip"
                  aria-pressed={option.id === eraserSize}
                  title={option.label}
                  onClick={() => onEraser(option.id)}
                >
                  <span
                    className="gn-ink-orb__size-dot"
                    style={{
                      ["--gn-orb-dot" as string]: `${Math.round(
                        option.cursorPx * 0.45,
                      )}px`,
                    }}
                  />
                  <span className="gn-ink-orb__sr">{option.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="gn-ink-orb__row">
                {swatches.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="gn-ink-orb__swatch"
                    aria-pressed={
                      color.toLowerCase() === strokeColor.toLowerCase()
                    }
                    title={color}
                    style={{ ["--gn-orb-swatch" as string]: color }}
                    onClick={() => onColor(color)}
                  >
                    <span className="gn-ink-orb__sr">{color}</span>
                  </button>
                ))}
              </div>
              <div className="gn-ink-orb__row">
                {PEN_WIDTH_STOPS.map((stop) => (
                  <button
                    key={stop.width}
                    type="button"
                    className="gn-ink-orb__chip"
                    aria-pressed={Math.abs(width - stop.width) < 0.001}
                    title={`${stop.label} (${formatPenWidth(stop.width)})`}
                    onClick={() => onWidth(stop.width)}
                  >
                    <span
                      className="gn-ink-orb__width-dot"
                      style={{
                        ["--gn-orb-dot" as string]: `${Math.max(
                          2,
                          Math.min(12, 1 + 4.5 * Math.sqrt(stop.width)),
                        )}px`,
                      }}
                    />
                    <span className="gn-ink-orb__sr">
                      {stop.label}, {formatPenWidth(stop.width)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="gn-ink-orb__button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          resolvedTool === "eraser"
            ? `Eraser size: ${sizeLabel}`
            : `Ink colour ${strokeColor}`
        }
        onClick={() => setOpen((value) => !value)}
        style={{ ["--gn-orb-fill" as string]: orbFill }}
      >
        {resolvedTool === "eraser" ? (
          <span
            className="gn-ink-orb__eraser-ring"
            style={{
              ["--gn-orb-dot" as string]: `${Math.round(
                (ERASER_SIZE_OPTIONS.find((o) => o.id === eraserSize)
                  ?.cursorPx ?? 20) * 0.35,
              )}px`,
            }}
          />
        ) : (
          <span className="gn-ink-orb__fill" aria-hidden="true" />
        )}
        <span className="gn-ink-orb__sr">
          {resolvedTool === "eraser"
            ? `Eraser size ${sizeLabel}`
            : `Current ink colour ${strokeColor}`}
        </span>
      </button>
    </div>
  );
};

export default DockInkOrb;
