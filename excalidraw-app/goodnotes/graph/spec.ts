/**
 * The **graph spec**: the complete, serializable description of a graph.
 *
 * The spec is the single source of truth. It is what the dialog edits, what
 * the renderer draws, and what gets stored on the inserted image element in
 * `customData.goodnotes.graph` so the graph can be re-opened and re-rendered
 * later (change the x-range, add a second curve) instead of being redrawn
 * from scratch.
 *
 * Specs come back out of saved scenes, which means they are **untrusted
 * input**: {@link normalizeGraphSpec} re-validates every field and clamps it
 * into range, and expressions are only ever handed to the bounded parser in
 * `./expression` — never to `eval`.
 */

import { parseExpression, ExpressionError } from "./expression";

import { SERIES_COLORS } from "./palette";

/** Namespace shared by every GoodNotes feature on `element.customData`. */
export const GOODNOTES_CUSTOM_DATA_NAMESPACE = "goodnotes";
/** Our key inside that namespace: `customData.goodnotes.graph`. */
export const GRAPH_CUSTOM_DATA_KEY = "graph";
/** Bumped when the spec shape changes incompatibly. */
export const GRAPH_SPEC_VERSION = 1;

export type GraphKind = "function" | "bar" | "line";

/** One plotted expression. */
export interface FunctionSeries {
  /** Stable id, so colours follow the curve and not its row number. */
  id: string;
  /** Raw source as the student typed it, e.g. `"y = x^2 - 3x + 2"`. */
  expression: string;
  /** Legend label. Defaults to the expression. */
  label?: string;
  /** Hidden series stay in the spec but are not drawn. */
  hidden?: boolean;
}

export interface FunctionGraphSpec {
  kind: "function";
  version: number;
  series: FunctionSeries[];
  xMin: number;
  xMax: number;
  /** `"auto"` fits y to the sampled values (robust to poles). */
  yMode: "auto" | "manual";
  yMin?: number;
  yMax?: number;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  showGrid: boolean;
}

export interface ChartDatum {
  label: string;
  value: number;
}

export interface ChartGraphSpec {
  kind: "bar" | "line";
  version: number;
  data: ChartDatum[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  showGrid: boolean;
  /** Print the value on each mark. Off by default — the axis carries them. */
  showValueLabels: boolean;
}

export type GraphSpec = FunctionGraphSpec | ChartGraphSpec;

export const isFunctionSpec = (spec: GraphSpec): spec is FunctionGraphSpec =>
  spec.kind === "function";

/* -------------------------------------------------------------------------- */
/* limits                                                                     */
/* -------------------------------------------------------------------------- */

/** More curves than the palette has safe adjacent slots for. */
export const MAX_SERIES = 6;
/** A table taller than this is a spreadsheet, not a note. */
export const MAX_DATA_POINTS = 40;
/** Longest expression we will even try to parse. */
export const MAX_EXPRESSION_LENGTH = 200;

/* -------------------------------------------------------------------------- */
/* defaults                                                                   */
/* -------------------------------------------------------------------------- */

let seriesCounter = 0;
export const newSeriesId = (): string => `s${++seriesCounter}`;

export const createFunctionSpec = (
  overrides: Partial<FunctionGraphSpec> = {},
): FunctionGraphSpec => ({
  kind: "function",
  version: GRAPH_SPEC_VERSION,
  series: [{ id: newSeriesId(), expression: "x^2 - 3x + 2" }],
  xMin: -5,
  xMax: 5,
  yMode: "auto",
  title: "",
  xLabel: "x",
  yLabel: "y",
  showGrid: true,
  ...overrides,
});

export const createChartSpec = (
  kind: "bar" | "line" = "bar",
  overrides: Partial<ChartGraphSpec> = {},
): ChartGraphSpec => ({
  kind,
  version: GRAPH_SPEC_VERSION,
  data: [
    { label: "Mon", value: 12 },
    { label: "Tue", value: 19 },
    { label: "Wed", value: 7 },
    { label: "Thu", value: 15 },
    { label: "Fri", value: 22 },
  ],
  title: "",
  xLabel: "",
  yLabel: "",
  showGrid: true,
  showValueLabels: false,
  ...overrides,
});

/** Colour for a series slot. Follows the slot, never the current rank. */
export const seriesColor = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length];

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface SpecProblem {
  /** `"series:<id>"`, `"xRange"`, `"yRange"`, `"data"`, … */
  field: string;
  message: string;
  /** Character offset inside the offending expression, when we have one. */
  position?: number;
}

