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

import {
  DEFAULT_PEN_WIDTH,
  PEN_WIDTHS,
  clampPenWidth,
  loadPenWidths,
  savePenWidth,
  snapPenWidth,
} from "../pens/presets";

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

export type ToolMenuShapeId = typeof SHAPE_TOOL_TYPES[number];

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
  /**
   * Exact freedraw stroke width, in `element.strokeWidth` units. Clamped to
   * `[MIN_PEN_WIDTH, MAX_PEN_WIDTH]`. Writes
   * `appState.currentItemFreedrawStrokeWidth`, and keeps the three-step
   * `currentItemStrokeWidthKey` pointed at the nearest key so anything that
   * still reads the key (shapes, Excalidraw's own property panel) stays
   * coherent.
   */
  width?: number;
  /**
   * The three-step key, for callers that genuinely want quantised widths
   * (shapes). Setting it *clears* the exact freedraw width, so the key wins —
   * otherwise the two would silently disagree.
   */
  widthKey?: ToolMenuWidthKey;
  /** 0–100, clamped. */
  opacity?: number;
  /** `"variable"` = pressure/velocity taper, `"constant"` = even width. */
  variability?: StrokeVariability;
}

/**
 * The exact width new freedraw strokes will use, resolved the same way the
 * editor resolves it: the override if set, else the three-step key.
 */
