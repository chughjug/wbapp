import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { BackdropPanel, useBackdropPanel, applyBackdrop, removeBackdrop, getBackdropState } from "../index";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const App = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const ctl = useBackdropPanel(api);
  useEffect(() => {
    if (!api) return;
    (window as any).api = api;
    (window as any).ops = { applyBackdrop, removeBackdrop, getBackdropState, restoreElements };
    (window as any).openPanel = ctl.open;
    (window as any).ctl = ctl;
  }, [api, ctl]);
  return (
    <div className="wrap">
      <div className="canvas">
        <Excalidraw excalidrawAPI={(a) => setApi(a)}>
          <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
            <BackdropPanel {...ctl.panelProps} />
          </div>
        </Excalidraw>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