/**
 * Validates a spec the way the dialog wants it: a list of problems rather
 * than an exception, so several fields can be flagged at once. An empty
 * array means the spec is renderable.
 */
export const validateGraphSpec = (spec: GraphSpec): SpecProblem[] => {
  const problems: SpecProblem[] = [];
  if (isFunctionSpec(spec)) {
    if (!Number.isFinite(spec.xMin) || !Number.isFinite(spec.xMax)) {
      problems.push({ field: "xRange", message: "The x-range needs numbers." });
    } else if (spec.xMax <= spec.xMin) {
      problems.push({
        field: "xRange",
        message: "“x to” must be greater than “x from”.",
      });
    }
    if (spec.yMode === "manual") {
      if (!Number.isFinite(spec.yMin) || !Number.isFinite(spec.yMax)) {
        problems.push({
          field: "yRange",
          message: "The y-range needs numbers, or switch it to auto-fit.",
        });
      } else if ((spec.yMax as number) <= (spec.yMin as number)) {
        problems.push({
          field: "yRange",
          message: "“y to” must be greater than “y from”.",
        });
      }
    }
    const visible = spec.series.filter((s) => !s.hidden);
    if (visible.length === 0) {
      problems.push({
        field: "series",
        message: "Add at least one equation to plot.",
      });
    }
    for (const series of spec.series) {
      if (series.hidden) {
        continue;
      }
      if (series.expression.length > MAX_EXPRESSION_LENGTH) {
        problems.push({
          field: `series:${series.id}`,
          message: `That expression is longer than ${MAX_EXPRESSION_LENGTH} characters.`,
        });
        continue;
      }
      try {
        parseExpression(series.expression);
      } catch (error) {
        problems.push({
          field: `series:${series.id}`,
          message:
            error instanceof ExpressionError
              ? error.message
              : "That expression could not be read.",
          position:
            error instanceof ExpressionError ? error.position : undefined,
        });
      }
    }
    return problems;
  }

  const usable = spec.data.filter(
    (row) => row.label.trim() !== "" || Number.isFinite(row.value),
  );
  if (usable.length < 2) {
    problems.push({
      field: "data",
      message: "A chart needs at least two rows of data.",
    });
  }
  if (spec.data.some((row) => !Number.isFinite(row.value))) {
    problems.push({
      field: "data",
      message: "Every row needs a number in the value column.",
    });
  }
  return problems;
};

/**
 * Clamps and re-types anything claiming to be a spec (e.g. read back from a
 * saved scene). Returns `null` when the value is not a spec at all.
 */
export const normalizeGraphSpec = (value: unknown): GraphSpec | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof raw[key] === "string" ? (raw[key] as string) : undefined;
  const num = (key: string, fallback: number): number =>
    typeof raw[key] === "number" && Number.isFinite(raw[key] as number)
      ? (raw[key] as number)
      : fallback;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;

  if (raw.kind === "function") {
    const series = Array.isArray(raw.series)
      ? (raw.series as unknown[])
          .filter(
            (item): item is Record<string, unknown> =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).expression === "string",
          )
          .slice(0, MAX_SERIES)
          .map((item, index) => ({
            id:
              typeof item.id === "string" && item.id
                ? item.id
                : `s${index + 1}`,
            expression: (item.expression as string).slice(
              0,
              MAX_EXPRESSION_LENGTH,
            ),
            ...(typeof item.label === "string" ? { label: item.label } : {}),
            ...(item.hidden === true ? { hidden: true } : {}),
          }))
      : [];
    if (series.length === 0) {
      return null;
    }
    const spec: FunctionGraphSpec = {
      kind: "function",
      version: num("version", GRAPH_SPEC_VERSION),
      series,
      xMin: num("xMin", -5),
      xMax: num("xMax", 5),
      yMode: raw.yMode === "manual" ? "manual" : "auto",
      title: str("title"),
      xLabel: str("xLabel"),
      yLabel: str("yLabel"),
      showGrid: bool("showGrid", true),
    };
    if (spec.yMode === "manual") {
      spec.yMin = num("yMin", -10);
      spec.yMax = num("yMax", 10);
    }
    return spec;
  }

  if (raw.kind === "bar" || raw.kind === "line") {
    const data = Array.isArray(raw.data)
      ? (raw.data as unknown[])
          .filter(
            (item): item is Record<string, unknown> =>
              !!item && typeof item === "object",
          )
          .slice(0, MAX_DATA_POINTS)
          .map((item) => ({
            label:
              typeof item.label === "string" ? item.label.slice(0, 40) : "",
            value:
              typeof item.value === "number" && Number.isFinite(item.value)
                ? item.value
                : 0,
          }))
      : [];
    if (data.length === 0) {
      return null;
    }
    return {
      kind: raw.kind,
      version: num("version", GRAPH_SPEC_VERSION),
      data,
      title: str("title"),
      xLabel: str("xLabel"),
      yLabel: str("yLabel"),
      showGrid: bool("showGrid", true),
      showValueLabels: bool("showValueLabels", false),
    };
  }

  return null;
};

