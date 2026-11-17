import { describe, expect, it } from "vitest";

import { clampPresentationIndex } from "./presentation";

describe("clampPresentationIndex", () => {
  it("clamps into range", () => {
    expect(clampPresentationIndex(-1, 3)).toBe(0);
    expect(clampPresentationIndex(0, 3)).toBe(0);
    expect(clampPresentationIndex(2, 3)).toBe(2);
    expect(clampPresentationIndex(9, 3)).toBe(2);
  });

  it("returns 0 for empty decks", () => {
    expect(clampPresentationIndex(2, 0)).toBe(0);
  });
});
