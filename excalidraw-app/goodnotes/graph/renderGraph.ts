/**
 * Canvas2D renderer for a {@link GraphSpec}.
 *
 * One function draws everything — the live preview in the dialog and the 2×
 * raster that gets inserted into the scene both call it, so what the student
 * previews is exactly what lands on the page.
 *
 * ## Design rules this follows (from the `dataviz` skill)
 *
 * - **Light surface always.** The graph becomes a picture on white paper and
 *   in exported PDFs, so it is never themed to the editor's dark mode.
 * - Hairline, solid, recessive grid and axes; no dashes.
 * - Lines 2px, round caps/joins; markers r ≥ 4 with a 2px surface ring; bars
 *   capped at 24px with a 4px rounded data-end, square at the baseline, and
 *   at least a 2px surface gap between neighbours.
 * - Ticks at nice round numbers, full under 10,000 and compact above.
 * - Text always wears an ink token, never the series colour; the colour sits
 *   in the swatch *beside* the text.
 * - A legend whenever there are ≥ 2 series, plus selective direct labels at
 *   the curve ends; a single series gets neither (the title names it).
 * - No value printed on every point unless the student explicitly asks for
 *   it (`showValueLabels`).
 */

import { CHART_COLORS, CHART_FONT_STACK } from "./palette";
import { buildPolylines, sampleValues } from "./sample";
import {
  autoRangeFromSamples,
  createScale,
  formatTick,
  niceTicks,
  shouldUseCompactTicks,
} from "./scale";
import { compileExpression } from "./expression";
import { isFunctionSpec, seriesColor } from "./spec";

import type { GraphSpec, FunctionGraphSpec, ChartGraphSpec } from "./spec";

/** Default on-page size in CSS px — fits a Letter/A4 page with margins. */
export const DEFAULT_GRAPH_WIDTH = 560;
export const DEFAULT_GRAPH_HEIGHT = 360;
/** Rendered at 2× so it stays crisp when zoomed or printed. */
export const DEFAULT_PIXEL_RATIO = 2;

