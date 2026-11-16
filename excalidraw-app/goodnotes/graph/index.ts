/**
 * GoodNotes **Insert a graph** — public API.
 *
 * Plot a maths equation over a bounded range, or draw a bar / line chart
 * from label-value pairs, and drop the result into the page as an ordinary
 * Excalidraw `image` element.
 *
 * ## Quick start (a nav-bar button)
 *
 * ```tsx
 * import { useGraphDialog } from "./goodnotes/graph";
 *
 * const graph = useGraphDialog(excalidrawAPI);
 *
 * <button onClick={() => graph.open()}>Insert graph</button>
 * {graph.dialog}
 * ```
 *
 * See `INTEGRATION.md` for the exact, copy-pasteable `App.tsx` change.
 *
 * ## Headless
 *
 * ```ts
 * await insertGraphIntoScene(excalidrawAPI, createFunctionSpec({
 *   series: [{ id: "s1", expression: "sin(x)" }],
 *   xMin: 0,
 *   xMax: 2 * Math.PI,
 * }));
 * ```
 *
 * ## How expressions are evaluated — no `eval`
 *
 * User input is parsed by a bounded tokenizer + shunting-yard parser into an
 * AST and then evaluated numerically. There is **no `eval`, no
 * `new Function`, no string-form `setTimeout`** anywhere in this module: the
 * grammar in `./expression` is the whole language, and it cannot reach a
 * global, a property or a string. Anything outside it is rejected with the
 * offending token and its position.
 *
 * ## Re-editability
 *
 * The full spec is stored on the inserted element at
 * `customData.goodnotes.graph` (sibling GoodNotes keys are preserved).
 * {@link editGraph} reads it back and gives you an `update()` that
 * re-renders into the same box in one undo step — changing the x-range is a
 * re-render, not a restart.
 *
 * ## Accessibility
 *
 * The inserted image carries a text alternative derived from its spec
 * ("Graph of y = x² − 3x + 2 for x from 0 to 10"), readable with
 * {@link getGraphAltText}. Excalidraw's core image element has no native
 * `alt` attribute, so the description lives in `customData` alongside the
 * spec; surface it from whatever chrome owns the selected object.
 */

/* ----------------------------------- UI ---------------------------------- */

/** The accessible insert/edit dialog with a debounced live preview. */
export { GraphDialog } from "./GraphDialog";
export type { GraphDialogProps } from "./GraphDialog";

/**
 * Callback-shaped entry point for a nav bar: returns `{ open, editSelected,
 * dialog }`. Render `dialog`, wire `open` to your button.
 */
export { useGraphDialog } from "./useGraphDialog";
export type {
  GraphDialogController,
  UseGraphDialogOptions,
} from "./useGraphDialog";

/* --------------------------------- scene --------------------------------- */

export {
  /**
   * Renders a spec and inserts it into the live scene. Registers the PNG with
   * `addFiles` **before** the element lands, so it survives a reload.
   */
  insertGraphIntoScene,
  /** Renders a spec to a `BinaryFileData` (SHA-1 `fileId`) without touching the scene. */
  renderGraphToFile,
  /** Re-renders an existing graph element from a new spec, in place, one undo step. */
  updateGraphElement,
  /** The re-edit entry point: `{ spec, alt, update }` for a graph element, else `null`. */
  editGraph,
  /** The spec stored on an element, or `null`. */
  getGraphSpec,
  /** The stored text alternative for a graph element. */
  getGraphAltText,
  /** Everything we persist on the element (spec + alt + render size). */
  getGraphCustomData,
  /** Is this element one of our graphs? */
  isGraphElement,
  /** The single selected graph element, if the selection is exactly one. */
  getSelectedGraphElement,
  /** Merge/remove our `customData.goodnotes.graph` key without clobbering siblings. */
  mergeGraphCustomData,
} from "./insertGraph";

export type {
  GraphRaster,
  GraphCustomData,
  GraphEditHandle,
  InsertGraphOptions,
  InsertGraphResult,
  RenderGraphFileOptions,
  UpdateGraphOptions,
} from "./insertGraph";

/* ---------------------------------- spec --------------------------------- */

export {
  /** Build a function-plot spec with sensible defaults. */
  createFunctionSpec,
  /** Build a bar/line chart spec with sensible defaults. */
  createChartSpec,
  /** Field-by-field validation for the dialog (never throws). */
  validateGraphSpec,
  /** Clamp/validate an untrusted value (e.g. from a saved scene) into a spec. */
  normalizeGraphSpec,
  /** The text alternative for a spec. */
  describeGraph,
  /** A ≤80-character version of it, for toasts and menus. */
  shortGraphLabel,
  /** Narrowing guard for the function-plot variant. */
  isFunctionSpec,
  /** Colour for series slot `n` (fixed order, never cycled past the cap). */
  seriesColor,
  newSeriesId,
  GOODNOTES_CUSTOM_DATA_NAMESPACE,
  GRAPH_CUSTOM_DATA_KEY,
  GRAPH_SPEC_VERSION,
  MAX_DATA_POINTS,
  MAX_EXPRESSION_LENGTH,
  MAX_SERIES,
} from "./spec";

export type {
  ChartDatum,
  ChartGraphSpec,
  FunctionGraphSpec,
  FunctionSeries,
  GraphKind,
  GraphSpec,
  SpecProblem,
} from "./spec";

/* -------------------------------- rendering ------------------------------- */

export {
  /** Draw a spec onto any canvas. The dialog preview and the 2× raster share it. */
  renderGraphToCanvas,
  DEFAULT_GRAPH_WIDTH,
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_PIXEL_RATIO,
} from "./renderGraph";

export type {
  CanvasLike,
  RenderGraphOptions,
  RenderGraphResult,
} from "./renderGraph";

/** The validated chart palette (light steps) and the chart typeface. */
export { CHART_COLORS, CHART_FONT_STACK, SERIES_COLORS } from "./palette";

/* ------------------------------- expressions ------------------------------ */

export {
  /** Source → AST. Throws `ExpressionError` with the offending token. */
  parseExpression,
  /** Source → `(x) => number`. Throws `ExpressionError`. */
  compileExpression,
  /** Walk an AST numerically. Returns `NaN` rather than throwing. */
  evaluateNode,
  /** AST → canonical string. */
  formatNode,
  /** Any thrown value → a message fit for the UI. */
  describeExpressionError,
  /** Strips `y =`, folds Unicode operators. */
  normalizeExpressionSource,
  /** Typed parse failure carrying `position` and `token`. */
  ExpressionError,
  /** The supported function and constant tables. */
  FUNCTIONS,
  CONSTANTS,
} from "./expression";

export type {
  BinaryOperator,
  ExpressionNode,
  ParsedExpression,
  ParseOptions,
} from "./expression";

/* --------------------------- sampling & axis maths ------------------------ */

export {
  /** Adaptive sampling that breaks the line at poles instead of spiking. */
  buildPolylines,
  /** Evenly spaced samples, for auto-ranging. */
  sampleValues,
} from "./sample";

export type {
  CurvePoint,
  PolylineOptions,
  PolylineResult,
} from "./sample";

export {
  /** Ticks at nice round numbers (never raw range/10). */
  niceTicks,
  niceStep,
  formatTick,
  shouldUseCompactTicks,
  /** Pole-robust y auto-range from sampled values. */
  autoRangeFromSamples,
  createScale,
} from "./scale";

export type { AutoRange, LinearScale, TickSet } from "./scale";
