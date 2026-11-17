/**
 * Always-visible tool options strip docked under the floating bar.
 *
 * When pen / highlighter / eraser / shape / text is active, this renders a
 * second pill under the main toolbar with the options people reach for
 * mid-stroke: colours, widths, saved pens, eraser sizes. It floats over the
 * canvas (no layout resize) and stays up for as long as the tool is active —
 * never a tap-again popover.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

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
  loadPenPresets,
  savePenWidth,
} from "../pens/presets";
import {
  applyInk,
  applyPreset,
  applyShapeStyle,
  activateTool,
  readInkWidth,
  toolFromAppState,
  type ToolMenuShapeId,
  type ToolMenuToolId,
} from "../tool-menu/editor";

import "./BarToolSubmenu.scss";

import type { PenPreset } from "../types";

const ERASER_SIZE_STORAGE_KEY = "goodnotes-eraser-size";

const INK_SWATCHES = [
  { value: "#1e1e1e", label: "Black" },
  { value: "#e03131", label: "Red" },
  { value: "#1971c2", label: "Blue" },
  { value: "#2f9e44", label: "Green" },
  { value: "#f08c00", label: "Orange" },
] as const;

const HIGHLIGHTER_SWATCHES = [
  { value: "#ffd43b", label: "Yellow" },
  { value: "#a9e34b", label: "Lime" },
  { value: "#66d9e8", label: "Cyan" },
  { value: "#ffa8a8", label: "Pink" },
  { value: "#d0bfff", label: "Lilac" },
] as const;

const SHAPE_OPTIONS: readonly { value: ToolMenuShapeId; label: string }[] = [
  { value: "rectangle", label: "Rectangle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "diamond", label: "Diamond" },
  { value: "arrow", label: "Arrow" },
  { value: "line", label: "Line" },
];

const FONT_SIZES = [
  { value: 16, label: "S" },
  { value: 20, label: "M" },
  { value: 28, label: "L" },
  { value: 36, label: "XL" },
] as const;

const SUBMENU_TOOLS = new Set<ToolMenuToolId>([
  "pen",
  "highlighter",
  "eraser",
  "shape",
  "text",
]);

const widthDotPx = (width: number) =>
  Math.max(2, Math.min(14, Math.round((1 + 5.2 * Math.sqrt(width)) * 10) / 10));

const isEraserSizeId = (value: unknown): value is EraserSizeId =>
  value === "s" || value === "m" || value === "l" || value === "xl";

const loadStoredEraserSize = (): EraserSizeId => {
  try {
    const raw = localStorage.getItem(ERASER_SIZE_STORAGE_KEY);
    if (isEraserSizeId(raw)) {
      return raw;
    }
  } catch {
    // private mode / SSR
  }
  return DEFAULT_ERASER_SIZE_ID;
};

const persistEraserSize = (id: EraserSizeId): void => {
  try {
    localStorage.setItem(ERASER_SIZE_STORAGE_KEY, id);
  } catch {
    // ignore
  }
};

export interface BarToolSubmenuProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Host-driven tool override (mirrors FloatingBar). */
  activeTool?: ToolMenuToolId | null;
  className?: string;
}

interface LiveStyle {
  tool: ToolMenuToolId | null;
  strokeColor: string;
  width: number;
  opacity: number;
  shape: ToolMenuShapeId | null;
  fontSize: number;
}

const readLiveStyle = (api: ExcalidrawImperativeAPI | null): LiveStyle => {
  if (!api || api.isDestroyed) {
    return {
      tool: null,
      strokeColor: "#1e1e1e",
      width: 0.5,
      opacity: 100,
      shape: null,
      fontSize: 20,
    };
  }
  const appState = api.getAppState();
  const tool = toolFromAppState(appState);
  const shape =
    tool === "shape" &&
    (appState.activeTool.type === "rectangle" ||
      appState.activeTool.type === "ellipse" ||
      appState.activeTool.type === "diamond" ||
      appState.activeTool.type === "arrow" ||
      appState.activeTool.type === "line")
      ? (appState.activeTool.type as ToolMenuShapeId)
      : null;
  return {
    tool,
    strokeColor: appState.currentItemStrokeColor,
    width: readInkWidth(appState),
    opacity: appState.currentItemOpacity,
    shape,
    fontSize: appState.currentItemFontSize,
  };
};

/**
 * Second pill under the floating bar. Renders `null` for tools with nothing
 * honest to configure (select / lasso / hand / image / …).
 */
