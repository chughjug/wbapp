/**
 * The only place the taskbar talks to the editor.
 *
 * Everything goes through the documented `ExcalidrawImperativeAPI` surface —
 * `setActiveTool` for the tool itself and `updateScene({ appState })` for the
 * stroke styling that makes "pen" and "highlighter" two different things on
 * top of the same `freedraw` tool. That is the pattern `goodnotes/pens`
 * already uses; the two modules agree on the highlighter marker so a stroke
 * started from either surface renders identically.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { PenPreset } from "../types";

import type { TaskbarShapeId, TaskbarToolId } from "./model";

/**
 * `customData` marker that makes the renderer composite a freedraw stroke with
 * `multiply`. Must stay byte-compatible with `HIGHLIGHTER_CUSTOM_DATA` in
 * `goodnotes/pens` — duplicated rather than imported because that module is
 * owned by another agent and importing it would couple their release to ours.
 */
export const HIGHLIGHTER_MARKER = { goodnotes: { highlighter: true } } as const;

/** Stroke widths Excalidraw can actually draw (`currentItemStrokeWidthKey`). */
export type StrokeWidthKey = "thin" | "medium" | "bold";

const WIDTH_VALUES: Record<StrokeWidthKey, number> = {
  thin: 0.5,
  medium: 1,
  bold: 2,
};

/** Snap an arbitrary width onto the three widths the editor supports. */
export const snapStrokeWidth = (width: number): StrokeWidthKey => {
  let best: StrokeWidthKey = "medium";
  let bestDelta = Infinity;
  for (const key of Object.keys(WIDTH_VALUES) as StrokeWidthKey[]) {
    const delta = Math.abs(WIDTH_VALUES[key] - width);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = key;
    }
  }
  return best;
};

/** Default ink when the host passes no preset. */
export const DEFAULT_PEN: PenPreset = {
  id: "taskbar-pen",
  label: "Pen",
  tool: "freedraw",
  color: "#1e1e1e",
  width: WIDTH_VALUES.medium,
  opacity: 100,
};

/** Default highlighter when the host passes no preset. */
export const DEFAULT_HIGHLIGHTER: PenPreset = {
  id: "taskbar-highlighter",
  label: "Highlighter",
  tool: "highlighter",
  color: "#ffd43b",
  width: WIDTH_VALUES.bold,
  opacity: 40,
};

/** Excalidraw tool type backing each shape entry. */
export const SHAPE_TOOL: Record<TaskbarShapeId, string> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  arrow: "arrow",
  line: "line",
};

const isUsable = (api: ExcalidrawImperativeAPI | null) =>
  !!api && !api.isDestroyed;

const applyInk = (api: ExcalidrawImperativeAPI, preset: PenPreset) => {
  api.setActiveTool({ type: "freedraw" });
  api.updateScene({
    appState: {
      currentItemStrokeColor: preset.color,
      currentItemStrokeWidthKey: snapStrokeWidth(preset.width),
      currentItemOpacity: Math.round(Math.min(100, Math.max(0, preset.opacity))),
      // a fresh object per activation so elements never share a reference
      currentItemCustomData:
        preset.tool === "highlighter"
          ? { goodnotes: { highlighter: true } }
          : null,
    },
  });
};

export interface ActivateToolOptions {
  pen?: PenPreset;
  highlighter?: PenPreset;
  shape?: TaskbarShapeId;
}

/**
 * Put the editor into the state the given taskbar slot represents.
 *
 * No-ops (rather than throwing) when the API is missing or destroyed, so the
 * bar stays clickable during mount and teardown.
 */
export const activateTool = (
  api: ExcalidrawImperativeAPI | null,
  tool: TaskbarToolId,
  options: ActivateToolOptions = {},
): void => {
  if (!isUsable(api)) {
    return;
  }
  const editor = api as ExcalidrawImperativeAPI;

  switch (tool) {
    case "select":
      editor.setActiveTool({ type: "selection" });
      return;
    case "pen":
      applyInk(editor, options.pen ?? DEFAULT_PEN);
      return;
    case "highlighter":
      applyInk(editor, options.highlighter ?? DEFAULT_HIGHLIGHTER);
      return;
    case "eraser":
      editor.setActiveTool({ type: "eraser" });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "text":
      editor.setActiveTool({ type: "text" });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "image":
      editor.setActiveTool({ type: "image" });
      return;
    case "shape": {
      const shape = options.shape ?? "rectangle";
      editor.setActiveTool({
        type: SHAPE_TOOL[shape] as "rectangle",
      });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    }
    default:
      return;
  }
};

/**
 * Map the editor's live `appState` back onto a taskbar slot, so the bar stays
 * correct when the tool changes behind its back (keyboard shortcut, Escape
 * after a drag, another goodnotes surface such as the pen tray).
 *
 * Returns `null` for tools the bar does not own (hand, laser, frame, lasso…) —
 * callers should then show nothing as pressed rather than lie.
 */
export const toolFromAppState = (appState: {
  activeTool?: { type?: string };
  currentItemCustomData?: Record<string, any> | null;
}): { tool: TaskbarToolId | null; shape: TaskbarShapeId | null } => {
  const type = appState.activeTool?.type;
  const highlighting = !!appState.currentItemCustomData?.goodnotes?.highlighter;

  switch (type) {
    case "selection":
      return { tool: "select", shape: null };
    case "freedraw":
      return { tool: highlighting ? "highlighter" : "pen", shape: null };
    case "eraser":
      return { tool: "eraser", shape: null };
    case "text":
      return { tool: "text", shape: null };
    case "image":
      return { tool: "image", shape: null };
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "arrow":
    case "line":
      return { tool: "shape", shape: type as TaskbarShapeId };
    default:
      return { tool: null, shape: null };
  }
};
