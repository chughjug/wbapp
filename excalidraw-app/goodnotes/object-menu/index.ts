/**
 * GoodNotes **Universal Object Menu** — public API.
 *
 * A contextual action bar that appears directly above the selected object
 * and shows only the actions that make sense for it. Selecting an object
 * brings the toolbar to the object instead of sending the user to the top of
 * the screen.
 *
 * ## Quick start
 *
 * Mount it once, **inside** `<Excalidraw>` (it reads the editor's CSS custom
 * properties, which are scoped to the `.excalidraw` container):
 *
 * ```tsx
 * import { ObjectMenu } from "./goodnotes/object-menu";
 *
 * const backdrops = useBackdropPanel(excalidrawAPI); // already in App.tsx
 *
 * <Excalidraw …>
 *   <ObjectMenu
 *     excalidrawAPI={excalidrawAPI}
 *     onOpenBackdrop={backdrops.open}
 *   />
 * </Excalidraw>
 * ```
 *
 * It renders `null` when nothing is selected, so it costs nothing and cannot
 * intercept pointer events while hidden. See `INTEGRATION.md` for the exact
 * `App.tsx` change, the layering rules and how it coordinates with the
 * modal lasso of `goodnotes/fuzzy-select`.
 *
 * ## What it shows
 *
 * | selection | items |
 * | --- | --- |
 * | image | Duplicate, Backdrop… (only with `onOpenBackdrop`), Crop, Replace, Delete |
 * | freedraw / ink | colour, width, Convert to shape (only when the recognizer finds one), Duplicate, Delete |
 * | text | size, colour, Duplicate, Delete |
 * | shape | fill, stroke, width, Duplicate, Delete |
 * | 2+ elements | Group (when they are not already one group), Duplicate, Delete |
 * | anything else (arrow, line, frame, …) | Duplicate, Delete |
 *
 * Nothing is rendered that cannot be performed: items whose dependency is
 * missing (no `onOpenBackdrop`, an unrecognizable stroke, an already-grouped
 * pair) are left out rather than disabled-but-present.
 */

/* ---------------------------------- UI ----------------------------------- */

/** The floating bar. Mount once inside `<Excalidraw>`. */
export { ObjectMenu } from "./ObjectMenu";
export type { ObjectMenuProps } from "./ObjectMenu";

/* ------------------------------- selection -------------------------------- */

/**
 * Subscribes to `excalidrawAPI.onChange`, derives the selection, its kind
 * and its bounding box in both scene and client coordinates, and returns a
 * *referentially stable* value (recomputed at most once per animation frame,
 * committed only when something actually changed). Useful on its own for any
 * other selection-following UI.
 */
export { useSelectedElements } from "./useSelectedElements";
export type {
  ObjectSelection,
  ObjectSelectionKind,
  SelectionViewport,
  ViewportRect,
} from "./useSelectedElements";

/* -------------------------------- actions --------------------------------- */

/**
 * The headless actions behind the bar. Each one drives
 * `ExcalidrawImperativeAPI` directly, mutates through `newElementWith` (so
 * `version`/`versionNonce`/`updated` stay correct and the change actually
 * syncs and persists) and commits with `CaptureUpdateAction.IMMEDIATELY`, so
 * each is one undo step. Call them from a taskbar, a shortcut or a test
 * without rendering the menu.
 */
export {
  canConvertToShape,
  canGroupSelection,
  convertInkToShape,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  replaceImage,
  setBackgroundColor,
  setFontSize,
  setStrokeColor,
  setStrokeWidth,
  startCropping,
} from "./actions";

/** The option sets the bar offers (editor defaults, re-exported for hosts). */
export {
  FILL_COLOR_PICKS,
  FONT_SIZE_OPTIONS,
  INK_WIDTHS,
  SHAPE_STROKE_WIDTHS,
  STROKE_COLOR_PICKS,
} from "./actions";
