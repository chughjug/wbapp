/**
 * GoodNotes taskbar — the app's single, centred, primary control surface.
 *
 * ```tsx
 * import { Taskbar } from "./goodnotes/taskbar";
 *
 * <Taskbar
 *   excalidrawAPI={excalidrawAPI}
 *   suppressDefaultToolbar
 *   // features owned by other modules — omit a callback and its control
 *   // simply is not rendered
 *   onFuzzySelect={fuzzySelect.run}
 *   onImportPdf={() => setImportOpen(true)}
 *   onExportPdf={() => setPdfExportOpen(true)}
 *   onOpenBackdrops={() => setBackdropsOpen(true)}
 *   onAddPage={addPage}
 *   pageCount={pageCount}
 *   currentPage={currentPage}
 * />
 * ```
 *
 * What this module owns: the shell, the layout, the overflow behaviour, the
 * keyboard model and the editor plumbing for the core drawing tools.
 * What it does NOT own: fuzzy select, PDF import, PDF export and image
 * backdrops — those are injected as optional callbacks, so this module can be
 * reviewed, themed and shipped independently of them.
 *
 * See `INTEGRATION.md` in this folder for copy-pasteable `App.tsx` changes.
 */

/**
 * The bar itself. The only component you need to render.
 * Every prop is documented on {@link TaskbarProps}.
 */
export { Taskbar, SUPPRESS_DEFAULT_TOOLBAR_CLASS } from "./Taskbar";
export type { TaskbarProps } from "./Taskbar";

/**
 * Drive the editor without the UI — same code path the bar's buttons use.
 * Useful for host-level keyboard shortcuts.
 */
export { activateTool, toolFromAppState, snapStrokeWidth } from "./tools";
export type { ActivateToolOptions, StrokeWidthKey } from "./tools";

/**
 * Defaults for the two ink slots, and the `customData` marker that makes a
 * freedraw stroke render as a highlighter (kept byte-compatible with
 * `goodnotes/pens`).
 */
export {
  DEFAULT_PEN,
  DEFAULT_HIGHLIGHTER,
  HIGHLIGHTER_MARKER,
  SHAPE_TOOL,
} from "./tools";

/** Model types, for hosts that want to mirror or drive taskbar state. */
export type {
  TaskbarToolId,
  TaskbarShapeId,
  TaskbarGroupId,
  TaskbarControl,
  TaskbarMenuItem,
} from "./model";

/**
 * The pure overflow solver and the layout constants it uses. Exported mainly
 * so it can be unit-tested, but also usable if you build a second bar.
 */
export { planOverflow, LAYOUT, GROUP_ORDER } from "./model";
export type { OverflowPlan } from "./model";

/** The shared popover used by the Shapes and More controls. */
export { TaskbarMenu } from "./Menu";
export type { TaskbarMenuProps, TaskbarMenuSection } from "./Menu";
