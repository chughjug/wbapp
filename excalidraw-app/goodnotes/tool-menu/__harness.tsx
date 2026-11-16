import { Excalidraw } from "@excalidraw/excalidraw";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { ToolMenu, useActiveToolMenu } from "./index";

import "../../index.scss";

const Harness = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const toolMenu = useActiveToolMenu({ excalidrawAPI: api });

  (window as unknown as Record<string, unknown>).__gnApi = api;
  (window as unknown as Record<string, unknown>).__gnMenu = toolMenu;

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw excalidrawAPI={setApi}>
        <ToolMenu {...toolMenu.menuProps} />
      </Excalidraw>
      <button
        id="trigger-pen"
        style={{ position: "fixed", top: 8, left: "50%", zIndex: 500 }}
        onClick={(event) => toolMenu.onToolSelect("pen", event)}
      >
        Pen
      </button>
      <button
        id="trigger-highlighter"
        style={{ position: "fixed", top: 8, left: "calc(50% + 60px)", zIndex: 500 }}
        onClick={(event) => toolMenu.onToolSelect("highlighter", event)}
      >
        Highlighter
      </button>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<Harness />);
