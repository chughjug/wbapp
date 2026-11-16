// TEMPORARY VERIFICATION HARNESS — delete before finishing.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createStore, set as idbSet, clear as idbClear, entries } from "idb-keyval";

import { SettingsScreen } from "./SettingsScreen";
import { GesturesFirstRunHint } from "./FirstRunHint";
import { exportBackup, importBackup, validateBundle, getStorageReport } from "./backup";

const metaStore = createStore("goodnotes", "docs");
const sceneStore = createStore("goodnotes-scenes", "scenes");

(window as any).__h = {
  exportBackup,
  importBackup,
  validateBundle,
  getStorageReport,
  seed: async (docs: any[]) => {
    for (const d of docs) {
      await idbSet(d.meta.id, d.meta, metaStore);
      if (d.scene) await idbSet(d.meta.id, d.scene, sceneStore);
    }
  },
  wipe: async () => {
    await idbClear(metaStore);
    await idbClear(sceneStore);
  },
  dump: async () => ({
    metas: await entries(metaStore),
    scenes: await entries(sceneStore),
  }),
};

const App = () => {
  const [open, setOpen] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <div>
      <button id="reopen" onClick={() => setOpen(true)}>open</button>
      <button id="toggletheme" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
        theme
      </button>
      <GesturesFirstRunHint theme={theme} delayMs={0} onOpenGestures={() => setOpen(true)} />
      {open && (
        <SettingsScreen theme={theme} onClose={() => setOpen(false)} />
      )}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
