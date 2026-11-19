import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";
import { configurePdfjs } from "./goodnotes/import-pdf";
import { initInkFeel } from "./goodnotes/ink";

// the entry's JavaScript and CSS loaded and ran (`scripts/stats/perf.mjs`)
performance.mark("excalidraw:app-start");

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;

// PDF import resolves pdf.js through a dynamic import, which a bundled
// browser build cannot satisfy on its own: the specifier is bare, so every
// import failed at runtime with "missing-dependency" until something handed
// the module in. These loaders are what turn PDF import on.
//
// They are thunks, not eager imports, on purpose. Importing pdf.js here
// instead puts ~350 kB (~99 kB gzipped) in the entry chunk of a note-taking
// app whose users mostly never open a PDF. As thunks, Rollup still resolves
// the dependency statically but emits it as its own chunk, fetched the first
// time someone actually imports a PDF.
configurePdfjs({
  load: () => import("pdfjs-dist"),
  loadWorkerSrc: () =>
    // eslint-disable-next-line import/no-unresolved
    import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
});

// Apply the saved ink-feel preference before the first stroke. The editor
// reads it synchronously on pointerdown, so it has to be in place at
// bootstrap rather than when a settings screen happens to mount.
initInkFeel();
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
