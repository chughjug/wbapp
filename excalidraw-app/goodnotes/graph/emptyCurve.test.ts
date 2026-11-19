import { describe, expect, it } from "vitest";

import { createFunctionSpec, validateGraphSpec } from "./spec";

/**
 * An expression can parse cleanly and still have no value anywhere in range.
 * The dialog used to accept those and insert empty axes, because validation
 * only ever parsed. These pin the line between "undefined everywhere"
 * (rejected) and "undefined in places" (fine — that is most interesting
 * maths).
 */

const problemsFor = (expression: string, xMin = -5, xMax = 5) =>
  validateGraphSpec(
    createFunctionSpec({
      series: [{ id: "s1", expression }],
      xMin,
      xMax,
    }),
  ).filter((problem) => problem.field === "series:s1");

const messageFor = (expression: string, xMin?: number, xMax?: number) =>
  problemsFor(expression, xMin, xMax)[0]?.message ?? "";

describe("expressions that parse but plot nothing", () => {
  it.each([
    ["1/0", "a constant pole"],
    ["sqrt(-1)", "NaN across the whole range"],
    ["exp(1000)", "overflows to Infinity"],
    ["ln(-1 - x^2)", "log of a strictly negative quantity"],
  ])("rejects %s (%s)", (expression) => {
    expect(messageFor(expression)).toMatch(/nothing to draw/i);
  });

  it("names the x-range in the message, since widening it can be the fix", () => {
    expect(messageFor("1/0")).toMatch(/x-range/i);
  });
});

describe("expressions that are only partly defined", () => {
  it.each([
    ["ln(x)", "undefined for x <= 0"],
    ["sqrt(x)", "undefined for x < 0"],
    ["1/x", "a pole at the origin"],
    ["tan(x)", "poles at every pi/2"],
  ])("accepts %s (%s)", (expression) => {
    expect(problemsFor(expression)).toEqual([]);
  });

  it("accepts a curve finite at only one sampled point", () => {
    // sqrt(-x^2) is 0 at x = 0 and NaN everywhere else; the range is
    // symmetric about 0, so exactly one probe lands on the finite point
    expect(problemsFor("sqrt(0 - x^2)", -4, 4)).toEqual([]);
  });

  it("rejects that same curve once the range excludes its one point", () => {
    expect(messageFor("sqrt(0 - x^2)", 1, 4)).toMatch(/nothing to draw/i);
  });
});

describe("scientific-notation lookalikes", () => {
  it("reads 1e999 as 1 * e * 999, not as an overflowing literal", () => {
    // `e` is documented as Euler's constant and juxtaposition as
    // multiplication, so this is a flat line at ~2715.6, not Infinity.
    // Pinned so the empty-curve probe is never 'fixed' into rejecting it.
    expect(problemsFor("1e999")).toEqual([]);
  });
});

describe("the probe does not mask other problems", () => {
  it("still reports a parse error rather than an empty-curve error", () => {
    expect(messageFor("sin(")).not.toMatch(/nothing to draw/i);
    expect(messageFor("sin(")).toMatch(/stops in the middle/i);
  });

  it("reports nothing extra for a well-formed curve", () => {
    expect(problemsFor("x^2 - 3x + 2")).toEqual([]);
  });

  it("skips the probe when the x-range is itself invalid", () => {
    // xMax <= xMin is already reported against the range; probing a
    // backwards range as well would be a second, confusing message
    const problems = validateGraphSpec(
      createFunctionSpec({
        series: [{ id: "s1", expression: "1/0" }],
        xMin: Number.NaN,
        xMax: 5,
      }),
    );
    expect(problems.filter((p) => p.field === "series:s1")).toEqual([]);
    expect(problems.some((p) => p.field === "xRange")).toBe(true);
  });
});
