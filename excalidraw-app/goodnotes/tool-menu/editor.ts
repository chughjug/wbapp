/**
 * The only place the Active Tool Menu talks to the editor.
 *
 * Everything goes through the documented `ExcalidrawImperativeAPI` surface:
 * `setActiveTool` for the tool itself and `updateScene({ appState })` for the
 * `currentItem*` styling that newly drawn elements inherit. This is the same
 * pattern `goodnotes/pens` uses, so a stroke started from either surface is
 * byte-identical.
 *
 * NOTHING in this file invents editor state: every control the panel renders
 * maps onto an `AppState` key that Excalidraw genuinely reads when it creates
 * an element. Controls with no such backing are deliberately not shipped —
 * see `INTEGRATION.md` § "What is NOT wired, and why".
 */

import type { StrokeVariability } from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { PEN_WIDTHS, snapPenWidth } from "../pens/presets";

import type { PenPreset } from "../types";

/** Stroke widths Excalidraw can actually draw (`currentItemStrokeWidthKey`). */
export type ToolMenuWidthKey = "thin" | "medium" | "bold";

/**
 * The tool identities the panel knows about. These are *panel* identities, not
 * Excalidraw tool types: "pen" and "highlighter" are both the `freedraw` tool,
 * told apart by the highlighter `customData` marker.
 */
export type ToolMenuToolId =
  | "pen"
  | "highlighter"
  | "eraser"
  | "shape"
  | "text";

/**
 * Marker written into `appState.currentItemCustomData` so the renderer
 * composites the stroke with `multiply`. Byte-compatible with
 * `HIGHLIGHTER_CUSTOM_DATA` in `goodnotes/pens` (duplicated rather than
 * imported: that module is being retired and owns a component we do not want
 * to pull into this bundle).
 */
export const HIGHLIGHTER_MARKER = { goodnotes: { highlighter: true } } as const;

/** Excalidraw tool types that the panel treats as "a shape". */
export const SHAPE_TOOL_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
] as const;

export type ToolMenuShapeId = (typeof SHAPE_TOOL_TYPES)[number];

const SHAPE_TOOL_SET: ReadonlySet<string> = new Set(SHAPE_TOOL_TYPES);

/**
 * `updateScene`'s `appState` parameter is typed `Pick<AppState, K>`, which
 * cannot express "some of these keys" when the key set is decided at runtime.
 * The editor merges whatever it is handed (`this.setState(appState)` — see
 * `App.updateScene`), so a partial is correct at runtime. This is the only
 * cast in the module and the only place it is needed.
 */
const mergeAppState = (
  api: ExcalidrawImperativeAPI,
  patch: Partial<AppState>,
): void => {
  api.updateScene({ appState: patch as Pick<AppState, keyof AppState> });
};

const isUsable = (
  api: ExcalidrawImperativeAPI | null,
): api is ExcalidrawImperativeAPI => !!api && !api.isDestroyed;

/** Is the editor currently stamping the highlighter marker onto new strokes? */
export const isHighlighterActive = (
  appState: Pick<AppState, "currentItemCustomData">,
): boolean =>
  (appState.currentItemCustomData as { goodnotes?: { highlighter?: unknown } })
    ?.goodnotes?.highlighter === true;

/**
 * Map the editor's real `appState.activeTool` onto a panel identity. Returns
 * `null` for tools the panel has nothing genuine to offer for (selection,
 * lasso, hand, frame, laser, image, embeddable, …) — the panel closes rather
 * than showing an empty shell.
 */
export const toolFromAppState = (
  appState: Pick<AppState, "activeTool" | "currentItemCustomData">,
): ToolMenuToolId | null => {
  const type = appState.activeTool.type;
  if (type === "freedraw") {
    return isHighlighterActive(appState) ? "highlighter" : "pen";
  }
  if (type === "eraser") {
    return "eraser";
  }
  if (type === "text") {
    return "text";
  }
  if (SHAPE_TOOL_SET.has(type)) {
    return "shape";
  }
  return null;
};

/** The shape tool currently active, or `null` when a shape isn't active. */
export const shapeFromAppState = (
  appState: Pick<AppState, "activeTool">,
): ToolMenuShapeId | null =>
  SHAPE_TOOL_SET.has(appState.activeTool.type)
    ? (appState.activeTool.type as ToolMenuShapeId)
    : null;

/** Everything the ink controls can change, all optional. */
export interface InkPatch {
  color?: string;
  widthKey?: ToolMenuWidthKey;
  /** 0–100, clamped. */
  opacity?: number;
  /** `"variable"` = pressure/velocity taper, `"constant"` = even width. */
  variability?: StrokeVariability;
}

/**
 * Push ink styling into the editor. Only the keys present in `patch` are
 * written, so a colour tap never resets the width.
 */
export const applyInk = (
  api: ExcalidrawImperativeAPI | null,
  patch: InkPatch,
): void => {
  if (!isUsable(api)) {
    return;
  }
  const appState: Partial<AppState> = {};
  if (patch.color !== undefined) {
    appState.currentItemStrokeColor = patch.color;
  }
  if (patch.widthKey !== undefined) {
    appState.currentItemStrokeWidthKey = patch.widthKey;
  }
  if (patch.opacity !== undefined) {
    appState.currentItemOpacity = Math.round(
      Math.min(100, Math.max(0, patch.opacity)),
    );
  }
  if (patch.variability !== undefined) {
    appState.currentItemStrokeVariability = patch.variability;
  }
  mergeAppState(api, appState);
};

