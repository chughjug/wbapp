import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  PEN_WIDTHS,
  loadPenPresets,
  resetPenPresets,
  savePenPresets,
  snapPenWidth,
} from "./presets";

import "./PenTray.scss";

import type { PenPreset } from "../types";

/**
 * Marker written into `element.customData` so the renderer composites the
 * stroke with `multiply`. Must stay in sync with `isHighlighterElement` in
 * `packages/element/src/renderElement.ts`.
 */
export const HIGHLIGHTER_CUSTOM_DATA = {
  goodnotes: { highlighter: true },
} as const;

/**
 * Drive the editor from a preset: active tool, stroke colour, stroke width and
 * opacity. Highlighter presets additionally stamp the highlighter marker onto
 * every subsequently drawn freedraw element.
 */
export const applyPenPreset = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  preset: PenPreset,
): void => {
  if (preset.tool === "eraser") {
    excalidrawAPI.setActiveTool({ type: "eraser" });
    excalidrawAPI.updateScene({
      appState: { currentItemCustomData: null },
    });
    return;
  }

  excalidrawAPI.setActiveTool({ type: "freedraw" });
  excalidrawAPI.updateScene({
    appState: {
      currentItemStrokeColor: preset.color,
      currentItemStrokeWidthKey: snapPenWidth(preset.width),
      currentItemOpacity: Math.round(
        Math.min(100, Math.max(0, preset.opacity)),
      ),
      currentItemCustomData:
        preset.tool === "highlighter"
          ? // a fresh object per activation so elements never share a reference
            { goodnotes: { highlighter: true } }
          : null,
    },
  });
};

const WIDTH_OPTIONS: { value: number; label: string }[] = [
  { value: PEN_WIDTHS.thin, label: "Thin" },
  { value: PEN_WIDTHS.medium, label: "Medium" },
  { value: PEN_WIDTHS.bold, label: "Bold" },
];

export interface PenTrayProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Disable the global 1-9 shortcuts. Defaults to `false`. */
  disableShortcuts?: boolean;
  className?: string;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};

const describePreset = (preset: PenPreset): string => {
  if (preset.tool === "eraser") {
    return "eraser";
  }
  const width =
    WIDTH_OPTIONS.find((o) => o.value === snapWidthValue(preset.width))
      ?.label ?? "medium";
  return `${preset.tool === "highlighter" ? "highlighter" : "pen"}, ${width}, ${
    preset.opacity
  }% opacity`;
};

const snapWidthValue = (width: number): number =>
  PEN_WIDTHS[snapPenWidth(width)];

/**
 * Compact, keyboard-driven tray of saved pens. Clicking (or pressing 1-9)
 * activates a preset in the editor; the pencil toggle reveals per-preset
 * colour / width / opacity editing, persisted to localStorage.
 */