export interface RenderGraphOptions {
  /** Logical width in CSS px. Default {@link DEFAULT_GRAPH_WIDTH}. */
  width?: number;
  /** Logical height in CSS px. Default {@link DEFAULT_GRAPH_HEIGHT}. */
  height?: number;
  /** Device pixels per CSS px. Default {@link DEFAULT_PIXEL_RATIO}. */
  pixelRatio?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderGraphResult {
  width: number;
  height: number;
  pixelRatio: number;
  /** The plot area, in CSS px, for tests and hit-testing. */
  plot: Rect;
  xRange: { min: number; max: number };
  yRange: { min: number; max: number };
  /** Polyline breaks inserted at poles (function plots). */
  breaks: number;
  /** Non-finite samples skipped (function plots). */
  skipped: number;
  /** Series that failed to parse and were left out. */
  failedSeries: { id: string; message: string }[];
  /** True when auto-ranging had to trim extreme samples (a pole was present). */
  yAutoClipped: boolean;
}

type Ctx = CanvasRenderingContext2D;

/** Anything with a 2D context: `HTMLCanvasElement` or `OffscreenCanvas`. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d", options?: unknown): unknown;
}

const FONT_TICK = 11;
const FONT_LABEL = 12;
const FONT_TITLE = 15;
const PAD = 14;
const BAR_MAX_THICKNESS = 24;
const SURFACE_GAP = 2;

const font = (size: number, weight: 400 | 600 = 400) =>
  `${weight} ${size}px ${CHART_FONT_STACK}`;

const crisp = (value: number) => Math.round(value) + 0.5;

const roundedBar = (
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  pointingUp: boolean,
) => {
  const r = Math.max(0, Math.min(radius, width / 2, Math.abs(height)));
  ctx.beginPath();
  if (pointingUp) {
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + height - r);
    ctx.quadraticCurveTo(x, y + height, x + r, y + height);
    ctx.lineTo(x + width - r, y + height);
    ctx.quadraticCurveTo(x + width, y + height, x + width, y + height - r);
    ctx.lineTo(x + width, y);
  }
  ctx.closePath();
  ctx.fill();
};

/* -------------------------------------------------------------------------- */
/* entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Draws `spec` onto `canvas`, resizing it to `width × height × pixelRatio`.
 * Never throws for a bad expression: unparseable series are reported in
 * {@link RenderGraphResult.failedSeries} and simply not drawn.
 */
export const renderGraphToCanvas = (
  canvas: CanvasLike,
  spec: GraphSpec,
  options: RenderGraphOptions = {},
): RenderGraphResult => {
  const width = Math.max(160, Math.round(options.width ?? DEFAULT_GRAPH_WIDTH));
  const height = Math.max(
    120,
    Math.round(options.height ?? DEFAULT_GRAPH_HEIGHT),
  );
  const pixelRatio = Math.max(1, Math.min(4, options.pixelRatio ?? DEFAULT_PIXEL_RATIO));

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) {
    throw new Error("Could not get a 2D drawing context for the graph.");
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CHART_COLORS.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "alphabetic";

  return isFunctionSpec(spec)
    ? renderFunctionPlot(ctx, spec, width, height, pixelRatio)
    : renderChart(ctx, spec, width, height, pixelRatio);
};

/* -------------------------------------------------------------------------- */
/* shared chrome                                                              */
/* -------------------------------------------------------------------------- */

interface ChromeLayout {
  plot: Rect;
  titleBottom: number;
  legendRows: number;
}

const measureTickWidth = (
  ctx: Ctx,
  labels: string[],
): number => {
  ctx.font = font(FONT_TICK);
  return labels.reduce((max, label) => Math.max(max, ctx.measureText(label).width), 0);
};

const drawTitle = (ctx: Ctx, title: string | undefined, x: number, y: number) => {
  if (!title?.trim()) {
    return;
  }
  ctx.font = font(FONT_TITLE, 600);
  ctx.fillStyle = CHART_COLORS.inkPrimary;
  ctx.textAlign = "left";
  ctx.fillText(title.trim(), x, y);
};

const drawAxisTitles = (
  ctx: Ctx,
  plot: Rect,
  xLabel: string | undefined,
  yLabel: string | undefined,
  height: number,
) => {
  ctx.font = font(FONT_LABEL);
  ctx.fillStyle = CHART_COLORS.inkSecondary;
  if (xLabel?.trim()) {
    ctx.textAlign = "center";
    ctx.fillText(xLabel.trim(), plot.x + plot.width / 2, height - 6);
  }
  if (yLabel?.trim()) {
    ctx.save();
    ctx.translate(12, plot.y + plot.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(yLabel.trim(), 0, 0);
    ctx.restore();
  }
};

const drawFrame = (ctx: Ctx, plot: Rect) => {
  ctx.strokeStyle = CHART_COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(plot.x), plot.y);
  ctx.lineTo(crisp(plot.x), crisp(plot.y + plot.height));
  ctx.lineTo(plot.x + plot.width, crisp(plot.y + plot.height));
  ctx.stroke();
};

interface LegendEntry {
  label: string;
  color: string;
}

/** Legend rows are measured before layout so the plot never overlaps them. */
const layoutLegend = (
  ctx: Ctx,
  entries: LegendEntry[],
  availableWidth: number,
): { rows: LegendEntry[][]; rowHeight: number } => {
  if (entries.length === 0) {
    return { rows: [], rowHeight: 0 };
  }
  ctx.font = font(FONT_TICK);
  const rows: LegendEntry[][] = [[]];
  let used = 0;
  for (const entry of entries) {
    const itemWidth = 18 + ctx.measureText(entry.label).width + 16;
    if (used + itemWidth > availableWidth && rows[rows.length - 1].length > 0) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(entry);
    used += itemWidth;
  }
  return { rows, rowHeight: 16 };
};

const drawLegend = (
  ctx: Ctx,
  rows: LegendEntry[][],
  x: number,
  top: number,
  rowHeight: number,
) => {
  ctx.font = font(FONT_TICK);
  ctx.textAlign = "left";
  rows.forEach((row, rowIndex) => {
    let cursor = x;
    const y = top + rowIndex * rowHeight + rowHeight / 2;
    for (const entry of row) {
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cursor, y);
      ctx.lineTo(cursor + 12, y);
      ctx.stroke();
      ctx.fillStyle = CHART_COLORS.inkSecondary;
      ctx.fillText(entry.label, cursor + 18, y + 4);
      cursor += 18 + ctx.measureText(entry.label).width + 16;
    }
  });
};

/* -------------------------------------------------------------------------- */
/* function plot                                                              */
/* -------------------------------------------------------------------------- */

