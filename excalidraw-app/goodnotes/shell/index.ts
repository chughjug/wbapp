/**
 * GoodNotes editor shell — ONE navigation bar plus the left page panel.
 *
 * This module replaces the six control surfaces the editor used to have (a
 * centred taskbar, Excalidraw's hamburger island, its top-right island, the
 * shapes toolbar, the floating pen tray and the right-hand page sidebar) with
 * two objects:
 *
 * 1. {@link NavBar} — one bar, three explicit zones:
 *    - LEFT: page-panel toggle (with the page counter), search, Write/Read
 *    - CENTRE: tools only — select, lasso, pen, highlighter, eraser │
 *      shapes, text, image, sticky
 *    - RIGHT: undo/redo, import PDF, add page │ Share (primary), "…"
 * 2. {@link PagePanel} — the ~188px left rail of page thumbnails.
 *
 * Both default to `placement="flow"`: they are BANDS in the host's layout
 * (document tabs / nav bar / page panel + canvas), not overlays. The helper
 * classes `gn-shell-layout`, `gn-shell-body` and `gn-shell-canvas` ship with
 * `NavBar.scss`. Pass `placement="fixed"` for the old floating behaviour.
 *
 * The bottom-left zoom pill is deliberately left alone.
 *
 * ```tsx
 * import { NavBar, PagePanel } from "./goodnotes/shell";
 *
 * const [pagesOpen, setPagesOpen] = useState(true);
 * const [mode, setMode] = useState<ShellMode>("write");
 *
 * <NavBar
 *   excalidrawAPI={excalidrawAPI}
 *   suppressDefaultChrome
 *   pagePanelOpen={pagesOpen}
 *   onTogglePagePanel={() => setPagesOpen((open) => !open)}
 *   onToggleSearch={() => excalidrawAPI?.updateScene({ appState: { openSidebar: null } })}
 *   mode={mode}
 *   onModeChange={setMode}
 *   onUndo={() => excalidrawAPI?.history.undo()}
 *   onRedo={() => excalidrawAPI?.history.redo()}
 *   onShare={() => setShareOpen(true)}
 *   // …plus every callback the old taskbar took; omit one and its control
 *   // is simply not rendered
 * />
 * <PagePanel excalidrawAPI={excalidrawAPI} open={pagesOpen} onClose={() => setPagesOpen(false)} />
 * ```
 *
 * What this module owns: the shell, the three-zone layout, the overflow
 * behaviour, the keyboard model and the editor plumbing for the core tools.
 * What it does NOT own: fuzzy select, PDF import/export, image backdrops,
 * pages (it wraps `goodnotes/pages`) and TOOL SETTINGS — colours and widths
 * belong to the floating Active Tool Menu, for which the bar exposes only the
 * `onActiveToolMenu` hook point.
 *
 * See `INTEGRATION.md` in this folder for copy-pasteable `App.tsx` changes.
 */

/**
 * The bar. The only component you need for the chrome.
 * Every prop is documented on {@link NavBarProps}; a missing callback hides
 * its control.
 */
export { NavBar } from "./NavBar";
export type { NavBarProps, ShellMode, ShellPlacement } from "./NavBar";

/**
 * Body classes this module toggles. `SUPPRESS_DEFAULT_CHROME_CLASS` is added
 * while `suppressDefaultChrome` is set (shapes toolbar + hamburger island +
 * top-right island hidden, zoom pill untouched); `PAGE_PANEL_OPEN_CLASS` is
 * added while the page panel is open. Both are removed on unmount — the
 * suppression is opt-in and reversible.
 */
export {
  SUPPRESS_DEFAULT_CHROME_CLASS,
  PAGE_PANEL_OPEN_CLASS,
} from "./NavBar";

/** The left page rail. Wraps `goodnotes/pages`' `PageSidebar`. */
export { PagePanel, PAGE_PANEL_WIDTH } from "./PagePanel";
export type { PagePanelProps } from "./PagePanel";

/**
 * Drive the editor without the UI — the same code path the bar's buttons use,
 * useful for host-level keyboard shortcuts.
 *
 * `PERSISTENT_TOOLS` / `isPersistentTool` document which slots stay active
 * after one use (pen, highlighter, eraser) and which revert to select
 * (shape, text, image, sticky note).
 */
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
} from "../taskbar/tools";
export type { ActivateToolOptions, StrokeWidthKey } from "../taskbar/tools";

/** Model types, for hosts that want to mirror or drive the bar's state. */
export type {
  TaskbarToolId as ShellToolId,
  TaskbarShapeId as ShellShapeId,
  TaskbarGroupId as ShellGroupId,
  TaskbarControl as ShellControl,
  TaskbarMenuItem as ShellMenuItem,
} from "../taskbar/model";

/** The pure overflow solver behind the centre cluster, and its constants. */
export { planOverflow, LAYOUT, GROUP_ORDER } from "../taskbar/model";
export type { OverflowPlan } from "../taskbar/model";

/** The shared popover used by the Shapes, overflow and "…" controls. */
export { TaskbarMenu as ShellMenu } from "../taskbar/Menu";
export type {
  TaskbarMenuProps as ShellMenuProps,
  TaskbarMenuSection as ShellMenuSection,
} from "../taskbar/Menu";
