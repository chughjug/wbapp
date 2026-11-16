/**
 * The only place the nav bar talks to the editor.
 *
 * Everything goes through the documented `ExcalidrawImperativeAPI` surface —
 * `setActiveTool` for the tool itself and `updateScene({ appState })` for the
 * stroke styling that makes "pen" and "highlighter" two different things on
 * top of the same `freedraw` tool. That is the pattern `goodnotes/pens`
 * already uses; the two modules agree on the highlighter marker so a stroke
 * started from either surface renders identically.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { loadPenWidths, savePenWidth } from "../pens";

import type { PenPreset } from "../types";

import type { TaskbarShapeId, TaskbarToolId } from "./model";

/**
 * Tools that STAY ACTIVE after one use, because the user's next action is
 * almost always "do it again": ink and erasing.
 *
 * Everything else (shape, text, image, sticky note) is one-shot — after a
 * single placement the editor falls back to the selection tool, because the
 * next action is almost always "move / resize what I just placed".
 *
 * Mechanically this is Excalidraw's own tool lock: `setActiveTool({ locked })`
 * sets `appState.activeTool.locked`, and the editor reverts to
 * `preferredSelectionTool` on pointer-up for every unlocked tool
 * (`App#isToolLocked`). We therefore do not re-implement reversion, we just
 * declare which slots are sticky and let the editor do it.
 *
 * NOTE on the word "sticky": `"sticky"` the tool id means a sticky NOTE.
 * Whether a tool persists is `isPersistentTool`, never "sticky".
 */
export const PERSISTENT_TOOLS: readonly TaskbarToolId[] = [
  "pen",
  "highlighter",
  "eraser",
];

/** @see PERSISTENT_TOOLS */
export const isPersistentTool = (tool: TaskbarToolId): boolean =>
  PERSISTENT_TOOLS.includes(tool);

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

/**
 * @param explicit `true` when the host named this preset (a saved pen), in
 * which case its width is authoritative. When the bar falls back to
 * {@link DEFAULT_PEN} / {@link DEFAULT_HIGHLIGHTER} the nib the user last
 * chose for that tool wins instead — a generic default must not silently
 * reset a 0.2 margin pen to 1.
 */
const applyInk = (
  api: ExcalidrawImperativeAPI,
  preset: PenPreset,
  explicit: boolean,
) => {
  const tool = preset.tool === "highlighter" ? "highlighter" : "pen";
  const width = explicit ? preset.width : loadPenWidths()[tool];
  // locked: ink is a persistent tool — see PERSISTENT_TOOLS
  api.setActiveTool({ type: "freedraw", locked: true });
  api.updateScene({
    appState: {
      currentItemStrokeColor: preset.color,
      // the key is only the three-step fallback; the exact width is what
      // actually draws, so a 0.2 margin pen chosen in the bar is no longer
      // rounded up to 0.5
      currentItemStrokeWidthKey: snapStrokeWidth(width),
      currentItemFreedrawStrokeWidth: width,
      currentItemOpacity: Math.round(
        Math.min(100, Math.max(0, preset.opacity)),
      ),
      // a fresh object per activation so elements never share a reference
      currentItemCustomData:
        preset.tool === "highlighter"
          ? { goodnotes: { highlighter: true } }
          : null,
    },
  });
  // record it as this tool's remembered nib, so the tool menu's
  // restore-on-tool-change does not immediately overwrite it
  savePenWidth(tool, width);
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
      editor.setActiveTool({ type: "selection", locked: false });
      return;
    case "lasso":
      editor.setActiveTool({ type: "lasso", locked: false });
      return;
    case "pen":
      applyInk(editor, options.pen ?? DEFAULT_PEN, !!options.pen);
      return;
    case "highlighter":
      applyInk(
        editor,
        options.highlighter ?? DEFAULT_HIGHLIGHTER,
        !!options.highlighter,
      );
      return;
    case "eraser":
      editor.setActiveTool({ type: "eraser", locked: true });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "text":
      editor.setActiveTool({ type: "text", locked: false });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "image":
      editor.setActiveTool({ type: "image", locked: false });
      return;
    case "sticky":
      // Excalidraw has a first-class `stickynote` tool in this fork; one
      // placement then back to select.
      editor.setActiveTool({ type: "stickynote", locked: false });
      editor.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "shape": {
      const shape = options.shape ?? "rectangle";
      editor.setActiveTool({
        type: SHAPE_TOOL[shape] as "rectangle",
        locked: false,
      });
      editor.updateScene({ appState: { currentItemCustomData: null } });
    }
  }
};

/**
 * Map the editor's live `appState` back onto a taskbar slot, so the bar stays
 * correct when the tool changes behind its back (keyboard shortcut, Escape
 * after a drag, another goodnotes surface such as the pen tray).
 *
 * Returns `null` for tools the bar does not own (hand, laser, frame…) —
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
    case "lasso":
      return { tool: "lasso", shape: null };
    case "freedraw":
      return { tool: highlighting ? "highlighter" : "pen", shape: null };
    case "eraser":
      return { tool: "eraser", shape: null };
    case "text":
      return { tool: "text", shape: null };
    case "image":
      return { tool: "image", shape: null };
    case "stickynote":
      return { tool: "sticky", shape: null };
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