const renderFunctionPlot = (
  ctx: Ctx,
  spec: FunctionGraphSpec,
  width: number,
  height: number,
  pixelRatio: number,
): RenderGraphResult => {
  const failedSeries: { id: string; message: string }[] = [];
  const compiled: {
    id: string;
    label: string;
    color: string;
    fn: (x: number) => number;
  }[] = [];

  spec.series.forEach((series, index) => {
    if (series.hidden) {
      return;
    }
    try {
      compiled.push({
        id: series.id,
        label: (series.label ?? series.expression).trim(),
        // colour follows the slot the series occupies in the spec, so hiding
        // one never repaints the others
        color: seriesColor(index),
        fn: compileExpression(series.expression),
      });
    } catch (error) {
      failedSeries.push({
        id: series.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const xMin = Math.min(spec.xMin, spec.xMax);
  const xMax = Math.max(spec.xMin, spec.xMax);
  const safeXMax = xMax === xMin ? xMin + 1 : xMax;

  // ---- y domain -----------------------------------------------------------
  let yMin: number;
  let yMax: number;
  let yAutoClipped = false;
  if (
    spec.yMode === "manual" &&
    Number.isFinite(spec.yMin) &&
    Number.isFinite(spec.yMax) &&
    (spec.yMax as number) > (spec.yMin as number)
  ) {
    yMin = spec.yMin as number;
    yMax = spec.yMax as number;
  } else {
    const pooled: number[] = [];
    for (const series of compiled) {
      for (const point of sampleValues(series.fn, xMin, safeXMax, 600)) {
        pooled.push(point.y);
      }
    }
    const range = autoRangeFromSamples(pooled, { padding: 0.08 });
    yMin = range.min;
    yMax = range.max;
    yAutoClipped = range.clipped;
  }

  // ---- layout -------------------------------------------------------------
  const yTicks = niceTicks(yMin, yMax, 6);
  const yCompact = shouldUseCompactTicks(yTicks.values);
  const yLabels = yTicks.values.map((v) =>
    formatTick(v, yTicks.decimals, yCompact),
  );
  const tickWidth = measureTickWidth(ctx, yLabels);
  const left = PAD + (spec.yLabel?.trim() ? 16 : 0) + tickWidth + 8;
  const right = PAD + 4;
  const titleHeight = spec.title?.trim() ? FONT_TITLE + 10 : 0;

  const legendEntries: LegendEntry[] =
    compiled.length >= 2
      ? compiled.map((series) => ({ label: series.label, color: series.color }))
      : [];
  const legend = layoutLegend(ctx, legendEntries, width - left - right);
  const legendHeight = legend.rows.length * legend.rowHeight;

  const top = PAD / 2 + titleHeight + legendHeight;
  const bottom = PAD + FONT_TICK + 8 + (spec.xLabel?.trim() ? 16 : 0);
  const plot: Rect = {
    x: left,
    y: top,
    width: Math.max(40, width - left - right),
    height: Math.max(40, height - top - bottom),
  };

  drawTitle(ctx, spec.title, PAD, PAD / 2 + FONT_TITLE);
  if (legend.rows.length) {
    drawLegend(ctx, legend.rows, left, PAD / 2 + titleHeight, legend.rowHeight);
  }

  const xScale = createScale(xMin, safeXMax, plot.x, plot.x + plot.width);
  const yScale = createScale(yMin, yMax, plot.y + plot.height, plot.y);
  const xTicks = niceTicks(xMin, safeXMax, Math.max(4, Math.round(plot.width / 90)));
  const xCompact = shouldUseCompactTicks(xTicks.values);

  // ---- grid ---------------------------------------------------------------
  if (spec.showGrid) {
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const value of xTicks.values) {
      const px = crisp(xScale(value));
      ctx.moveTo(px, plot.y);
      ctx.lineTo(px, plot.y + plot.height);
    }
    for (const value of yTicks.values) {
      const py = crisp(yScale(value));
      ctx.moveTo(plot.x, py);
      ctx.lineTo(plot.x + plot.width, py);
    }
    ctx.stroke();
  }

  drawFrame(ctx, plot);

  // ---- origin axes --------------------------------------------------------
  ctx.strokeStyle = CHART_COLORS.originAxis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (yMin < 0 && yMax > 0) {
    const py = crisp(yScale(0));
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.width, py);
  }
  if (xMin < 0 && safeXMax > 0) {
    const px = crisp(xScale(0));
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  }
  ctx.stroke();

  // ---- tick labels --------------------------------------------------------
  ctx.font = font(FONT_TICK);
  ctx.fillStyle = CHART_COLORS.inkSecondary;
  ctx.textAlign = "center";
  for (const value of xTicks.values) {
    ctx.fillText(
      formatTick(value, xTicks.decimals, xCompact),
      xScale(value),
      plot.y + plot.height + FONT_TICK + 6,
    );
  }
  ctx.textAlign = "right";
  yTicks.values.forEach((value, index) => {
    ctx.fillText(yLabels[index], plot.x - 8, yScale(value) + 4);
  });

  drawAxisTitles(ctx, plot, spec.xLabel, spec.yLabel, height);

  // ---- curves -------------------------------------------------------------
  let breaks = 0;
  let skipped = 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.width, plot.height);
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const endLabels: { y: number; x: number; text: string }[] = [];

  for (const series of compiled) {
    const result = buildPolylines(series.fn, xMin, safeXMax, {
      toScreenX: xScale,
      toScreenY: yScale,
      plotHeight: plot.height,
      baseSamples: Math.round(plot.width * pixelRatio),
    });
    breaks += result.breaks;
    skipped += result.skipped;
    ctx.strokeStyle = series.color;
    for (const run of result.runs) {
      if (run.length < 2) {
        continue;
      }
      ctx.beginPath();
      run.forEach((point, index) => {
        const px = xScale(point.x);
        const py = yScale(point.y);
        if (index === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.stroke();
    }
    if (compiled.length >= 2 && compiled.length <= 4) {
      // selective direct label at the right-hand end of the last visible run
      for (let i = result.runs.length - 1; i >= 0; i--) {
        const run = result.runs[i];
        const last = [...run]
          .reverse()
          .find(
            (point) =>
              yScale(point.y) >= plot.y + 6 &&
              yScale(point.y) <= plot.y + plot.height - 6,
          );
        if (last) {
          endLabels.push({
            x: xScale(last.x),
            y: yScale(last.y),
            text: series.label,
          });
          break;
        }
      }
    }
  }
  ctx.restore();

  // direct labels: skip any that would collide with one already placed
  ctx.font = font(FONT_TICK);
  ctx.fillStyle = CHART_COLORS.inkSecondary;
  ctx.textAlign = "left";
  const placed: number[] = [];
  for (const label of endLabels) {
    if (placed.some((y) => Math.abs(y - label.y) < 13)) {
      continue;
    }
    const textWidth = ctx.measureText(label.text).width;
    const x = Math.min(label.x + 6, plot.x + plot.width - textWidth - 2);
    if (x < plot.x) {
      continue;
    }
    // a 2px surface pad keeps the text legible where it crosses a curve
    ctx.fillStyle = CHART_COLORS.surface;
    ctx.fillRect(x - 2, label.y - 9, textWidth + 4, 13);
    ctx.fillStyle = CHART_COLORS.inkSecondary;
    ctx.fillText(label.text, x, label.y + 1);
    placed.push(label.y);
  }

  return {
    width,
    height,
    pixelRatio,
    plot,
    xRange: { min: xMin, max: safeXMax },
    yRange: { min: yMin, max: yMax },
    breaks,
    skipped,
    failedSeries,
    yAutoClipped,
  };
};

/* -------------------------------------------------------------------------- */
/* bar & line charts                                                          */
/* -------------------------------------------------------------------------- */

const renderChart = (
  ctx: Ctx,
  spec: ChartGraphSpec,
  width: number,
  height: number,
  _pixelRatio: number,
): RenderGraphResult => {
  const data = spec.data.filter(
    (row) => row.label.trim() !== "" || Number.isFinite(row.value),
  );
  const values = data.map((row) => (Number.isFinite(row.value) ? row.value : 0));
  const rawMax = values.length ? Math.max(...values) : 1;
  const rawMin = values.length ? Math.min(...values) : 0;
  const domainMax = rawMax > 0 ? rawMax : 0;
  const domainMin = rawMin < 0 ? rawMin : 0;
  const span = domainMax - domainMin || 1;
  const ticks = niceTicks(domainMin, domainMax + span * 0.08, 6);
  const yTop = Math.max(domainMax, ticks.values[ticks.values.length - 1] ?? 1);
  const yBottom = Math.min(domainMin, ticks.values[0] ?? 0);
  const compact = shouldUseCompactTicks(ticks.values);
  const tickLabels = ticks.values.map((v) =>
    formatTick(v, ticks.decimals, compact),
  );

  const tickWidth = measureTickWidth(ctx, tickLabels);
  const left = PAD + (spec.yLabel?.trim() ? 16 : 0) + tickWidth + 8;
  const right = PAD + 4;
  const titleHeight = spec.title?.trim() ? FONT_TITLE + 10 : 0;
  const top = PAD / 2 + titleHeight + (spec.showValueLabels ? 8 : 0);
  const plotWidth = Math.max(40, width - left - right);

  // category labels: rotate only when they cannot sit side by side
  ctx.font = font(FONT_TICK);
  const labelWidths = data.map((row) => ctx.measureText(row.label).width);
  const band = plotWidth / Math.max(1, data.length);
  const widest = labelWidths.length ? Math.max(...labelWidths) : 0;
  const rotate = widest + 8 > band;
  const labelBand = rotate
    ? Math.min(64, Math.ceil(widest * 0.72) + 10)
    : FONT_TICK + 8;
  const bottom = PAD / 2 + labelBand + 8 + (spec.xLabel?.trim() ? 16 : 0);

  const plot: Rect = {
    x: left,
    y: top,
    width: plotWidth,
    height: Math.max(40, height - top - bottom),
  };

  drawTitle(ctx, spec.title, PAD, PAD / 2 + FONT_TITLE);

  const yScale = createScale(yBottom, yTop, plot.y + plot.height, plot.y);

  if (spec.showGrid) {
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const value of ticks.values) {
      const py = crisp(yScale(value));
      ctx.moveTo(plot.x, py);
      ctx.lineTo(plot.x + plot.width, py);
    }
    ctx.stroke();
  }

  drawFrame(ctx, plot);

  ctx.font = font(FONT_TICK);
  ctx.fillStyle = CHART_COLORS.inkSecondary;
  ctx.textAlign = "right";
  ticks.values.forEach((value, index) => {
    ctx.fillText(tickLabels[index], plot.x - 8, yScale(value) + 4);
  });

  const baselineY = yScale(Math.max(yBottom, Math.min(0, yTop)));
  const color = seriesColor(0);

  if (spec.kind === "bar") {
    // cap the bar, and keep at least a 2px surface gap between neighbours
    const thickness = Math.max(
      2,
      Math.min(BAR_MAX_THICKNESS, band - Math.max(SURFACE_GAP, band * 0.3)),
    );
    ctx.fillStyle = color;
    data.forEach((row, index) => {
      const value = Number.isFinite(row.value) ? row.value : 0;
      const centre = plot.x + band * (index + 0.5);
      const top0 = yScale(value);
      const barHeight = top0 - baselineY;
      roundedBar(
        ctx,
        centre - thickness / 2,
        value >= 0 ? top0 : baselineY,
        thickness,
        Math.abs(barHeight),
        4,
        value >= 0,
      );
    });
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x - 6, plot.y - 6, plot.width + 12, plot.height + 12);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    data.forEach((row, index) => {
      const px = plot.x + band * (index + 0.5);
      const py = yScale(Number.isFinite(row.value) ? row.value : 0);
      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();
    // markers: r ≥ 4 with a 2px surface ring so they stay legible on the line
    data.forEach((row, index) => {
      const px = plot.x + band * (index + 0.5);
      const py = yScale(Number.isFinite(row.value) ? row.value : 0);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = CHART_COLORS.surface;
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---- category labels ----------------------------------------------------
  ctx.font = font(FONT_TICK);
  ctx.fillStyle = CHART_COLORS.inkSecondary;
  data.forEach((row, index) => {
    const centre = plot.x + band * (index + 0.5);
    const baseline = plot.y + plot.height + FONT_TICK + 4;
    if (!row.label.trim()) {
      return;
    }
    if (rotate) {
      ctx.save();
      ctx.translate(centre, plot.y + plot.height + 10);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText(row.label, 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      ctx.fillText(row.label, centre, baseline);
    }
  });

  // ---- optional value labels ---------------------------------------------
  if (spec.showValueLabels) {
    ctx.font = font(FONT_TICK, 600);
    ctx.fillStyle = CHART_COLORS.inkPrimary;
    ctx.textAlign = "center";
    data.forEach((row, index) => {
      const value = Number.isFinite(row.value) ? row.value : 0;
      const centre = plot.x + band * (index + 0.5);
      const py = yScale(value);
      const text = formatTick(value, ticks.decimals, compact);
      // never let a label overflow the top of the plot
      const y = value >= 0 ? Math.max(plot.y + 9, py - 6) : py + 14;
      ctx.fillText(text, centre, y);
    });
  }

  drawAxisTitles(ctx, plot, spec.xLabel, spec.yLabel, height);

  return {
    width,
    height,
    pixelRatio: _pixelRatio,
    plot,
    xRange: { min: 0, max: Math.max(1, data.length) },
    yRange: { min: yBottom, max: yTop },
    breaks: 0,
    skipped: 0,
    failedSeries: [],
    yAutoClipped: false,
  };
};