export const readInkWidth = (
  appState: Pick<
    AppState,
    "currentItemFreedrawStrokeWidth" | "currentItemStrokeWidthKey"
  >,
): number => {
  const exact = appState.currentItemFreedrawStrokeWidth;
  if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) {
    return exact;
  }
  return (
    PEN_WIDTHS[appState.currentItemStrokeWidthKey as ToolMenuWidthKey] ??
    DEFAULT_PEN_WIDTH
  );
};

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
  if (patch.width !== undefined) {
    const width = clampPenWidth(patch.width);
    appState.currentItemFreedrawStrokeWidth = width;
    appState.currentItemStrokeWidthKey = snapPenWidth(width);
  }
  if (patch.widthKey !== undefined) {
    appState.currentItemStrokeWidthKey = patch.widthKey;
    appState.currentItemFreedrawStrokeWidth = null;
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

  // each ink tool carries its own remembered nib, the way a real pen case
  // does: picking the highlighter must not inherit the pen's 0.2
  const widths = loadPenWidths();

  switch (tool) {
    case "pen":
      api.setActiveTool({ type: "freedraw", locked });
      mergeAppState(api, {
        currentItemCustomData: null,
        currentItemFreedrawStrokeWidth: clampPenWidth(widths.pen),
        currentItemStrokeWidthKey: snapPenWidth(widths.pen),
      });
      return;
    case "highlighter":
      api.setActiveTool({ type: "freedraw", locked });
      mergeAppState(api, {
        // a fresh object per activation so elements never share a reference
        currentItemCustomData: { goodnotes: { highlighter: true } },
        currentItemFreedrawStrokeWidth: clampPenWidth(widths.highlighter),
        currentItemStrokeWidthKey: snapPenWidth(widths.highlighter),
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
  const tool = preset.tool === "highlighter" ? "highlighter" : "pen";
  activateTool(api, tool);
  applyInk(api, {
    color: preset.color,
    width: preset.width,
    opacity: preset.opacity,
  });
  savePenWidth(tool, preset.width);
};

/** Width key → the `PenPreset.width` number used by the presets module. */
export const widthKeyToPresetWidth = (key: ToolMenuWidthKey): number =>
  PEN_WIDTHS[key];

/**
 * Push the width remembered for `tool` into the editor, unconditionally.
 *
 * Called when the ink tool *changes*, so the highlighter never inherits the
 * pen's 0.2 nib (and vice versa) — the way a real pen case works. Returns the
 * width that was applied.
 */
export const applyRememberedInkWidth = (
  api: ExcalidrawImperativeAPI | null,
  tool: "pen" | "highlighter",
): number | null => {
  if (!isUsable(api)) {
    return null;
  }
  const width = clampPenWidth(loadPenWidths()[tool]);
  mergeAppState(api, {
    currentItemFreedrawStrokeWidth: width,
    currentItemStrokeWidthKey: snapPenWidth(width),
  });
  return width;
};

/**
 * Push the remembered ink width into a freshly-created editor, so a width
 * chosen before a reload is the width the first stroke after it draws with.
 *
 * No-op once an exact width is set, so it can never stomp a document's own
 * saved `appState` or a width the user just picked. Safe to call on every
 * render; it is idempotent.
 */
export const restoreRememberedInkWidth = (
  api: ExcalidrawImperativeAPI | null,
): void => {
  if (!isUsable(api)) {
    return;
  }
  const appState = api.getAppState();
  if (typeof appState.currentItemFreedrawStrokeWidth === "number") {
    return;
  }
  applyRememberedInkWidth(
    api,
    isHighlighterActive(appState) ? "highlighter" : "pen",
  );
};

/* -------------------------------------------------------------------------- */
/*  Tools that exist in the engine but have no button in the GoodNotes bar     */
/* -------------------------------------------------------------------------- */

/**
 * Excalidraw tools that are fully implemented but that the redesigned bar
 * never surfaced. These are *not* {@link ToolMenuToolId}s: none of them has
 * styling to show, so activating one deliberately closes the settings popover
 * (`toolFromAppState` returns `null` for them).
 *
 * The three shipped here are the ones that earn their place in a note-taking
 * app; see `INTEGRATION.md` § "Engine tools we did NOT surface" for the ones
 * that do not.
 */
export const EXTRA_TOOLS = ["laser", "lasso", "hand"] as const;

export type ExtraToolId = typeof EXTRA_TOOLS[number];

export const EXTRA_TOOL_LABELS: Record<ExtraToolId, string> = {
  laser: "Laser pointer",
  lasso: "Lasso select",
  hand: "Pan",
};

/**
 * The subset the popover actually renders. Two of the three are left out, and
 * both omissions were decided by measurement, not taste:
 *
 * - `lasso` — the GoodNotes nav bar already carries a lasso button ("Lasso
 *   select (smart selection)"). A second one behind **More** is duplicate
 *   chrome.
 * - `hand` — the nav bar now carries a Hand button of its own (bound to `H`),
 *   so listing it here too would be the same duplicate chrome as `lasso`.
 *   It is no longer a dead control: the scroll constraints the paged surface
 *   used to pin (measured 378.07 / 21.07 before and after a wheel, a
 *   space-drag and a hand drag alike) are lifted in whiteboard mode and
 *   relaxed on paper, and a hand drag now moves the viewport 28.00px.
 *
 * Both stay in {@link EXTRA_TOOLS}: {@link activateExtraTool} is the public
 * way for any surface to reach them.
 */
export const POPOVER_EXTRA_TOOLS: readonly ExtraToolId[] = ["laser"];

/** Is one of {@link EXTRA_TOOLS} the editor's active tool? */
export const extraToolFromAppState = (
  appState: Pick<AppState, "activeTool">,
): ExtraToolId | null => {
  const type = appState.activeTool.type;
  return (EXTRA_TOOLS as readonly string[]).includes(type)
    ? (type as ExtraToolId)
    : null;
};

/**
 * Activate a laser pointer / lasso / pan. Real `appState.activeTool` types
 * that `packages/excalidraw` already implements end to end — the laser gets
 * its fading trail from `laserTrails.ts`, the lasso its freehand selection
 * path, the hand its drag-to-pan.
 *
 * `locked: false` on the laser: it is a presenting mode you leave by picking
 * a pen, not a one-shot.
 */
export const activateExtraTool = (
  api: ExcalidrawImperativeAPI | null,
  tool: ExtraToolId,
): void => {
  if (!isUsable(api)) {
    return;
  }
  api.setActiveTool({ type: tool, locked: false });
};

/**
 * Toggle Excalidraw's shape snapping (`appState.objectsSnapModeEnabled`) —
 * the alignment guides that make two boxes in a diagram line up. Real state
 * the editor reads in `getSnapLines`; normally only reachable from the canvas
 * context menu, which the GoodNotes shell replaces.
 */
export const setObjectSnapping = (
  api: ExcalidrawImperativeAPI | null,
  enabled: boolean,
): void => {
  if (!isUsable(api)) {
    return;
  }
  mergeAppState(api, { objectsSnapModeEnabled: enabled });
};

export const isObjectSnappingEnabled = (
  appState: Pick<AppState, "objectsSnapModeEnabled">,
): boolean => appState.objectsSnapModeEnabled === true;

/**
 * Open Excalidraw's eye dropper, so the next canvas tap sets the current ink
 * colour from a pixel already on the page.
 *
 * `App.openEyeDropper` is private and the imperative API exposes no wrapper,
 * so the only non-`packages/` way in is the editor's own keyboard shortcut
 * (<kbd>Shift</kbd>+<kbd>S</kbd>, handled in `App.onKeyDown`). We dispatch
 * that event on the editor container the handler is bound to — i.e. we take
 * exactly the path a user pressing the key takes, rather than reaching into
 * editor internals or patching `packages/`.
 *
 * Returns `false` when no editor container could be found, so a caller can
 * avoid showing a control that would do nothing.
 */
export const openEyeDropper = (
  api: ExcalidrawImperativeAPI | null,
  container?: HTMLElement | null,
): boolean => {
  if (!isUsable(api) || typeof document === "undefined") {
    return false;
  }
  const target =
    container ??
    document.querySelector<HTMLElement>(".excalidraw-container") ??
    document.querySelector<HTMLElement>(".excalidraw");
  if (!target) {
    return false;
  }
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "S",
      code: "KeyS",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
};
