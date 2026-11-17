import { describe, expect, it } from "vitest";

import type { LocalPoint } from "@excalidraw/math";

import { newFreeDrawElement } from "../src/newElement";
import {
  getFreedrawHairlineInkWidth,
  getFreedrawUniformInkWidth,
} from "../src/shape";

const baseOpts = {
  type: "freedraw" as const,
  x: 0,
  y: 0,
  strokeColor: "#000",
  backgroundColor: "transparent",
  fillStyle: "solid" as const,
  strokeWidth: 0.2,
  strokeStyle: "solid" as const,
  roughness: 0,
  opacity: 100,
  roundness: null,
  simulatePressure: false,
  locked: false,
  points: [[0, 0] as LocalPoint, [10, 0] as LocalPoint],
  pressures: [0.5, 0.5],
};

describe("freedraw hairline ink width", () => {
  it("returns the measured constant-width ribbon for uniform pens", () => {
    const element = newFreeDrawElement({
      ...baseOpts,
      strokeOptions: { variability: "constant", streamline: 0.2 },
    });
    // SIZE_FACTOR 1.4 × 2 = 2.8
    expect(getFreedrawUniformInkWidth(element)).toBeCloseTo(0.2 * 2.8);
    expect(getFreedrawHairlineInkWidth(element)).toBeCloseTo(0.2 * 2.8);
  });

  it("returns a representative diameter for variable-width pens", () => {
    const element = newFreeDrawElement({
      ...baseOpts,
      strokeOptions: { variability: "variable", streamline: 0.08 },
    });
    expect(getFreedrawUniformInkWidth(element)).toBe(0);
    // SIZE_FACTOR 4.25
    expect(getFreedrawHairlineInkWidth(element)).toBeCloseTo(0.2 * 4.25);
  });

  it("treats missing variability as variable (historical default)", () => {
    const element = newFreeDrawElement({
      ...baseOpts,
    });
    // newFreeDrawElement may omit strokeOptions; hairline still uses the
    // variable-width diameter (perfect-freehand SIZE_FACTOR)
    expect(getFreedrawHairlineInkWidth(element)).toBeCloseTo(0.2 * 4.25);
  });
});
