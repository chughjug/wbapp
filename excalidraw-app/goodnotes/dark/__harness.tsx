/* TEMPORARY verification harness — deleted before hand-off. Not part of the app. */
import { Excalidraw, exportScene } from "@excalidraw/excalidraw";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getExportConfigFromAppState } from "@excalidraw/excalidraw/scene/export";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "@excalidraw/excalidraw/index.scss";

import { PaperBackgroundLayer } from "../paper";

import { DarkModeToggle } from "./DarkModeToggle";
import { useDarkMode } from "./useDarkMode";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const PAGE_W = 816;
const PAGE_H = 1056;

const stroke = (
  x: number,
  y: number,
  w: number,
  color: string,
  highlighter: boolean,
  opacity: number,
) => ({
  type: "freedraw" as const,
  x,
  y,
  width: w,
  height: 10,
  strokeColor: color,
  backgroundColor: "transparent",
  strokeWidth: highlighter ? 16 : 4,
  opacity,
  points: [
    [0, 0],
    [w * 0.5, 2],
    [w, 0],
  ] as [number, number][],
  ...(highlighter ? { customData: { goodnotes: { highlighter: true } } } : {}),
});

const Harness = () => {
  const { theme, preference, setPreference } = useDarkMode();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    if (!api) {
      return;
    }
    const elements = convertToExcalidrawElements([
      {
        type: "frame",
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
        name: "page:0:lined",
      } as any,
      // black ink
      stroke(80, 200, 400, "#1e1e1e", false, 100),
      // blue ink
      stroke(80, 300, 400, "#1971c2", false, 100),
      // yellow highlighter
      stroke(80, 400, 400, "#ffd43b", true, 45),
    ] as any);
    api.updateScene({ elements, appState: { viewBackgroundColor: "#ffffff" } });
    api.scrollToContent(elements, { fitToViewport: true });
    (window as any).__gnApi = api;
  }, [api]);

  useEffect(() => {
    (window as any).__gn = {
      theme,
      async exportPixels(type: "png" | "svg") {
        const a = (window as any).__gnApi as ExcalidrawImperativeAPI;
        const appState = a.getAppState();
        const data = {
          elements: a.getSceneElements(),
          appState,
          files: a.getFiles(),
        };
        const config = getExportConfigFromAppState(appState as any);
        if (type === "svg") {
          const svg = await exportScene({
            type: "svg",
            data: data as any,
            config: config as any,
          });
          const markup = svg.outerHTML;
          // rasterize the SVG exactly as a consumer (browser/print) would
          const blob = new Blob([markup], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = url;
          });
          const c = document.createElement("canvas");
          c.width = img.width || 816;
          c.height = img.height || 1056;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          return {
            markup: markup.slice(0, 4000),
            exportWithDarkMode: appState.exportWithDarkMode,
            theme: appState.theme,
            configTheme: (config as any).theme,
            pixels: samplePixels(ctx, c.width, c.height),
          };
        }
        const blob = (await exportScene({
          type: "png",
          data: data as any,
          config: config as any,
        })) as Blob;
        const bitmap = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return {
          exportWithDarkMode: appState.exportWithDarkMode,
          theme: appState.theme,
          configTheme: (config as any).theme,
          pixels: samplePixels(ctx, c.width, c.height),
        };
      },
      sceneToViewport(x: number, y: number) {
        const a = (window as any).__gnApi as ExcalidrawImperativeAPI;
        const s = a.getAppState();
        return {
          x: (x + s.scrollX) * s.zoom.value + s.offsetLeft,
          y: (y + s.scrollY) * s.zoom.value + s.offsetTop,
        };
      },
    };
  }, [theme]);

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <PaperBackgroundLayer
        elements={api?.getSceneElements() ?? []}
        scrollX={api?.getAppState().scrollX ?? 0}
        scrollY={api?.getAppState().scrollY ?? 0}
        zoom={api?.getAppState().zoom.value ?? 1}
        theme={theme}
        defaultTemplate="lined"
      />
      <Excalidraw
        onExcalidrawAPI={setApi as any}
        theme={theme}
        exportTheme={
          (new URLSearchParams(location.search).get("exportTheme") as any) ??
          "light"
        }
        initialData={{ appState: { viewBackgroundColor: "#ffffff" } }}
      />
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <DarkModeToggle preference={preference} onChange={setPreference} />
      </div>
    </div>
  );
};

/** Sample a coarse grid + report background/ink statistics. */
function samplePixels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): {
  corner: number[];
  center: number[];
  darkest: number[];
  lightest: number[];
  meanLuminance: number;
  histogram: { dark: number; mid: number; light: number };
} {
  const data = ctx.getImageData(0, 0, w, h).data;
  let darkest = [255, 255, 255];
  let lightest = [0, 0, 0];
  let sum = 0;
  let count = 0;
  const hist = { dark: 0, mid: 0, light: 0 };
  const lum = (r: number, g: number, b: number) =>
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 10) {
        continue;
      }
      const l = lum(r, g, b);
      sum += l;
      count++;
      if (l < 0.25) {
        hist.dark++;
      } else if (l < 0.75) {
        hist.mid++;
      } else {
        hist.light++;
      }
      if (l < lum(darkest[0], darkest[1], darkest[2])) {
        darkest = [r, g, b];
      }
      if (l > lum(lightest[0], lightest[1], lightest[2])) {
        lightest = [r, g, b];
      }
    }
  }
  const px = (x: number, y: number) => {
    const i = (Math.floor(y) * w + Math.floor(x)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  return {
    corner: px(3, 3),
    center: px(w / 2, h / 2),
    darkest,
    lightest,
    meanLuminance: count ? sum / count : 0,
    histogram: hist,
  };
}

createRoot(document.getElementById("root")!).render(<Harness />);
