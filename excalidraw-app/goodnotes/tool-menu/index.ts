/**
 * GoodNotes-style **Active Tool Menu**.
 *
 * Tapping the tool that is already active reveals that tool's settings — by
 * default as a compact popover pinned to the button that was tapped, which
 * costs no screen space at all when it is closed.
 *
 * ```tsx
 * import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
 *
 * const toolMenu = useActiveToolMenu({ excalidrawAPI });
 *
 * // the nav bar's hook point: it passes the button element as the anchor
 * <NavBar onActiveToolMenu={(tool, anchor) => toolMenu.onToolSelect(tool, anchor)} />
 *
 * // anywhere in the tree — the popover portals itself onto document.body,
 * // and renders nothing at all while closed
 * <ToolMenu {...toolMenu.menuProps} />
 * ```
 *
 * Two design rules this module exists to enforce, both from a UI study of
 * GoodNotes:
 *
 * 1. **No nesting.** Ink colours (five swatches plus a custom picker) and the
 *    three stroke widths are direct, one-tap controls. GoodNotes buries them
 *    in submenus; everything here is one interaction deep.
 * 2. **Zero cost at rest.** The default placement is `"anchored"`: a popover
 *    pinned to the tool button that opened it, mounted only while open, so
 *    the settings cost 0 px² of permanent chrome instead of a 1194×53 band.
 *    It dismisses on an outside click, on Escape, and as soon as a mark is
 *    made. `"docked"` (the band under the nav bar) and `"floating"` (the
 *    edge-snapped draggable overlay, whose position along the edge is the
 *    user's and is remembered per edge) are still available; the choice is
 *    persisted in `localStorage` and subscribable.
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
  subscribeToolMenuPlacement,
} from "./position";
export type { ToolMenuPlacement } from "./position";

/**
 * The anchored popover's geometry solver — which side of the button it opens
 * on, how it is clamped to the viewport, and where its arrow points.
 */
export {
  ANCHOR_GAP,
  ANCHOR_VIEWPORT_MARGIN,
  anchoredPlacement,
} from "./position";
export type { AnchoredPlacement } from "./position";

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
