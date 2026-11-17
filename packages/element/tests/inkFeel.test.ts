import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_INK_FEEL,
  getPreferRealPenPressure,
  getUseStrokeModeler,
  resolveFreedrawStrokeOptions,
  setInkFeel,
  setPreferRealPenPressure,
  setUseStrokeModeler,
  shouldSimulatePressure,
} from "../src/inkFeel";

describe("inkFeel", () => {
  afterEach(() => {
    setInkFeel(DEFAULT_INK_FEEL);
    setPreferRealPenPressure(true);
    setUseStrokeModeler(true);
  });

  it("defaults to precise handwriting feel", () => {
    expect(DEFAULT_INK_FEEL).toBe("precise");
    const opts = resolveFreedrawStrokeOptions({
      pointerType: "pen",
      variability: "variable",
    });
    expect(opts.streamline).toBe(0.08);
    expect(opts.smoothing).toBe(0.35);
    expect(opts.thinning).toBe(0.7);
  });

  it("omits smoothing/thinning only when they match renderer (balanced) defaults", () => {
    setInkFeel("balanced");
    const opts = resolveFreedrawStrokeOptions({
      pointerType: "mouse",
      variability: "constant",
    });
    expect(opts.streamline).toBe(0.5);
    expect(opts.smoothing).toBeUndefined();
    expect(opts.thinning).toBeUndefined();
  });

  it("trusts real pen pressure when preferred", () => {
    setPreferRealPenPressure(true);
    expect(shouldSimulatePressure({ pointerType: "pen", pressure: 0.5 })).toBe(
      false,
    );
    expect(
      shouldSimulatePressure({ pointerType: "mouse", pressure: 0.5 }),
    ).toBe(true);
  });

  it("exposes stroke-modeler preference", () => {
    expect(getUseStrokeModeler()).toBe(true);
    setUseStrokeModeler(false);
    expect(getUseStrokeModeler()).toBe(false);
    expect(getPreferRealPenPressure()).toBe(true);
  });
});
