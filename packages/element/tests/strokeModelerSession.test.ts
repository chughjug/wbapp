import { describe, expect, it } from "vitest";

import { StrokeModelerSession } from "../src/strokeModelerSession";

describe("StrokeModelerSession", () => {
  it("models a short stroke and can predict a wet-ink tip", () => {
    const session = new StrokeModelerSession();
    expect(session.isFailed).toBe(false);

    const down = session.down({
      x: 10,
      y: 10,
      pressure: 0.4,
      time: 1,
    });
    expect(down.length).toBeGreaterThan(0);
    expect(session.isActive).toBe(true);

    const moved = session.move({
      x: 40,
      y: 18,
      pressure: 0.55,
      time: 1.02,
    });
    expect(moved.length).toBeGreaterThan(0);

    const prediction = session.predict();
    // stroke_end predictor may or may not emit samples depending on state;
    // the call itself must not throw / fail the session
    expect(Array.isArray(prediction)).toBe(true);
    expect(session.isFailed).toBe(false);

    const up = session.up({
      x: 55,
      y: 22,
      pressure: 0.3,
      time: 1.05,
    });
    expect(up.length).toBeGreaterThan(0);
    expect(session.isActive).toBe(false);
  });
});
