/**
 * Turning `f(x)` into drawable polylines.
 *
 * Two problems the naive "200 evenly spaced points" loop gets wrong, and
 * which this module exists to solve:
 *
 * 1. **Poles and asymptotes.** `1/x` on `[-5, 5]` jumps from −1e6 to +1e6
 *    across x = 0. Joined up, that is a vertical line straight through the
 *    plot which is not part of the function. Any pair of consecutive samples
 *    whose screen jump is several plot-heights **and** whose signs differ is
 *    treated as a pole: the polyline is broken, so the two branches run off
 *    the top and bottom independently. `tan(x)` gets the same treatment at
 *    every π/2.
 * 2. **Smoothness.** Uniform sampling either wastes points on flat stretches
 *    or corners a steep one. {@link buildPolylines} starts at roughly one
 *    sample per device pixel and then **adaptively bisects** any segment
 *    whose midpoint deviates from the chord by more than a fraction of a
 *    pixel, down to `maxDepth` levels.
 *
 * Non-finite samples (`NaN` from `sqrt(-1)`, `±Infinity` from `1/0`) are
 * never drawn; they end the current run.
 */

export interface CurvePoint {
  x: number;
  y: number;
}

/** Evenly spaced samples, used for auto-ranging before any pixels exist. */
export const sampleValues = (
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  count: number,
): CurvePoint[] => {
  const total = Math.max(2, Math.min(20000, Math.floor(count)));
  const points: CurvePoint[] = new Array(total);
  const step = (xMax - xMin) / (total - 1);
  for (let i = 0; i < total; i++) {
    const x = i === total - 1 ? xMax : xMin + i * step;
    points[i] = { x, y: fn(x) };
  }
  return points;
};

export interface PolylineOptions {
  /** data x → device px. */
  toScreenX: (x: number) => number;
  /** data y → device px. */
  toScreenY: (y: number) => number;
  /** Plot height in device px — the scale a "huge" jump is measured against. */
  plotHeight: number;
  /** Base samples across the plot. Defaults to the plot width in px. */
  baseSamples?: number;
  /** Adaptive bisection depth. Default 8. */
  maxDepth?: number;
  /** Chord deviation, in px, that triggers bisection. Default 0.3. */
  flatnessPx?: number;
  /**
   * Screen jump, as a multiple of the plot height, above which a sign change
   * is read as a pole rather than a steep slope. Default 3.
   */
  poleJumpFactor?: number;
  /** Hard cap on emitted points, so a pathological expression can't hang. */
  maxPoints?: number;
}

export interface PolylineResult {
  /** Continuous runs, in data coordinates. Each is drawn as one path. */
  runs: CurvePoint[][];
  /** How many breaks the pole detector inserted. */
  breaks: number;
  /** How many samples were non-finite. */
  skipped: number;
  /** Total samples evaluated. */
  evaluated: number;
}

const isFinitePoint = (point: CurvePoint) => Number.isFinite(point.y);

/**
 * Samples `fn` adaptively and splits the result into continuous runs,
 * breaking at non-finite samples and at poles.
 */
export const buildPolylines = (
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  options: PolylineOptions,
): PolylineResult => {
  const {
    toScreenX,
    toScreenY,
    plotHeight,
    maxDepth = 8,
    flatnessPx = 0.3,
    poleJumpFactor = 3,
    maxPoints = 60000,
  } = options;
  const baseSamples = Math.max(
    32,
    Math.min(4000, Math.round(options.baseSamples ?? 600)),
  );

  const points: CurvePoint[] = [];
  let evaluated = 0;
  const evaluate = (x: number): CurvePoint => {
    evaluated++;
    return { x, y: fn(x) };
  };

  /** Deviation of the midpoint from the straight chord, in device px. */
  const deviation = (a: CurvePoint, m: CurvePoint, b: CurvePoint): number => {
    if (!isFinitePoint(a) || !isFinitePoint(b) || !isFinitePoint(m)) {
      return Infinity;
    }
    const ax = toScreenX(a.x);
    const ay = toScreenY(a.y);
    const bx = toScreenX(b.x);
    const by = toScreenY(b.y);
    const mx = toScreenX(m.x);
    const my = toScreenY(m.y);
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) {
      return Math.hypot(mx - ax, my - ay);
    }
    return Math.abs(dy * (mx - ax) - dx * (my - ay)) / length;
  };

  const refine = (a: CurvePoint, b: CurvePoint, depth: number): void => {
    if (depth >= maxDepth || points.length >= maxPoints) {
      return;
    }
    const mid = evaluate((a.x + b.x) / 2);
    const isFlatEnough =
      isFinitePoint(a) &&
      isFinitePoint(b) &&
      deviation(a, mid, b) <= flatnessPx;
    if (isFlatEnough) {
      points.push(mid);
      return;
    }
    refine(a, mid, depth + 1);
    points.push(mid);
    refine(mid, b, depth + 1);
  };

  const step = (xMax - xMin) / baseSamples;
  let previous = evaluate(xMin);
  points.push(previous);
  for (let i = 1; i <= baseSamples; i++) {
    const current = evaluate(i === baseSamples ? xMax : xMin + i * step);
    refine(previous, current, 0);
    points.push(current);
    previous = current;
  }

  // ---- split into runs ----------------------------------------------------
  const poleJump = plotHeight * poleJumpFactor;
  const runs: CurvePoint[][] = [];
  let run: CurvePoint[] = [];
  let breaks = 0;
  let skipped = 0;

  const flush = () => {
    if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!isFinitePoint(point)) {
      skipped++;
      flush();
      continue;
    }
    const last = run[run.length - 1];
    if (last) {
      const jump = Math.abs(toScreenY(point.y) - toScreenY(last.y));
      const signFlip = Math.sign(point.y) !== Math.sign(last.y);
      if (jump > poleJump && signFlip) {
        // a pole: the two branches are not connected
        breaks++;
        flush();
      }
    }
    run.push(point);
  }
  flush();

  return { runs, breaks, skipped, evaluated };
};
