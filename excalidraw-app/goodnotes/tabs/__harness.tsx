import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { createDoc, deleteDoc, listDocs } from "../library/store";
import { TabBar, docDotColor } from "./TabBar";
import { useOpenDocs } from "./useOpenDocs";

const SEED = [
  { title: "Organic Chemistry — Lecture 12 notes that run long", course: "CHEM 240" },
  { title: "Linear Algebra problem set", course: "MATH 221" },
  { title: "Essay draft", course: null },
  { title: "Microeconomics seminar", course: "ECON 101" },
  { title: "Lab notebook", course: "CHEM 240" },
  { title: "Reading log", course: null },
];

const Harness = () => {
  const [docId, setDocId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [allDocs, setAllDocs] = useState<any[]>([]);
  const { tabs, activeId, actions, isHydrated } = useOpenDocs(docId);

  useEffect(() => {
    void (async () => {
      let docs = await listDocs();
      if (docs.length === 0) {
        for (const seed of SEED) {
          await createDoc(seed);
        }
        docs = await listDocs();
      }
      (window as any).__docs = docs;
      setAllDocs(docs);
    })();
  }, []);

  const navigate = (id: string) => {
    (window as any).__nav = [...((window as any).__nav ?? []), id];
    setDocId(id);
  };

  (window as any).__tabsApi = { docDotColor };
  (window as any).__reset = async () => {
    for (const doc of await listDocs()) {
      await deleteDoc(doc.id);
    }
    localStorage.clear();
  };
  (window as any).__harness = {
    open: (id: string) => navigate(id),
    state: () => ({ ids: tabs.map((t) => t.id), activeId }),
  };

  return (
    <div style={{ background: theme === "dark" ? "#121212" : "#fff", minHeight: "100vh" }}>
      <TabBar
        tabs={tabs}
        activeId={activeId}
        theme={theme}
        onActivate={navigate}
        onClose={actions.close}
        onReorder={actions.reorder}
        onCloseOthers={actions.closeOthers}
        onNewTab={() => setDocId(null)}
      />
      <div style={{ padding: 16, fontFamily: "system-ui", color: theme === "dark" ? "#eee" : "#111" }}>
        <p id="route">route: {docId ? `/d/${docId}` : "/ (shelf)"}</p>
        <p id="hydrated">hydrated: {String(isHydrated)}</p>
        <button id="theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          toggle theme
        </button>
        <ul id="all-docs">
          {allDocs.map((d: any) => (
            <li key={d.id}>
              <button data-open={d.id} onClick={() => navigate(d.id)}>
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
