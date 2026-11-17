import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ERASER_SIZE_ID,
  ERASER_SIZE_OPTIONS,
  getEraserRadius,
  getEraserSize,
  getEraserSizeId,
  setEraserSizeId,
} from "./size";

afterEach(() => {
  setEraserSizeId(DEFAULT_ERASER_SIZE_ID);
});

describe("eraser size", () => {
  it("defaults to medium", () => {
    expect(getEraserSizeId()).toBe("m");
    expect(getEraserSize()).toEqual(ERASER_SIZE_OPTIONS[1]);
    expect(getEraserRadius()).toBe(15);
  });

  it("switches brush radius for each size", () => {
    for (const option of ERASER_SIZE_OPTIONS) {
      expect(setEraserSizeId(option.id)).toEqual(option);
      expect(getEraserSizeId()).toBe(option.id);
      expect(getEraserRadius()).toBe(option.radius);
      expect(getEraserSize().cursorPx).toBe(option.cursorPx);
    }
  });

  it("falls back to medium for an unknown id", () => {
    expect(setEraserSizeId("nope" as any).id).toBe("m");
    expect(getEraserSizeId()).toBe("m");
  });
});
