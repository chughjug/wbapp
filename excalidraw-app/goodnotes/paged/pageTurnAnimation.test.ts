import { afterEach, describe, expect, it, vi } from "vitest";

import { playPageTurnAnimation } from "./pageTurnAnimation";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("playPageTurnAnimation", () => {
  it("adds a next/prev class on the shell canvas", () => {
    const canvas = document.createElement("div");
    canvas.className = "gn-shell-canvas";
    document.body.appendChild(canvas);

    playPageTurnAnimation(1);
    expect(canvas.classList.contains("gn-page-turn--next")).toBe(true);

    playPageTurnAnimation(-1);
    expect(canvas.classList.contains("gn-page-turn--prev")).toBe(true);
    expect(canvas.classList.contains("gn-page-turn--next")).toBe(false);
  });

  it("no-ops when the canvas is missing", () => {
    expect(() => playPageTurnAnimation(1)).not.toThrow();
  });
});