export const BarToolSubmenu = ({
  excalidrawAPI,
  activeTool: controlledTool,
  className,
}: BarToolSubmenuProps) => {
  const [style, setStyle] = useState<LiveStyle>(() =>
    readLiveStyle(excalidrawAPI),
  );
  const [presets, setPresets] = useState<PenPreset[]>(() => loadPenPresets());
  const [eraserSize, setEraserSize] = useState<EraserSizeId>(() => {
    const id = loadStoredEraserSize();
    setEraserSizeId(id);
    return id;
  });

  useEffect(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    const sync = () => setStyle(readLiveStyle(excalidrawAPI));
    sync();
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  useEffect(() => {
    setPresets(loadPenPresets());
  }, [style.tool]);

  const tool = controlledTool ?? style.tool;

  const onColor = useCallback(
    (color: string) => {
      applyInk(excalidrawAPI, { color });
      setStyle((current) => ({ ...current, strokeColor: color }));
    },
    [excalidrawAPI],
  );

  const onWidth = useCallback(
    (width: number) => {
      const next = clampPenWidth(width);
      applyInk(excalidrawAPI, { width: next });
      if (tool === "pen" || tool === "highlighter") {
        savePenWidth(tool, next);
      }
      setStyle((current) => ({ ...current, width: next }));
    },
    [excalidrawAPI, tool],
  );

  const onPreset = useCallback(
    (preset: PenPreset) => {
      applyPreset(excalidrawAPI, preset);
      setPresets(loadPenPresets());
      setStyle(readLiveStyle(excalidrawAPI));
    },
    [excalidrawAPI],
  );

  const onEraserSize = useCallback(
    (id: EraserSizeId) => {
      setEraserSizeId(id);
      persistEraserSize(id);
      setEraserSize(id);
      // refresh the cursor while the eraser is already active
      if (excalidrawAPI && !excalidrawAPI.isDestroyed) {
        if (excalidrawAPI.getAppState().activeTool.type === "eraser") {
          excalidrawAPI.resetCursor();
        }
      }
    },
    [excalidrawAPI],
  );

  const inkPresets = useMemo(() => {
    if (tool === "eraser") {
      return presets.filter((preset) => preset.tool === "eraser");
    }
    if (tool === "highlighter") {
      return presets.filter((preset) => preset.tool === "highlighter");
    }
    if (tool === "pen") {
      return presets.filter((preset) => preset.tool === "freedraw");
    }
    return [];
  }, [presets, tool]);

  if (!tool || !SUBMENU_TOOLS.has(tool)) {
    return null;
  }

  const swatches = tool === "highlighter" ? HIGHLIGHTER_SWATCHES : INK_SWATCHES;
  const title =
    tool === "pen"
      ? "Pen options"
      : tool === "highlighter"
      ? "Highlighter options"
      : tool === "eraser"
      ? "Eraser options"
      : tool === "shape"
      ? "Shape options"
      : "Text options";

  return (
    <div
      className={`gn-bar-sub${className ? ` ${className}` : ""}`}
      data-testid="goodnotes-bar-submenu"
      data-tool={tool}
      role="toolbar"
      aria-label={title}
    >
      {(tool === "pen" || tool === "highlighter") && (
        <>
          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Color</legend>
            <div className="gn-bar-sub__row">
              {swatches.map((swatch) => {
                const pressed =
                  swatch.value.toLowerCase() ===
                  style.strokeColor.toLowerCase();
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    className="gn-bar-sub__swatch"
                    aria-pressed={pressed}
                    title={swatch.label}
                    style={{ ["--gn-swatch" as string]: swatch.value }}
                    onClick={() => onColor(swatch.value)}
                  >
                    <span className="gn-bar-sub__sr">{swatch.label}</span>
                  </button>
                );
              })}
              <label
                className="gn-bar-sub__swatch gn-bar-sub__swatch--custom"
                title="Custom colour"
              >
                <input
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(style.strokeColor)
                      ? style.strokeColor
                      : "#1e1e1e"
                  }
                  aria-label="Custom colour"
                  onChange={(event) => onColor(event.target.value)}
                />
                <span aria-hidden="true">+</span>
              </label>
            </div>
          </fieldset>

          <span className="gn-bar-sub__rule" aria-hidden="true" />

          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Width</legend>
            <div className="gn-bar-sub__row">
              {PEN_WIDTH_STOPS.map((stop) => {
                const pressed = Math.abs(style.width - stop.width) < 0.001;
                return (
                  <button
                    key={stop.width}
                    type="button"
                    className="gn-bar-sub__width"
                    aria-pressed={pressed}
                    title={`${stop.label} (${formatPenWidth(stop.width)})`}
                    onClick={() => onWidth(stop.width)}
                  >
                    <span
                      className="gn-bar-sub__width-dot"
                      aria-hidden="true"
                      style={{
                        ["--gn-width-dot" as string]: `${widthDotPx(
                          stop.width,
                        )}px`,
                      }}
                    />
                    <span className="gn-bar-sub__sr">
                      {stop.label}, {formatPenWidth(stop.width)}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {inkPresets.length > 0 && (
            <>
              <span className="gn-bar-sub__rule" aria-hidden="true" />
              <fieldset className="gn-bar-sub__group gn-bar-sub__group--presets">
                <legend className="gn-bar-sub__legend">Pens</legend>
                <div className="gn-bar-sub__row">
                  {inkPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="gn-bar-sub__chip"
                      title={preset.label}
                      onClick={() => onPreset(preset)}
                    >
                      <span
                        className="gn-bar-sub__chip-dot"
                        aria-hidden="true"
                        style={{
                          background:
                            preset.tool === "eraser"
                              ? "transparent"
                              : preset.color,
                          opacity: preset.opacity / 100,
                        }}
                      />
                      <span className="gn-bar-sub__chip-label">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </>
      )}

      {tool === "eraser" && (
        <fieldset className="gn-bar-sub__group">
          <legend className="gn-bar-sub__legend">Size</legend>
          <div className="gn-bar-sub__row">
            {ERASER_SIZE_OPTIONS.map((option) => {
              const pressed = option.id === eraserSize;
              return (
                <button
                  key={option.id}
                  type="button"
                  className="gn-bar-sub__size"
                  aria-pressed={pressed}
                  title={option.label}
                  onClick={() => onEraserSize(option.id)}
                >
                  <span
                    className="gn-bar-sub__size-dot"
                    aria-hidden="true"
                    style={{
                      ["--gn-eraser-dot" as string]: `${Math.round(
                        option.cursorPx * 0.55,
                      )}px`,
                    }}
                  />
                  <span className="gn-bar-sub__size-label">{option.label}</span>
                </button>
              );
            })}
            {/* keep live id in sync for tests / first paint */}
            <span
              className="gn-bar-sub__sr"
              data-eraser-size={getEraserSizeId()}
            >
              Active eraser size {eraserSize}
            </span>
          </div>
        </fieldset>
      )}

      {tool === "shape" && (
        <>
          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Shape</legend>
            <div className="gn-bar-sub__row">
              {SHAPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="gn-bar-sub__chip"
                  aria-pressed={style.shape === option.value}
                  title={option.label}
                  onClick={() => {
                    activateTool(excalidrawAPI, "shape", {
                      shape: option.value,
                    });
                    setStyle((current) => ({
                      ...current,
                      tool: "shape",
                      shape: option.value,
                    }));
                  }}
                >
                  <span className="gn-bar-sub__chip-label">{option.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <span className="gn-bar-sub__rule" aria-hidden="true" />
          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Stroke</legend>
            <div className="gn-bar-sub__row">
              {INK_SWATCHES.map((swatch) => {
                const pressed =
                  swatch.value.toLowerCase() ===
                  style.strokeColor.toLowerCase();
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    className="gn-bar-sub__swatch"
                    aria-pressed={pressed}
                    title={swatch.label}
                    style={{ ["--gn-swatch" as string]: swatch.value }}
                    onClick={() => {
                      applyShapeStyle(excalidrawAPI, {
                        strokeColor: swatch.value,
                      });
                      setStyle((current) => ({
                        ...current,
                        strokeColor: swatch.value,
                      }));
                    }}
                  >
                    <span className="gn-bar-sub__sr">{swatch.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      {tool === "text" && (
        <>
          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Color</legend>
            <div className="gn-bar-sub__row">
              {INK_SWATCHES.map((swatch) => {
                const pressed =
                  swatch.value.toLowerCase() ===
                  style.strokeColor.toLowerCase();
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    className="gn-bar-sub__swatch"
                    aria-pressed={pressed}
                    title={swatch.label}
                    style={{ ["--gn-swatch" as string]: swatch.value }}
                    onClick={() => onColor(swatch.value)}
                  >
                    <span className="gn-bar-sub__sr">{swatch.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <span className="gn-bar-sub__rule" aria-hidden="true" />
          <fieldset className="gn-bar-sub__group">
            <legend className="gn-bar-sub__legend">Size</legend>
            <div className="gn-bar-sub__row">
              {FONT_SIZES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="gn-bar-sub__chip"
                  aria-pressed={style.fontSize === option.value}
                  title={`${option.label} (${option.value})`}
                  onClick={() => {
                    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
                      return;
                    }
                    excalidrawAPI.updateScene({
                      appState: {
                        currentItemFontSize: option.value,
                      } as any,
                    });
                    setStyle((current) => ({
                      ...current,
                      fontSize: option.value,
                    }));
                  }}
                >
                  <span className="gn-bar-sub__chip-label">{option.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
};

export default BarToolSubmenu;