export const PenTray = ({
  excalidrawAPI,
  disableShortcuts = false,
  className,
}: PenTrayProps) => {
  const [presets, setPresets] = useState<PenPreset[]>(() => loadPenPresets());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const apiRef = useRef(excalidrawAPI);
  apiRef.current = excalidrawAPI;

  const activate = useCallback((preset: PenPreset) => {
    setActiveId(preset.id);
    const api = apiRef.current;
    if (api && !api.isDestroyed) {
      applyPenPreset(api, preset);
    }
  }, []);

  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  useEffect(() => {
    if (disableShortcuts) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index > 8) {
        return;
      }
      const preset = presetsRef.current[index];
      if (!preset) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activate(preset);
    };
    // capture phase: Excalidraw binds number keys for its own tool shortcuts
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activate, disableShortcuts]);

  const updatePreset = useCallback(
    (id: string, patch: Partial<PenPreset>) => {
      setPresets((current) => {
        const next = current.map((preset) =>
          preset.id === id ? { ...preset, ...patch } : preset,
        );
        savePenPresets(next);
        const changed = next.find((preset) => preset.id === id);
        if (changed && changed.id === activeId) {
          const api = apiRef.current;
          if (api && !api.isDestroyed) {
            applyPenPreset(api, changed);
          }
        }
        return next;
      });
    },
    [activeId],
  );

  const onReset = useCallback(() => {
    const defaults = resetPenPresets();
    setPresets(defaults);
    setEditingId(null);
  }, []);

  const editing = useMemo(
    () => presets.find((preset) => preset.id === editingId) ?? null,
    [presets, editingId],
  );

  return (
    <div
      className={`goodnotes-pen-tray ${className ?? ""}`.trim()}
      data-testid="goodnotes-pen-tray"
    >
      <ul className="goodnotes-pen-tray__list" aria-label="Pen presets">
        {presets.map((preset, index) => {
          const isActive = preset.id === activeId;
          const shortcut = index < 9 ? `${index + 1}` : null;
          return (
            <li key={preset.id} className="goodnotes-pen-tray__item">
              <button
                type="button"
                className="goodnotes-pen-tray__pen"
                aria-pressed={isActive}
                data-tool={preset.tool}
                title={
                  shortcut ? `${preset.label} (${shortcut})` : preset.label
                }
                onClick={() => activate(preset)}
              >
                <span
                  className="goodnotes-pen-tray__swatch"
                  aria-hidden="true"
                  data-tool={preset.tool}
                  style={{
                    // eraser has no ink colour
                    ["--pen-color" as any]:
                      preset.tool === "eraser" ? "transparent" : preset.color,
                    ["--pen-opacity" as any]:
                      preset.tool === "highlighter"
                        ? String(preset.opacity / 100)
                        : "1",
                    ["--pen-width" as any]: `${
                      2 + snapWidthValue(preset.width) * 3
                    }px`,
                  }}
                />
                <span className="goodnotes-pen-tray__label">
                  {preset.label}
                </span>
                <span className="goodnotes-pen-tray__sr">
                  {describePreset(preset)}
                  {shortcut ? `, shortcut ${shortcut}` : ""}
                </span>
                {shortcut && (
                  <span className="goodnotes-pen-tray__kbd" aria-hidden="true">
                    {shortcut}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="goodnotes-pen-tray__actions">
        <button
          type="button"
          className="goodnotes-pen-tray__edit-toggle"
          aria-pressed={editingId !== null}
          aria-expanded={editingId !== null}
          aria-controls="goodnotes-pen-editor"
          onClick={() =>
            setEditingId((current) =>
              current === null ? activeId ?? presets[0]?.id ?? null : null,
            )
          }
        >
          Customise pens
        </button>
      </div>

      {editing && (
        <div
          className="goodnotes-pen-tray__editor"
          id="goodnotes-pen-editor"
          role="group"
          aria-label={`Customise ${editing.label}`}
        >
          <label className="goodnotes-pen-tray__field">
            <span>Pen</span>
            <select
              value={editing.id}
              onChange={(event) => setEditingId(event.target.value)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="goodnotes-pen-tray__field">
            <span>Colour</span>
            <input
              type="color"
              value={editing.color}
              disabled={editing.tool === "eraser"}
              onChange={(event) =>
                updatePreset(editing.id, { color: event.target.value })
              }
            />
          </label>

          <label className="goodnotes-pen-tray__field">
            <span>Width</span>
            <select
              value={snapWidthValue(editing.width)}
              onChange={(event) =>
                updatePreset(editing.id, { width: Number(event.target.value) })
              }
            >
              {WIDTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="goodnotes-pen-tray__field">
            <span>Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={editing.opacity}
              onChange={(event) =>
                updatePreset(editing.id, {
                  opacity: Number(event.target.value),
                })
              }
            />
            <output>{editing.opacity}%</output>
          </label>

          <button
            type="button"
            className="goodnotes-pen-tray__reset"
            onClick={onReset}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
};

export default PenTray;
