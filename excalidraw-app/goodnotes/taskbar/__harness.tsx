import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Taskbar } from "./index";

const Harness = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const params = new URLSearchParams(location.search);
  const minimal = params.get("minimal") === "1";
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const push = (m: string) => setLog((l) => [...l, m]);

  return (
    <div style={{ height: "100%" }}>
      <Excalidraw
        excalidrawAPI={setApi}
        theme={theme}
        initialData={{ appState: { theme } }}
      />
      <Taskbar
        excalidrawAPI={api}
        theme={theme}
        suppressDefaultToolbar
        showLabels={params.get("labels") === "1"}
        onFuzzySelect={minimal ? undefined : () => push("fuzzy")}
        onImportPdf={minimal ? undefined : () => push("import")}
        onExportPdf={minimal ? undefined : () => push("export")}
        onOpenBackdrops={minimal ? undefined : () => push("backdrop")}
        onAddPage={minimal ? undefined : () => push("addpage")}
        pageCount={minimal ? undefined : 12}
        currentPage={3}
      />
      <pre
        id="harness-log"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          zIndex: 50,
          font: "11px monospace",
          background: "#0008",
          color: "#fff",
          margin: 0,
          padding: 4,
        }}
      >
        {log.join(",")}
      </pre>
    </div>
  );
};

document.querySelectorAll("script").forEach(() => {});
document.body.innerHTML = "";
const host = document.createElement("div");
host.id = "harness-root";
host.style.cssText = "position:fixed;inset:0;";
document.body.appendChild(host);
createRoot(host).render(<Harness />);
