/**
 * Colours for the rendered graph.
 *
 * These are the validated categorical slots and chart chrome from the
 * `dataviz` reference palette, in their **light** steps. The graph is drawn
 * once and ends up as a picture on a white page (and in an exported PDF), so
 * it is always rendered for a light surface regardless of the editor's UI
 * theme — a dark-themed PNG pasted on white paper is unreadable.
 *
 * Validated with the skill's checker against the surface we actually draw on:
 *
 * ```
 * node scripts/validate_palette.js \
 *   "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#6250d6,#e34948" \
 *   --mode light --surface "#ffffff"
 * → lightness band PASS · chroma floor PASS
 * → CVD separation PASS (worst adjacent ΔE 9.1)
 * → normal-vision floor PASS (worst adjacent ΔE 19.6)
 * → contrast WARN for aqua/yellow/magenta (<3:1): the relief is the always-
 *   present legend plus direct labels, which is what we draw.
 * ```
 *
 * Slot order is the CVD-safety mechanism; it is assigned per series **id**,
 * never per current row, so hiding a curve never repaints the others.
 */

/** Categorical slots, in fixed order. Never cycle past these — cap instead. */
export const SERIES_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#6250d6", // violet
  "#e34948", // red
] as const;

/** Chart chrome and ink, light steps. */
export const CHART_COLORS = {
  /** The paper the graph lands on. */
  surface: "#ffffff",
  /** Title and anything that must read first. */
  inkPrimary: "#0b0b0b",
  /** Tick labels, axis titles, legend text. */
  inkSecondary: "#52514e",
  /** Non-essential annotation. */
  inkMuted: "#898781",
  /** Hairline grid — one step off the surface, solid, never dashed. */
  grid: "#e1e0d9",
  /** Plot frame / baseline. */
  axis: "#c3c2b7",
  /** The x = 0 / y = 0 lines of a function plot, a step stronger than grid. */
  originAxis: "#898781",
} as const;

/** The one typeface, per the skill: system sans everywhere. */
export const CHART_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