/** Styling that only applies to shapes. */
export interface ShapePatch {
  strokeColor?: string;
  backgroundColor?: string;
  widthKey?: ToolMenuWidthKey;
  fillStyle?: AppState["currentItemFillStyle"];
  roundness?: AppState["currentItemRoundness"];
  opacity?: number;
}

export const applyShapeStyle = (
  api: ExcalidrawImperativeAPI | null,
  patch: ShapePatch,
): void => {
  if (!isUsable(api)) {
    return;
  }
  const appState: Partial<AppState> = {};
  if (patch.strokeColor !== undefined) {
    appState.currentItemStrokeColor = patch.strokeColor;
  }
  if (patch.backgroundColor !== undefined) {
    appState.currentItemBackgroundColor = patch.backgroundColor;
  }
  if (patch.widthKey !== undefined) {
    appState.currentItemStrokeWidthKey = patch.widthKey;
  }
  if (patch.fillStyle !== undefined) {
    appState.currentItemFillStyle = patch.fillStyle;
  }
  if (patch.roundness !== undefined) {
    appState.currentItemRoundness = patch.roundness;
  }
  if (patch.opacity !== undefined) {
    appState.currentItemOpacity = Math.round(
      Math.min(100, Math.max(0, patch.opacity)),
    );
  }
  mergeAppState(api, appState);
};

/** Styling that only applies to text. */
export interface TextPatch {
  color?: string;
  fontSize?: number;
  fontFamily?: AppState["currentItemFontFamily"];
  opacity?: number;
}

export const applyTextStyle = (
  api: ExcalidrawImperativeAPI | null,
  patch: TextPatch,
): void => {
  if (!isUsable(api)) {
    return;
  }
  const appState: Partial<AppState> = {};
  if (patch.color !== undefined) {
    appState.currentItemStrokeColor = patch.color;
  }
  if (patch.fontSize !== undefined) {
    appState.currentItemFontSize = patch.fontSize;
  }
  if (patch.fontFamily !== undefined) {
    appState.currentItemFontFamily = patch.fontFamily;
  }
  if (patch.opacity !== undefined) {
    appState.currentItemOpacity = Math.round(
      Math.min(100, Math.max(0, patch.opacity)),
    );
  }
  mergeAppState(api, appState);
};

/**
 * Activate a panel tool in the editor. `shape` activates `rectangle` unless a
 * shape tool is already active (so re-opening the shape panel doesn't silently
 * change the user's shape).
 */
export const activateTool = (
  api: ExcalidrawImperativeAPI | null,
  tool: ToolMenuToolId,
  opts: { locked?: boolean; shape?: ToolMenuShapeId } = {},
): void => {
  if (!isUsable(api)) {
    return;
  }
  const locked = opts.locked ?? api.getAppState().activeTool.locked;

  switch (tool) {
    case "pen":
      api.setActiveTool({ type: "freedraw", locked });
      api.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "highlighter":
      api.setActiveTool({ type: "freedraw", locked });
      api.updateScene({
        appState: {
          // a fresh object per activation so elements never share a reference
          currentItemCustomData: { goodnotes: { highlighter: true } },
        },
      });
      return;
    case "eraser":
      api.setActiveTool({ type: "eraser", locked });
      return;
    case "text":
      api.setActiveTool({ type: "text", locked });
      api.updateScene({ appState: { currentItemCustomData: null } });
      return;
    case "shape": {
      const current = shapeFromAppState(api.getAppState());
      api.setActiveTool({ type: opts.shape ?? current ?? "rectangle", locked });
      api.updateScene({ appState: { currentItemCustomData: null } });
    }
  }
};

/**
 * Toggle Excalidraw's tool lock (the padlock): when on, the tool stays active
 * after a stroke instead of reverting to selection. Real `appState` state —
 * `activeTool.locked`.
 */
export const setToolLocked = (
  api: ExcalidrawImperativeAPI | null,
  locked: boolean,
): void => {
  if (!isUsable(api)) {
    return;
  }
  const { activeTool } = api.getAppState();
  if (activeTool.type === "custom") {
    return;
  }
  api.setActiveTool({ type: activeTool.type, locked });
};

/** Apply a saved pen preset (tool + colour + width + opacity) in one call. */
export const applyPreset = (
  api: ExcalidrawImperativeAPI | null,
  preset: PenPreset,
): void => {
  if (!isUsable(api)) {
    return;
  }
  if (preset.tool === "eraser") {
    activateTool(api, "eraser");
    return;
  }
  activateTool(api, preset.tool === "highlighter" ? "highlighter" : "pen");
  applyInk(api, {
    color: preset.color,
    widthKey: snapPenWidth(preset.width),
    opacity: preset.opacity,
  });
};

/** Width key → the `PenPreset.width` number used by the presets module. */
export const widthKeyToPresetWidth = (key: ToolMenuWidthKey): number =>
  PEN_WIDTHS[key];
