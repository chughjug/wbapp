/* TEMPORARY verification harness — delete after browser verification. */
/* eslint-disable */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Excalidraw } from "@excalidraw/excalidraw";

import {
  FuzzySelectOverlay,
  activateFuzzySelect,
  deactivateFuzzySelect,
  selectElementsWithLasso,
  rasterizeLassoSelection,
  duplicateRasterIntoScene,
  copyPngToClipboard,
  createBinaryFileDataFromPng,
} from "./index";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const App = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    if (!api) {
      return;
    }
    (window as any).api = api;
    (window as any).fuzzy = {
      activateFuzzySelect,
      deactivateFuzzySelect,
      selectElementsWithLasso,
      rasterizeLassoSelection,
      duplicateRasterIntoScene,
      copyPngToClipboard,
      createBinaryFileDataFromPng,
    };
    (window as any).harnessReady = true;
  }, [api]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Excalidraw onExcalidrawAPI={setApi} />
      <FuzzySelectOverlay excalidrawAPI={api} />
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
