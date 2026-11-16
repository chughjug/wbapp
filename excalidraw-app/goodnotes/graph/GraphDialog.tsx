/**
 * The "Insert a graph" dialog — equation plotting and simple charts, with a
 * live preview of exactly what will land on the page.
 *
 * Accessibility contract (all of this is load-bearing, not decoration):
 *
 * - `role="dialog" aria-modal`, labelled by its title and described by its
 *   intro line; mounted in a portal and rendered only while open.
 * - Every control has a real `<label>`; grouped controls sit in a
 *   `<fieldset>` with a `<legend>`.
 * - Parse errors are announced in a `role="alert"` region **and** tied to the
 *   offending field with `aria-describedby` + `aria-invalid`.
 * - Focus moves in on mount, is trapped with Tab/Shift+Tab, and is restored
 *   to whatever was focused before on close. Escape closes.
 * - The preview canvas is `role="img"` with the same `aria-label` the
 *   inserted element gets, so a screen-reader user can hear what the graph
 *   shows before inserting it.
 * - Focus rings come from `:focus-visible`; every animation is disabled
 *   under `prefers-reduced-motion: reduce` (see the stylesheet).
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
  renderGraphToCanvas,
} from "./renderGraph";
import {
  createChartSpec,
  createFunctionSpec,
  describeGraph,
  isFunctionSpec,
  MAX_DATA_POINTS,
  MAX_SERIES,
  newSeriesId,
  seriesColor,
  validateGraphSpec,
} from "./spec";
import { insertGraphIntoScene, updateGraphElement } from "./insertGraph";

import "./GraphDialog.scss";

import type { GraphKind, GraphSpec, SpecProblem } from "./spec";
import type { InsertGraphResult } from "./insertGraph";
import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export interface GraphDialogProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Escape, backdrop click, Cancel, or a successful insert. */
  onClose: () => void;
  /** Fired after the graph lands in (or is updated in) the scene. */
  onInserted?: (result: InsertGraphResult) => void;
  /** Seed the form, e.g. from a previous insert. */
  initialSpec?: GraphSpec;
  /**
   * Edit an existing graph element in place instead of inserting a new one.
   * Pair it with `initialSpec` from `editGraph(api, element).spec`.
   */
  editElement?: ExcalidrawImageElement | null;
  /** Dialog theme. Defaults to the editor's current theme. */
  theme?: "light" | "dark";
  /** Preview debounce in ms. Default 180. */
  debounceMs?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PREVIEW_WIDTH = 496;
const PREVIEW_HEIGHT = 310;

interface SeriesRow {
  id: string;
  expression: string;
}
interface DataRow {
  id: string;
  label: string;
  value: string;
}

const numberOr = (text: string, fallback: number): number => {
  const parsed = Number(text.trim().replace(/−/g, "-"));
  return Number.isFinite(parsed) ? parsed : fallback;
};

let rowCounter = 0;
const nextRowId = () => `r${++rowCounter}`;

