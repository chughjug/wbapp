import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ERASER_SIZE_ID,
  setEraserSizeId,
} from "@excalidraw/excalidraw/eraser/size";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DockInkOrb } from "./DockInkOrb";

const listeners = new Set<() => void>();

const makeApi = (
  tool: "freedraw" | "eraser" | "selection" = "freedraw",
): ExcalidrawImperativeAPI => {
  const appState = {
    activeTool: { type: tool, locked: true },
    currentItemStrokeColor: "#1971c2",
    currentItemFreedrawStrokeWidth: 1,
    currentItemStrokeWidthKey: "medium",
    currentItemOpacity: 100,
    currentItemFontSize: 20,
    currentItemCustomData: null,
  };
  return {
    isDestroyed: false,
    getAppState: () => appState,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    updateScene: vi.fn(),
    setActiveTool: vi.fn(),
    resetCursor: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
};

afterEach(() => {
  listeners.clear();
  setEraserSizeId(DEFAULT_ERASER_SIZE_ID);
  localStorage.clear();
});

describe("<DockInkOrb />", () => {
  it("hides for non-ink tools", () => {
    const { container } = render(
      <DockInkOrb excalidrawAPI={makeApi("selection")} activeTool={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a colour panel from the corner orb", () => {
    render(<DockInkOrb excalidrawAPI={makeApi()} activeTool="pen" />);
    const orb = screen.getByRole("button", { name: /Current ink colour/i });
    fireEvent.click(orb);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#e03131" })).toBeInTheDocument();
  });

  it("shows eraser sizes when the eraser is active", () => {
    render(
      <DockInkOrb excalidrawAPI={makeApi("eraser")} activeTool="eraser" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Eraser size/i }));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(localStorage.getItem("goodnotes-eraser-size")).toBe("l");
  });
});
