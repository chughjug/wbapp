/**
 * GoodNotes-style **Active Tool Menu**.
 *
 * Selecting a tool opens a small floating panel with that tool's settings,
 * instead of a permanently-docked properties ribbon.
 *
 * ```tsx
 * import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
 *
 * const toolMenu = useActiveToolMenu({ excalidrawAPI });
 *
 * // a nav bar button — callback-shaped entry point
 * <button onClick={(event) => toolMenu.onToolSelect("pen", event)}>Pen</button>
 *
 * // inside <Excalidraw>
 * <ToolMenu {...toolMenu.menuProps} />
 * ```
 *
 * Two design rules this module exists to enforce, both from a UI study of
 * GoodNotes:
 *
 * 1. **No nesting.** Ink colours (five swatches plus a custom picker) and the
 *    three stroke widths are direct, one-tap controls. GoodNotes buries them
 *    in submenus; everything here is one interaction deep.
 * 2. **Draggable, not centred.** GoodNotes snaps its floating menu to the exact
 *    centre of a screen edge, which is out of reach for someone holding a
 *    tablet by the bottom. This panel snaps to an edge but the position *along*
 *    the edge is the user's, remembered per edge in `localStorage`, and the
 *    default (left edge, 68% down) never covers the centre of the canvas.
 *
 * See `INTEGRATION.md` in this folder for the exact `App.tsx` changes, and for
 * the honest list of controls that are NOT shipped because Excalidraw has
 * nothing to back them.
 */

/** The floating panel. Render it as a child of `<Excalidraw>`. */
export { ToolMenu } from "./ToolMenu";
export type { ToolMenuProps } from "./ToolMenu";

/**
 * Subscribes to the editor's real `appState.activeTool` and owns the panel's
 * open/closed state. Returns `menuProps` to spread onto {@link ToolMenu}, the
 * `onToolSelect` callback for a nav bar, and imperative `open` / `close` /
 * `toggle`.
 */
export { useActiveToolMenu } from "./useActiveToolMenu";
export type {
  ActiveToolMenuController,
  UseActiveToolMenuOptions,
} from "./useActiveToolMenu";

/**
 * Drive the editor without the UI — the same code path the panel's controls
 * use, for host-level shortcuts or a second surface.
 */
export {
  activateTool,
  applyInk,
  applyPreset,
  applyShapeStyle,
  applyTextStyle,
  setToolLocked,
  toolFromAppState,
  shapeFromAppState,
  isHighlighterActive,
  widthKeyToPresetWidth,
  HIGHLIGHTER_MARKER,
  SHAPE_TOOL_TYPES,
} from "./editor";
export type {
  InkPatch,
  ShapePatch,
  TextPatch,
  ToolMenuShapeId,
  ToolMenuToolId,
  ToolMenuWidthKey,
} from "./editor";

/**
 * The edge-snapping placement model and its `localStorage` persistence.
 * Exported mainly so it can be unit-tested, but also usable if a host wants to
 * reset or preset the panel's position.
 */
export {
  DEFAULT_TOOL_MENU_POSITION,
  EDGE_MARGIN,
  NARROW_VIEWPORT_WIDTH,
  defaultPositionForViewport,
  TOOL_MENU_EDGES,
  TOOL_MENU_POSITION_STORAGE_KEY,
  describePosition,
  loadToolMenuPosition,
  moveByKeyboard,
  placementToPixels,
  saveToolMenuPosition,
  snapToEdge,
} from "./position";
export type { ToolMenuEdge, ToolMenuPosition } from "./position";

/**
 * Re-exported from `goodnotes/pens` (not redefined): the panel reads and
 * writes the very same `goodnotes-pens` localStorage payload, so pens saved
 * with the retired PenTray are not orphaned.
 */
export {
  PENS_STORAGE_KEY,
  PEN_WIDTHS,
  loadPenPresets,
  savePenPresets,
  resetPenPresets,
  snapPenWidth,
} from "../pens/presets";
export type { PenPreset } from "../types";
