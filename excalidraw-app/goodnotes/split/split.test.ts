import { describe, expect, it } from "vitest";

import {
  clampSplit,
  MAX_SPLIT,
  MIN_SPLIT,
  SIDE_BY_SIDE_MIN_WIDTH,
  splitOrientationFor,
} from "./renderReference";

describe("the split fraction", () => {
  it("leaves a sensible split alone", () => {
    expect(clampSplit(0.4)).toBe(0.4);
    expect(clampSplit(0.5)).toBe(0.5);
  });

  it("will not let the pane shrink to just its handle", () => {
    expect(clampSplit(0.01)).toBe(MIN_SPLIT);
    expect(clampSplit(-3)).toBe(MIN_SPLIT);
  });

  it("will not let the pane squeeze out the notebook", () => {
    expect(clampSplit(0.99)).toBe(MAX_SPLIT);
    expect(clampSplit(4)).toBe(MAX_SPLIT);
  });

  it("keeps both sides usable at either bound", () => {
    // whichever end the user drags to, the smaller side still has a fifth
    // of the workspace — below that neither column is readable
    expect(MIN_SPLIT).toBeGreaterThanOrEqual(0.15);
    expect(1 - MAX_SPLIT).toBeGreaterThanOrEqual(0.15);
  });
});

describe("which way the split goes", () => {
  it("sits side by side when there is width for two columns", () => {
    expect(splitOrientationFor(1194)).toBe("side-by-side");
    expect(splitOrientationFor(SIDE_BY_SIDE_MIN_WIDTH)).toBe("side-by-side");
  });

  it("stacks on a phone rather than making two unreadable columns", () => {
    // 390 split in two is a 156px reference column; that is not a split
    // view, it is two broken ones
    expect(splitOrientationFor(390)).toBe("stacked");
    expect(splitOrientationFor(SIDE_BY_SIDE_MIN_WIDTH - 1)).toBe("stacked");
  });

  it("handles a zero width during first layout", () => {
    expect(splitOrientationFor(0)).toBe("stacked");
  });
});