export const GraphDialog: React.FC<GraphDialogProps> = ({
  excalidrawAPI,
  onClose,
  onInserted,
  initialSpec,
  editElement,
  theme,
  debounceMs = 180,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const kindGroupId = useId();
  const xRangeErrorId = useId();
  const yRangeErrorId = useId();
  const dataErrorId = useId();
  const fieldId = useId();

  const seeded = initialSpec;
  const [kind, setKind] = useState<GraphKind>(seeded?.kind ?? "function");

  const [seriesRows, setSeriesRows] = useState<SeriesRow[]>(() =>
    seeded && isFunctionSpec(seeded)
      ? seeded.series.map((s) => ({ id: s.id, expression: s.expression }))
      : [{ id: newSeriesId(), expression: "x^2 - 3x + 2" }],
  );
  const [xMinText, setXMinText] = useState(
    seeded && isFunctionSpec(seeded) ? String(seeded.xMin) : "-5",
  );
  const [xMaxText, setXMaxText] = useState(
    seeded && isFunctionSpec(seeded) ? String(seeded.xMax) : "5",
  );
  const [yAuto, setYAuto] = useState(
    seeded && isFunctionSpec(seeded) ? seeded.yMode === "auto" : true,
  );
  const [yMinText, setYMinText] = useState(
    seeded && isFunctionSpec(seeded) && seeded.yMin !== undefined
      ? String(seeded.yMin)
      : "-10",
  );
  const [yMaxText, setYMaxText] = useState(
    seeded && isFunctionSpec(seeded) && seeded.yMax !== undefined
      ? String(seeded.yMax)
      : "10",
  );

  const [dataRows, setDataRows] = useState<DataRow[]>(() =>
    seeded && !isFunctionSpec(seeded)
      ? seeded.data.map((row) => ({
          id: nextRowId(),
          label: row.label,
          value: String(row.value),
        }))
      : createChartSpec("bar").data.map((row) => ({
          id: nextRowId(),
          label: row.label,
          value: String(row.value),
        })),
  );
  const [showValueLabels, setShowValueLabels] = useState(
    seeded && !isFunctionSpec(seeded) ? seeded.showValueLabels : false,
  );

  const [title, setTitle] = useState(seeded?.title ?? "");
  const [xLabel, setXLabel] = useState(
    seeded?.xLabel ?? (seeded && !isFunctionSpec(seeded) ? "" : "x"),
  );
  const [yLabel, setYLabel] = useState(
    seeded?.yLabel ?? (seeded && !isFunctionSpec(seeded) ? "" : "y"),
  );
  const [showGrid, setShowGrid] = useState(seeded?.showGrid ?? true);
  const [busy, setBusy] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);

  const editorTheme =
    theme ??
    ((excalidrawAPI.getAppState?.().theme as "light" | "dark") || "light");

  /* ---- the spec ---------------------------------------------------------- */
  const spec = useMemo<GraphSpec>(() => {
    if (kind === "function") {
      return {
        ...createFunctionSpec(),
        series: seriesRows.map((row) => ({
          id: row.id,
          expression: row.expression,
        })),
        xMin: numberOr(xMinText, -5),
        xMax: numberOr(xMaxText, 5),
        yMode: yAuto ? "auto" : "manual",
        ...(yAuto
          ? {}
          : { yMin: numberOr(yMinText, -10), yMax: numberOr(yMaxText, 10) }),
        title,
        xLabel,
        yLabel,
        showGrid,
      };
    }
    return {
      ...createChartSpec(kind),
      data: dataRows.map((row) => ({
        label: row.label,
        value: numberOr(row.value, NaN),
      })),
      title,
      xLabel,
      yLabel,
      showGrid,
      showValueLabels,
    };
  }, [
    kind,
    seriesRows,
    xMinText,
    xMaxText,
    yAuto,
    yMinText,
    yMaxText,
    dataRows,
    title,
    xLabel,
    yLabel,
    showGrid,
    showValueLabels,
  ]);

  /* ---- debounced preview ------------------------------------------------- */
  const [debouncedSpec, setDebouncedSpec] = useState<GraphSpec>(spec);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSpec(spec), debounceMs);
    return () => window.clearTimeout(timer);
  }, [spec, debounceMs]);

  const problems = useMemo<SpecProblem[]>(
    () => validateGraphSpec(debouncedSpec),
    [debouncedSpec],
  );
  const problemFor = useCallback(
    (field: string) => problems.find((problem) => problem.field === field),
    [problems],
  );
  const isValid = problems.length === 0;
  const altText = useMemo(() => describeGraph(debouncedSpec), [debouncedSpec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      renderGraphToCanvas(canvas, debouncedSpec, {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        pixelRatio: Math.min(3, window.devicePixelRatio || 1),
      });
    } catch {
      // a preview that cannot draw must never take the dialog down
    }
  }, [debouncedSpec]);

  /* ---- focus ------------------------------------------------------------- */
  useEffect(() => {
    unmountedRef.current = false;
    restoreFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
      firstFieldRef.current?.select();
    });
    return () => {
      unmountedRef.current = true;
      window.cancelAnimationFrame(frame);
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  /* ---- actions ----------------------------------------------------------- */
  const submit = useCallback(async () => {
    if (!isValid || busy) {
      return;
    }
    setBusy(true);
    setInsertError(null);
    try {
      const result = editElement
        ? await updateGraphElement(excalidrawAPI, editElement, spec)
        : await insertGraphIntoScene(excalidrawAPI, spec, {
            width: DEFAULT_GRAPH_WIDTH,
            height: DEFAULT_GRAPH_HEIGHT,
          });
      onInserted?.(result);
      onClose();
    } catch (error) {
      if (!unmountedRef.current) {
        setInsertError(
          error instanceof Error
            ? error.message
            : "The graph could not be inserted.",
        );
      }
    } finally {
      if (!unmountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, editElement, excalidrawAPI, isValid, onClose, onInserted, spec]);

  const updateSeries = (id: string, expression: string) =>
    setSeriesRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, expression } : row)),
    );
  const updateRow = (id: string, patch: Partial<DataRow>) =>
    setDataRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  /* ---- render ------------------------------------------------------------ */
  const firstProblem = problems[0];

  const body = (
    <div
      className={`excalidraw gn-graph-backdrop theme--${editorTheme}`}
      data-theme={editorTheme}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="gn-graph-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-graph-dialog__header">
          <h2 className="gn-graph-dialog__title" id={titleId}>
            {editElement ? "Edit graph" : "Insert a graph"}
          </h2>
          <button
            type="button"
            className="gn-graph-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="gn-graph-dialog__intro" id={descriptionId}>
          Plot an equation over a range of x, or draw a bar or line chart from
          your own data. The preview shows exactly what will be placed on the
          page.
        </p>

        <div className="gn-graph-dialog__body">
          <div className="gn-graph-dialog__form">
            <fieldset className="gn-graph-fieldset" id={kindGroupId}>
              <legend>What to draw</legend>
              <div className="gn-graph-segmented" role="radiogroup" aria-label="Graph type">
                {(
                  [
                    ["function", "Equation"],
                    ["bar", "Bar chart"],
                    ["line", "Line chart"],
                  ] as [GraphKind, string][]
                ).map(([value, label]) => (
                  <label key={value} className="gn-graph-segmented__option">
                    <input
                      type="radio"
                      name={`${fieldId}-kind`}
                      value={value}
                      checked={kind === value}
                      onChange={() => setKind(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {kind === "function" ? (
              <>
                <fieldset className="gn-graph-fieldset">
                  <legend>Equations</legend>
                  {seriesRows.map((row, index) => {
                    const problem = problemFor(`series:${row.id}`);
                    const errorId = `${fieldId}-series-${row.id}-error`;
                    return (
                      <div className="gn-graph-series" key={row.id}>
                        <span
                          className="gn-graph-series__swatch"
                          style={{ backgroundColor: seriesColor(index) }}
                          aria-hidden="true"
                        />
                        <div className="gn-graph-series__field">
                          <label htmlFor={`${fieldId}-series-${row.id}`}>
                            {seriesRows.length > 1
                              ? `Equation ${index + 1}`
                              : "Equation"}
                          </label>
                          <input
                            id={`${fieldId}-series-${row.id}`}
                            ref={index === 0 ? firstFieldRef : undefined}
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={row.expression}
                            placeholder="y = x^2 - 3x + 2"
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={
                              problem ? errorId : `${fieldId}-syntax-hint`
                            }
                            onChange={(event) =>
                              updateSeries(row.id, event.target.value)
                            }
                          />
                          {problem && (
                            <p
                              className="gn-graph-error"
                              id={errorId}
                              role="alert"
                            >
                              {problem.message}
                            </p>
                          )}
                        </div>
                        {seriesRows.length > 1 && (
                          <button
                            type="button"
                            className="gn-graph-icon-button"
                            onClick={() =>
                              setSeriesRows((rows) =>
                                rows.filter((item) => item.id !== row.id),
                              )
                            }
                            aria-label={`Remove equation ${index + 1}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <p className="gn-graph-hint" id={`${fieldId}-syntax-hint`}>
                    Use <code>+ − * / ^</code>, brackets, and sin, cos, tan,
                    sqrt, ln, log, exp, abs, floor, ceil, round, with{" "}
                    <code>pi</code> and <code>e</code>. <code>2x</code> and{" "}
                    <code>3sin(x)</code> mean multiplication.
                  </p>
                  {seriesRows.length < MAX_SERIES && (
                    <button
                      type="button"
                      className="gn-graph-text-button"
                      onClick={() =>
                        setSeriesRows((rows) => [
                          ...rows,
                          { id: newSeriesId(), expression: "" },
                        ])
                      }
                    >
                      + Add another equation
                    </button>
                  )}
                </fieldset>

                <fieldset className="gn-graph-fieldset">
                  <legend>Range</legend>
                  <div className="gn-graph-row">
                    <div className="gn-graph-field">
                      <label htmlFor={`${fieldId}-xmin`}>x from</label>
                      <input
                        id={`${fieldId}-xmin`}
                        type="number"
                        step="any"
                        value={xMinText}
                        aria-invalid={problemFor("xRange") ? true : undefined}
                        aria-describedby={
                          problemFor("xRange") ? xRangeErrorId : undefined
                        }
                        onChange={(event) => setXMinText(event.target.value)}
                      />
                    </div>
                    <div className="gn-graph-field">
                      <label htmlFor={`${fieldId}-xmax`}>x to</label>
                      <input
                        id={`${fieldId}-xmax`}
                        type="number"
                        step="any"
                        value={xMaxText}
                        aria-invalid={problemFor("xRange") ? true : undefined}
                        aria-describedby={
                          problemFor("xRange") ? xRangeErrorId : undefined
                        }
                        onChange={(event) => setXMaxText(event.target.value)}
                      />
                    </div>
                  </div>
                  {problemFor("xRange") && (
                    <p className="gn-graph-error" id={xRangeErrorId} role="alert">
                      {problemFor("xRange")?.message}
                    </p>
                  )}
                  <label className="gn-graph-check">
                    <input
                      type="checkbox"
                      checked={yAuto}
                      onChange={(event) => setYAuto(event.target.checked)}
                    />
                    <span>Fit the y-range to the curve automatically</span>
                  </label>
                  {!yAuto && (
                    <>
                      <div className="gn-graph-row">
                        <div className="gn-graph-field">
                          <label htmlFor={`${fieldId}-ymin`}>y from</label>
                          <input
                            id={`${fieldId}-ymin`}
                            type="number"
                            step="any"
                            value={yMinText}
                            aria-invalid={
                              problemFor("yRange") ? true : undefined
                            }
                            aria-describedby={
                              problemFor("yRange") ? yRangeErrorId : undefined
                            }
                            onChange={(event) =>
                              setYMinText(event.target.value)
                            }
                          />
                        </div>
                        <div className="gn-graph-field">
                          <label htmlFor={`${fieldId}-ymax`}>y to</label>
                          <input
                            id={`${fieldId}-ymax`}
                            type="number"
                            step="any"
                            value={yMaxText}
                            aria-invalid={
                              problemFor("yRange") ? true : undefined
                            }
                            aria-describedby={
                              problemFor("yRange") ? yRangeErrorId : undefined
                            }
                            onChange={(event) =>
                              setYMaxText(event.target.value)
                            }
                          />
                        </div>
                      </div>
                      {problemFor("yRange") && (
                        <p
                          className="gn-graph-error"
                          id={yRangeErrorId}
                          role="alert"
                        >
                          {problemFor("yRange")?.message}
                        </p>
                      )}
                    </>
                  )}
                </fieldset>
              </>
            ) : (
              <fieldset className="gn-graph-fieldset">
                <legend>Data</legend>
                <table className="gn-graph-table">
                  <thead>
                    <tr>
                      <th scope="col">Label</th>
                      <th scope="col">Value</th>
                      <th scope="col">
                        <span className="gn-graph-visually-hidden">
                          Remove row
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, index) => (
                      <tr key={row.id}>
                        <td>
                          <label
                            className="gn-graph-visually-hidden"
                            htmlFor={`${fieldId}-label-${row.id}`}
                          >
                            Label for row {index + 1}
                          </label>
                          <input
                            id={`${fieldId}-label-${row.id}`}
                            ref={index === 0 ? firstFieldRef : undefined}
                            type="text"
                            value={row.label}
                            autoComplete="off"
                            onChange={(event) =>
                              updateRow(row.id, { label: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <label
                            className="gn-graph-visually-hidden"
                            htmlFor={`${fieldId}-value-${row.id}`}
                          >
                            Value for row {index + 1}
                          </label>
                          <input
                            id={`${fieldId}-value-${row.id}`}
                            type="number"
                            step="any"
                            value={row.value}
                            aria-invalid={
                              row.value.trim() !== "" &&
                              !Number.isFinite(Number(row.value))
                                ? true
                                : undefined
                            }
                            onChange={(event) =>
                              updateRow(row.id, { value: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          {dataRows.length > 2 && (
                            <button
                              type="button"
                              className="gn-graph-icon-button"
                              onClick={() =>
                                setDataRows((rows) =>
                                  rows.filter((item) => item.id !== row.id),
                                )
                              }
                              aria-label={`Remove row ${index + 1}`}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problemFor("data") && (
                  <p className="gn-graph-error" id={dataErrorId} role="alert">
                    {problemFor("data")?.message}
                  </p>
                )}
                {dataRows.length < MAX_DATA_POINTS && (
                  <button
                    type="button"
                    className="gn-graph-text-button"
                    onClick={() =>
                      setDataRows((rows) => [
                        ...rows,
                        { id: nextRowId(), label: "", value: "" },
                      ])
                    }
                  >
                    + Add a row
                  </button>
                )}
                <label className="gn-graph-check">
                  <input
                    type="checkbox"
                    checked={showValueLabels}
                    onChange={(event) =>
                      setShowValueLabels(event.target.checked)
                    }
                  />
                  <span>Print the value on each mark</span>
                </label>
              </fieldset>
            )}

            <fieldset className="gn-graph-fieldset">
              <legend>Labels</legend>
              <div className="gn-graph-field">
                <label htmlFor={`${fieldId}-title`}>Title (optional)</label>
                <input
                  id={`${fieldId}-title`}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="gn-graph-row">
                <div className="gn-graph-field">
                  <label htmlFor={`${fieldId}-xlabel`}>x-axis label</label>
                  <input
                    id={`${fieldId}-xlabel`}
                    type="text"
                    value={xLabel}
                    onChange={(event) => setXLabel(event.target.value)}
                  />
                </div>
                <div className="gn-graph-field">
                  <label htmlFor={`${fieldId}-ylabel`}>y-axis label</label>
                  <input
                    id={`${fieldId}-ylabel`}
                    type="text"
                    value={yLabel}
                    onChange={(event) => setYLabel(event.target.value)}
                  />
                </div>
              </div>
              <label className="gn-graph-check">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                <span>Show gridlines</span>
              </label>
            </fieldset>
          </div>

          <div className="gn-graph-preview">
            <h3 className="gn-graph-preview__heading">Preview</h3>
            <canvas
              ref={canvasRef}
              className="gn-graph-preview__canvas"
              role="img"
              aria-label={altText}
              style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
            />
            <p className="gn-graph-preview__alt">
              <span className="gn-graph-preview__alt-label">
                Description saved with the image:
              </span>{" "}
              {altText}
            </p>
          </div>
        </div>

        {(firstProblem || insertError) && (
          <p className="gn-graph-error gn-graph-error--summary" role="alert">
            {insertError ?? firstProblem?.message}
          </p>
        )}

        <div className="gn-graph-dialog__footer">
          <button type="button" className="gn-graph-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gn-graph-button gn-graph-button--primary"
            onClick={() => void submit()}
            disabled={!isValid || busy}
          >
            {busy
              ? "Working…"
              : editElement
              ? "Update graph"
              : "Insert graph"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
