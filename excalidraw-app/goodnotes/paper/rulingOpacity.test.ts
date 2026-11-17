import { describe, expect, it } from "vitest";

import { rulingOpacityForZoom } from "./templates";

describe("rulingOpacityForZoom", () => {
  it("fades when zoomed out and peaks near reading zoom", () => {
    expect(rulingOpacityForZoom(0.2)).toBeCloseTo(0.28);
    expect(rulingOpacityForZoom(1.25)).toBe(1);
    expect(rulingOpacityForZoom(0.8)).toBeGreaterThan(0.28);
    expect(rulingOpacityForZoom(0.8)).toBeLessThan(1);
  });
});
