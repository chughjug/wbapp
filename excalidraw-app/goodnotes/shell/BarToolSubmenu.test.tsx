import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ERASER_SIZE_ID,
  setEraserSizeId,
} from "@excalidraw/excalidraw/eraser/size";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { BarToolSubmenu } from "./BarToolSubmenu";

const listeners = new Set<() => void>();

const makeApi = (
  tool: "freedraw" | "eraser" | "text" | "rectangle" = "freedraw",
  extras: Record<string, unknown> = {},
): ExcalidrawImperativeAPI => {
  const appState = {
    activeTool: { type: tool, locked: true },
    currentItemStrokeColor: "#1e1e1e",
    currentItemFreedrawStrokeWidth: 0.5,
    currentItemStrokeWidthKey: "thin",
    currentItemOpacity: 100,
    currentItemFontSize: 20,
    currentItemCustomData: null,
    ...extras,
  };
  return {
    isDestroyed: false,
    getAppState: () => appState,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    updateScene: vi.fn(
      ({ appState: patch }: { appState?: Record<string, unknown> }) => {
        Object.assign(appState, patch);
        listeners.forEach((listener) => listener());
      },
    ),
    setActiveTool: vi.fn(({ type }: { type: string }) => {
      appState.activeTool = {
        type,
        locked: true,
      } as typeof appState.activeTool;
      listeners.forEach((listener) => listener());
    }),
    resetCursor: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
};

afterEach(() => {
  listeners.clear();
  setEraserSizeId(DEFAULT_ERASER_SIZE_ID);
  localStorage.clear();
});

describe("<BarToolSubmenu />", () => {
  it("renders nothing for select-like tools", () => {
    const selectionApi = makeApi("freedraw");
    (selectionApi.getAppState as any) = () => ({
      activeTool: { type: "selection", locked: false },
      currentItemStrokeColor: "#1e1e1e",
      currentItemFreedrawStrokeWidth: 0.5,
      currentItemStrokeWidthKey: "thin",
      currentItemOpacity: 100,
      currentItemFontSize: 20,
      currentItemCustomData: null,
    });
    const { container } = render(
      <BarToolSubmenu excalidrawAPI={selectionApi} activeTool={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows pen colour and width controls", () => {
    render(<BarToolSubmenu excalidrawAPI={makeApi()} activeTool="pen" />);
    expect(
      screen.getByRole("toolbar", { name: "Pen options" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    const bold = screen.getByRole("button", { name: "Bold, 2" });
    fireEvent.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");
  });

  it("shows eraser size chips and remembers the choice", () => {
    const api = makeApi("eraser");
    render(<BarToolSubmenu excalidrawAPI={api} activeTool="eraser" />);
    expect(
      screen.getByRole("toolbar", { name: "Eraser options" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Extra large/i }));
    expect(
      screen.getByRole("button", { name: /Extra large/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(api.resetCursor).toHaveBeenCalled();
    expect(localStorage.getItem("goodnotes-eraser-size")).toBe("xl");
  });

  it("shows highlighter and text option strips", () => {
    const { rerender } = render(
      <BarToolSubmenu
        excalidrawAPI={makeApi("freedraw", {
          currentItemCustomData: { goodnotes: { highlighter: true } },
        })}
        activeTool="highlighter"
      />,
    );
    expect(
      screen.getByRole("toolbar", { name: "Highlighter options" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yellow" })).toBeInTheDocument();

    rerender(
      <BarToolSubmenu excalidrawAPI={makeApi("text")} activeTool="text" />,
    );
    expect(
      screen.getByRole("toolbar", { name: "Text options" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "L" }));
  });

  it("shows shape options under the bar", () => {
    render(
      <BarToolSubmenu
        excalidrawAPI={makeApi("rectangle")}
        activeTool="shape"
      />,
    );
    expect(
      screen.getByRole("toolbar", { name: "Shape options" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  });
});
