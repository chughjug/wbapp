/**
 * Shared parts of the GoodNotes bar.
 *
 * HISTORY: this folder used to export `Taskbar`, a single centred bar. That
 * bar has been replaced by the three-zone shell in `goodnotes/shell`. What
 * stayed here is the plumbing both bars share and that is worth keeping
 * separately testable:
 *
 * - `tools.ts` — the ONLY place the chrome talks to `ExcalidrawImperativeAPI`
 *   (tool activation, ink presets, which tools persist after one use, and the
 *   reverse mapping from `appState` back onto a slot),
 * - `model.ts` — the declarative control model and the pure overflow solver,
 * - `icons.tsx` — the inline icon set,
 * - `Menu.tsx` / `Menu.scss` — the shared popover.
 *
 * New code should import {@link NavBar} and `PagePanel` from
 * `goodnotes/shell`. `Taskbar` below is a compatibility alias for hosts that
 * have not migrated yet.
 */

/**
 * @deprecated Renamed to `NavBar` and moved to `goodnotes/shell`. This alias
 * renders the new three-zone bar and accepts every prop the old taskbar took
 * (`onFuzzySelect`, `onImportPdf`, `onExportPdf`, `onOpenBackdrops`,
 * `onAddPage`, `pageCount`, `currentPage`, `suppressDefaultToolbar`, …), so an
 * existing call site keeps compiling; the new zones simply stay empty until
 * you pass their callbacks. See `goodnotes/shell/INTEGRATION.md`.
 */
export { NavBar as Taskbar } from "../shell/NavBar";
export type { NavBarProps as TaskbarProps } from "../shell/NavBar";

/**
 * @deprecated Renamed to `SUPPRESS_DEFAULT_CHROME_CLASS` in
 * `goodnotes/shell`; it now also hides the hamburger and top-right islands.
 */
export { SUPPRESS_DEFAULT_CHROME_CLASS as SUPPRESS_DEFAULT_TOOLBAR_CLASS } from "../shell/NavBar";

/** Editor plumbing. See `goodnotes/shell` for the documented re-exports. */
export {
  activateTool,
  toolFromAppState,
  snapStrokeWidth,
  PERSISTENT_TOOLS,
  isPersistentTool,
  DEFAULT_PEN,
  DEFAULT_HIGHLIGHTER,
  HIGHLIGHTER_MARKER,
  SHAPE_TOOL,
} from "./tools";
export type { ActivateToolOptions, StrokeWidthKey } from "./tools";

/** Control model + the pure overflow solver. */
export { planOverflow, LAYOUT, GROUP_ORDER } from "./model";
export type {
  TaskbarToolId,
  TaskbarShapeId,
  TaskbarGroupId,
  TaskbarControl,
  TaskbarMenuItem,
  OverflowPlan,
} from "./model";

/** The shared popover. */
export { TaskbarMenu } from "./Menu";
export type { TaskbarMenuProps, TaskbarMenuSection } from "./Menu";
