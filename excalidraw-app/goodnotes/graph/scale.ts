/**
 * Axis maths: nice tick intervals, robust auto-ranging and number
 * formatting. No drawing happens here, so all of it is unit-testable
 * without a canvas.
 */

/** A linear data→pixel mapping for one axis. */
export interface LinearScale {
  domainMin: number;
  domainMax: number;
  rangeMin: number;
  rangeMax: number;
  /** data → px */
  (value: number): number;
}

export const createScale = (
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): LinearScale => {
  const span = domainMax - domainMin || 1;
  const fn = ((value: number) =>
    rangeMin +
    ((value - domainMin) / span) * (rangeMax - rangeMin)) as LinearScale;
  fn.domainMin = domainMin;
  fn.domainMax = domainMax;
  fn.rangeMin = rangeMin;
  fn.rangeMax = rangeMax;
  return fn;
};

/**
 * Rounds a raw step up to the next "nice" number — 1, 2, 2.5 or 5 times a
 * power of ten. This is why ticks read 0, 2, 4, 6 instead of 0, 1.7, 3.4.
 */
export const niceStep = (rawStep: number): number => {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const nice =
    normalized <= 1
      ? 1
      : normalized <= 2
      ? 2
      : normalized <= 2.5
      ? 2.5
      : normalized <= 5
      ? 5
      : 10;
  return nice * magnitude;
};

export interface TickSet {
  values: number[];
  step: number;
  /** Decimal places that render every tick exactly. */
  decimals: number;
}

/**
 * Ticks at nice round numbers covering `[min, max]`, aiming for roughly
 * `target` of them (never the raw `range / 10`).
 */
export const niceTicks = (min: number, max: number, target = 6): TickSet => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { values: [min], step: 1, decimals: 0 };
  }
  const step = niceStep((max - min) / Math.max(2, target));
  const decimals = Math.max(
    0,
    Math.min(6, Math.ceil(-Math.log10(step)) + (step % 1 === 0 ? 0 : 1)),
  );
  const values: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  // guard against runaway loops from pathological ranges
  for (let i = 0, v = first; v <= max + step * 1e-9 && i < 1000; i++) {
    // re-derive from the index so floating-point error doesn't accumulate
    v = first + i * step;
    if (v > max + step * 1e-9) {
      break;
    }
    values.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { values, step, decimals };
};

/** Formats an axis tick: full under 10,000, compact on an axis that reaches it. */
export const formatTick = (
  value: number,
  decimals: number,
  compact: boolean,
): string => {
  if (!Number.isFinite(value)) {
    return "";
  }
  const minus = "−"; // real minus sign, not a hyphen
  if (compact && Math.abs(value) >= 1000) {
    const units: [number, string][] = [
      [1e9, "B"],
      [1e6, "M"],
      [1e3, "K"],
    ];
    for (const [factor, suffix] of units) {
      if (Math.abs(value) >= factor) {
        const scaled = value / factor;
        const text = `${
          Math.abs(scaled) < 10
            ? Math.round(scaled * 10) / 10
            : Math.round(scaled)
        }${suffix}`;
        return text.replace("-", minus);
      }
    }
  }
  const text = value.toFixed(decimals);
  const trimmed = decimals > 0 ? text.replace(/\.?0+$/, "") : text;
  return (trimmed === "-0" ? "0" : trimmed).replace("-", minus);
};

/** True when any tick in the set is big enough to deserve compact labels. */
export const shouldUseCompactTicks = (values: number[]): boolean =>
  values.some((value) => Math.abs(value) >= 10000);

export interface AutoRange {
  min: number;
  max: number;
  /** Set when poles forced the range to ignore extreme samples. */
  clipped: boolean;
}

/**
 * Picks a y-range from sampled values. Poles (`1/x`, `tan(x)`) would make a
 * naive min/max range useless — the interesting part of the curve collapses
 * into one pixel — so extreme samples are trimmed with a quantile band and
 * only then padded.
 */
export const autoRangeFromSamples = (
  values: readonly number[],
  options: { padding?: number; includeZero?: boolean } = {},
): AutoRange => {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: -1, max: 1, clipped: false };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const rawMin = sorted[0];
  const rawMax = sorted[sorted.length - 1];
  const quantile = (q: number) => {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  };
  const lowQ = quantile(0.02);
  const highQ = quantile(0.98);
  const innerSpan = highQ - lowQ;
  const fullSpan = rawMax - rawMin;
  // Only fall back to the trimmed band when the tails really are extreme.
  const clipped = innerSpan > 0 && fullSpan > innerSpan * 12;
  let min = clipped ? lowQ : rawMin;
  let max = clipped ? highQ : rawMax;
  if (clipped) {
    // keep a symmetric, readable window around the trimmed band
    const reach = Math.max(Math.abs(min), Math.abs(max));
    min = Math.min(min, -reach);
    max = Math.max(max, reach);
  }
  if (max - min < 1e-9) {
    const centre = (max + min) / 2;
    const unit = Math.max(1, Math.abs(centre));
    min = centre - unit / 2;
    max = centre + unit / 2;
  }
  const padding = options.padding ?? 0.08;
  const span = max - min;
  min -= span * padding;
  max += span * padding;
  if (options.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max, clipped };
};
