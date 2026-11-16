/**
 * GoodNotes-style **Active Tool Menu**.
 *
 * Selecting a tool reveals that tool's settings — by default as a horizontal
 * band directly under the nav bar, not as a panel floating over the canvas.
 *
 * ```tsx
 * import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
 *
 * const toolMenu = useActiveToolMenu({ excalidrawAPI });
 *
 * // a nav bar button — callback-shaped entry point
 * <button onClick={(event) => toolMenu.onToolSelect("pen", event)}>Pen</button>
 *
 * // band 3 of the shell: BETWEEN <NavBar /> and <div className="gn-shell-body">
 * <ToolMenu {...toolMenu.menuProps} />
 * ```
 *
 * Two design rules this module exists to enforce, both from a UI study of
 * GoodNotes:
 *
 * 1. **No nesting.** Ink colours (five swatches plus a custom picker) and the
 *    three stroke widths are direct, one-tap controls. GoodNotes buries them
 *    in submenus; everything here is one interaction deep.
 * 2. **Out of the canvas' way.** GoodNotes floats its menu over the page.
 *    The default placement here is `"docked"`: a band in normal document flow
 *    under the nav bar, spanning the content width, overlapping neither the
 *    page panel nor the canvas. `placement="floating"` keeps the original
 *    edge-snapped, draggable overlay for anyone who prefers it (snapped to an
 *    edge, but the position *along* the edge is the user's, remembered per
 *    edge in `localStorage`). The choice itself is persisted.
 *
 * See `INTEGRATION.md` in this folder for the exact `App.tsx` changes, and for
 * the honest list of controls that are NOT shipped because Excalidraw has
 * nothing to back them.
 */

/**
 * The panel. Docked (the default) it is a flow-layout band — render it
 * between the nav bar and `.gn-shell-body`. Floating it is a fixed overlay and
 * can be rendered anywhere.
 */
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
 * The docked / floating choice, and its `localStorage` persistence.
 */
export {
  DEFAULT_TOOL_MENU_PLACEMENT,
  TOOL_MENU_PLACEMENTS,
  TOOL_MENU_PLACEMENT_STORAGE_KEY,
  loadToolMenuPlacement,
  saveToolMenuPlacement,
} from "./position";
export type { ToolMenuPlacement } from "./position";

/**
 * The edge-snapping model used by `placement="floating"`, and its
 * `localStorage` persistence.
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
