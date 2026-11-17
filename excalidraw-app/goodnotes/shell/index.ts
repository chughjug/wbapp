/**
 * GoodNotes editor shell — ONE floating bar, plus the page overlay.
 *
 * ## What changed, and why
 *
 * Measured on an iPad Pro 11" viewport (1194x834) with a document open, the
 * editor's *permanent* chrome was 28.5% of the screen across six surfaces:
 * the page rail (189x656), a tool-settings band, bottom page controls, the
 * tab strip, the nav bar and the zoom pill. This module collapses the parts
 * it owns into a single ~46px pill that floats over the canvas:
 *
 * ```
 *          ┌───────────────────────────────────────────┐
 *          │ ⌂ │ ▤ 2/12 │ ✒ ▰ ⌫ ◌ ▶ ✋ │ + │ … │
 *          └───────────────────────────────────────────┘
 * ```
 *
 * Three ideas, and that is the whole module:
 *
 * 1. {@link FloatingBar} — `position: absolute`, centred near the top of the
 *    stage, rounded, translucent with a backdrop blur. It *floats over* the
 *    canvas rather than displacing it, so the page gets the full height.
 *    Eleven visible controls where there were twenty-odd: Home · Pages (with
 *    a compact "2/12" counter) │ pen, highlighter, eraser, lasso, select,
 *    hand │ "+" for secondary inserts │ "…" for document actions.
 * 2. {@link PagePanel} — the page rail is now a slide-over **dialog** with a
 *    scrim. Closed, it renders nothing and holds no column; open, it traps
 *    focus, dismisses on Escape and on a scrim click, and returns focus to
 *    the bar's Pages control.
 * 3. The tab strip (`goodnotes/tabs`) renders only with more than one
 *    document open. With one, the title heads the "…" menu instead.
 *
 * ## Nothing became unreachable
 *
 * Every route the old three-zone nav bar exposed still has a home — at most
 * one tap further away. `INTEGRATION.md` carries the full audit table; the
 * short version:
 *
 * | capability | where it is now |
 * | --- | --- |
 * | home | Home control |
 * | pages | Pages control (opens the overlay) |
 * | pen / highlighter / eraser / lasso / select | the bar |
 * | hand (pan) | the bar — new; see `INTEGRATION.md` § 9 |
 * | fuzzy select | the lasso slot (`onFuzzySelect`) |
 * | text / shapes / image / sticky | "+" |
 * | import PDF, insert graph | "+" |
 * | new document, add page, undo, redo | "…" (undo/redo also on the zoom pill) |
 * | share, export PDF, backdrops | "…" |
 * | search, read mode, theme, settings | "…" |
 *
 * `theme` is new to the bar: it was previously only reachable through
 * Excalidraw's hamburger island, which `suppressDefaultChrome` hides. The bar
 * now drives it directly when the host passes no `onToggleTheme`.
 *
 * ## Host layout
 *
 * There are no bands left. The host needs ONE positioned stage; the bar and
 * the overlay live inside it, over the canvas:
 *
 * ```tsx
 * import { FloatingBar, PagePanel } from "./goodnotes/shell";
 *
 * const [pagesOpen, setPagesOpen] = useState(false); // closed by default now
 *
 * <div className="gn-shell-layout">
 *   <TabBar … />                        // renders only with >1 document
 *   <div className="gn-shell-stage">    // position: relative
 *     <div className="gn-shell-canvas">
 *       <Excalidraw …>…</Excalidraw>
 *     </div>
 *     <FloatingBar
 *       excalidrawAPI={excalidrawAPI}
 *       suppressDefaultChrome
 *       pagePanelOpen={pagesOpen}
 *       onTogglePagePanel={() => setPagesOpen((open) => !open)}
 *       …
 *     />
 *     <PagePanel
 *       excalidrawAPI={excalidrawAPI}
 *       open={pagesOpen}
 *       onClose={() => setPagesOpen(false)}
 *     />
 *   </div>
 * </div>
 * ```
 *
 * `gn-shell-body` is kept as an exact alias of `gn-shell-stage`, so a host
 * that only moves `<FloatingBar>` and `<PagePanel>` *inside* its existing
 * `.gn-shell-body` is already correct. See `INTEGRATION.md` for the exact,
 * copy-pasteable `App.tsx` changes.
 *
 * What this module does NOT own: fuzzy select, PDF import/export, image
 * backdrops, pages (it wraps `goodnotes/pages`) and TOOL SETTINGS — colours
 * and widths belong to the floating Active Tool Menu, for which the bar
 * exposes only the `onActiveToolMenu` hook point.
 */

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/**
 * The one bar. Every prop is documented on {@link FloatingBarProps}; a missing
 * callback hides its control or menu item, so the bar never advertises
 * something the host cannot do.
 */
export { FloatingBar } from "./FloatingBar";
export type {
  FloatingBarProps,
  FloatingBarPinnedControl,
  ShellMode,
  ShellPlacement,
} from "./FloatingBar";

/** Always-visible tool options strip under the floating bar. */
export { BarToolSubmenu } from "./BarToolSubmenu";
export type { BarToolSubmenuProps } from "./BarToolSubmenu";

/**
 * @deprecated The three-zone band is gone. `NavBar` is an alias for
 * {@link FloatingBar} so existing importers keep compiling; `NavBarProps` is
 * an alias for {@link FloatingBarProps}. Band-only props
 * (`searchQuery`/`onSearchChange`/`onSearchSubmit` as an inline field, the
 * inline Write/Read segmented control, the inline `Share` button) are gone —
 * their capabilities moved into the "…" menu. See `INTEGRATION.md`.
 */
export { FloatingBar as NavBar } from "./FloatingBar";
export type { FloatingBarProps as NavBarProps } from "./FloatingBar";

/**
 * Body classes this module toggles. `SUPPRESS_DEFAULT_CHROME_CLASS` is added
 * while `suppressDefaultChrome` is set (shapes toolbar + hamburger island +
 * top-right island hidden, zoom pill untouched); `PAGE_PANEL_OPEN_CLASS` is
 * added while the page overlay is open, for hosts that want to react to it.
 * Both are removed on unmount — the suppression is opt-in and reversible.
 */
export {
  SUPPRESS_DEFAULT_CHROME_CLASS,
  PAGE_PANEL_OPEN_CLASS,
} from "./FloatingBar";

// ---------------------------------------------------------------------------
// The page overlay
// ---------------------------------------------------------------------------

/**
 * The page rail, as a slide-over dialog. Renders `null` when `open` is false —
 * no scrim, no panel, no reserved column. `PAGE_PANEL_WIDTH` is its default
 * open width (248px), which the host only needs if it wants to override it.
 */
export { PagePanel, PAGE_PANEL_WIDTH } from "./PagePanel";
export type { PagePanelProps } from "./PagePanel";

// ---------------------------------------------------------------------------
// Editor plumbing
// ---------------------------------------------------------------------------

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
  TaskbarMenuItem as ShellMenuItem,
} from "../taskbar/model";

/** The shared popover used by the "+" and "…" controls. */
export { TaskbarMenu as ShellMenu } from "../taskbar/Menu";
export type {
  TaskbarMenuProps as ShellMenuProps,
  TaskbarMenuSection as ShellMenuSection,
} from "../taskbar/Menu";
