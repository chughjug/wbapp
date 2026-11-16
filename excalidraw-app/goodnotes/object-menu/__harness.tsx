// TEMPORARY browser-verification harness — deleted before hand-off.
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { ObjectMenu } from "./index";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=";

const ellipsePoints = () => {
  const points: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    points.push([60 + 60 * Math.cos(t), 40 + 40 * Math.sin(t)]);
  }
  return points.map(([x, y]) => [x - points[0][0], y - points[0][1]]) as [
    number,
    number,
  ][];
};

const elements = [
  {
    id: "rect1",
    type: "rectangle",
    x: 120,
    y: 400,
    width: 160,
    height: 100,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
  },
  {
    id: "text1",
    type: "text",
    x: 420,
    y: 420,
    width: 120,
    height: 25,
    text: "Hello",
    originalText: "Hello",
    fontSize: 20,
    fontFamily: 1,
    strokeColor: "#1e1e1e",
  },
  {
    id: "ink1",
    type: "freedraw",
    x: 120,
    y: 600,
    width: 120,
    height: 80,
    strokeColor: "#1e1e1e",
    strokeWidth: 1,
    points: ellipsePoints(),
    pressures: [],
    simulatePressure: true,
  },
  {
    id: "img1",
    type: "image",
    x: 420,
    y: 600,
    width: 120,
    height: 120,
    fileId: "file1",
    status: "saved",
  },
  // near the very top of the scene, for the flip test
  {
    id: "rectTop",
    type: "rectangle",
    x: 120,
    y: 60,
    width: 120,
    height: 60,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
  },
] as any;

const App = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [backdropOpens, setBackdropOpens] = useState(0);
  (window as any).__harness = {
    api,
    backdropOpens,
  };
  return (
    <Excalidraw
      excalidrawAPI={(value) => {
        setApi(value);
        (window as any).__api = value;
      }}
      initialData={{
        elements,
        appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
        files: {
          file1: {
            id: "file1",
            mimeType: "image/png",
            dataURL: PNG,
            created: Date.now(),
            lastRetrieved: Date.now(),
          },
        },
        scrollToContent: false,
      }}
    >
      <ObjectMenu
        excalidrawAPI={api}
        onOpenBackdrop={() => {
          setBackdropOpens((n) => n + 1);
          (window as any).__backdropOpens =
            ((window as any).__backdropOpens ?? 0) + 1;
        }}
      />
    </Excalidraw>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
