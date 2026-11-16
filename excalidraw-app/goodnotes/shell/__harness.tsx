import { Excalidraw } from "@excalidraw/excalidraw";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { usePages } from "../pages";

import { NavBar, PagePanel } from "./index";

import type { ShellMode } from "./index";

import "../../index.scss";

const Harness = () => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [mode, setMode] = useState<ShellMode>("write");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [log, setLog] = useState<string[]>([]);
  const { pages, activePageIndex, addPage, seedFirstPage } = usePages(api);

  useEffect(() => {
    if (api) {
      seedFirstPage();
    }
  }, [api, seedFirstPage]);

  const note = (what: string) => setLog((l) => [...l, what]);
  (window as unknown as Record<string, unknown>).__gn = {
    api,
    get log() {
      return log;
    },
  };

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw onExcalidrawAPI={setApi} theme={theme} />
      <NavBar
        excalidrawAPI={api}
        suppressDefaultChrome
        theme={theme}
        pagePanelOpen={pagesOpen}
        onTogglePagePanel={() => setPagesOpen((o) => !o)}
        searchQuery={query}
        onSearchChange={setQuery}
        onToggleSearch={() => note("toggle-search")}
        mode={mode}
        onModeChange={setMode}
        onFuzzySelect={() => note("fuzzy")}
        fuzzySelectActive={false}
        onUndo={() => note("undo")}
        onRedo={() => note("redo")}
        onImportPdf={() => note("import")}
        onExportPdf={() => note("export")}
        onOpenBackdrops={() => note("backdrops")}
        backdropsActive={false}
        backdropsDisabled={false}
        onAddPage={() => addPage()}
        pageCount={pages.length}
        currentPage={activePageIndex + 1}
        onShare={() => note("share")}
        onActiveToolMenu={(tool) => note(`tool-menu:${tool}`)}
      />
      <PagePanel
        excalidrawAPI={api}
        open={pagesOpen}
        theme={theme}
        onClose={() => setPagesOpen(false)}
      />
      <button
        id="toggle-theme"
        style={{ position: "fixed", bottom: 8, right: 8, zIndex: 500 }}
        onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      >
        theme
      </button>
      <pre id="log" style={{ position: "fixed", bottom: 8, left: 220, zIndex: 500, margin: 0 }}>
        {log.join(",")}
      </pre>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<Harness />);