/* -------------------------------------------------------------------------- */
/* text alternative                                                           */
/* -------------------------------------------------------------------------- */

const prettyNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "?";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded).replace(/-/g, "−");
};

/** Reads `y = …` back out of a spec's series for prose. */
const seriesPhrase = (series: FunctionSeries): string => {
  const text = (series.label ?? series.expression).trim();
  return text.replace(/^y\s*=\s*/i, "").replace(/-/g, "−");
};

/**
 * A meaningful text alternative for the rendered image, derived from the
 * spec — e.g. *"Graph of y = x² − 3x + 2 for x from 0 to 10"*. Stored with
 * the spec and exposed through {@link getGraphAltText} so a screen-reader
 * user is not left with an unlabelled picture.
 */
export const describeGraph = (spec: GraphSpec): string => {
  if (isFunctionSpec(spec)) {
    const visible = spec.series.filter((s) => !s.hidden);
    const names = visible.map((s) => `y = ${seriesPhrase(s)}`);
    const subject =
      names.length === 0
        ? "an empty set of axes"
        : names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const range = `for x from ${prettyNumber(spec.xMin)} to ${prettyNumber(
      spec.xMax,
    )}`;
    const yPart =
      spec.yMode === "manual" &&
      Number.isFinite(spec.yMin) &&
      Number.isFinite(spec.yMax)
        ? `, y from ${prettyNumber(spec.yMin as number)} to ${prettyNumber(
            spec.yMax as number,
          )}`
        : "";
    const title = spec.title?.trim() ? `${spec.title.trim()}: ` : "";
    return `${title}Graph of ${subject} ${range}${yPart}`;
  }

  const rows = spec.data.filter((row) => row.label.trim() !== "");
  const values = rows.map((row) => row.value);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const peak = rows.find((row) => row.value === max);
  const trough = rows.find((row) => row.value === min);
  const title = spec.title?.trim() ? `${spec.title.trim()}. ` : "";
  const kindWord = spec.kind === "bar" ? "Bar chart" : "Line chart";
  const axis =
    spec.yLabel?.trim() || spec.xLabel?.trim()
      ? ` (${[spec.xLabel?.trim(), spec.yLabel?.trim()]
          .filter(Boolean)
          .join(" vs ")})`
      : "";
  const listing = rows
    .map((row) => `${row.label} ${prettyNumber(row.value)}`)
    .join(", ");
  const extremes =
    peak && trough && rows.length > 1
      ? ` Highest ${peak.label} at ${prettyNumber(max)}, lowest ${
          trough.label
        } at ${prettyNumber(min)}.`
      : "";
  return `${title}${kindWord} of ${rows.length} values${axis}: ${listing}.${extremes}`;
};

/** Short label for a toolbar/toast, e.g. `"Graph of y = sin(x)"`. */
export const shortGraphLabel = (spec: GraphSpec): string => {
  const full = describeGraph(spec);
  return full.length > 80 ? `${full.slice(0, 77)}…` : full;
};
