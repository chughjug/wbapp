import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line import/no-unresolved
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";
import { configurePdfjs } from "./goodnotes/import-pdf";

// the entry's JavaScript and CSS loaded and ran (`scripts/stats/perf.mjs`)
performance.mark("excalidraw:app-start");

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;

// PDF import resolves pdf.js through a dynamic import so the app still
// builds without it. Nothing called configurePdfjs, so the bundler never
// saw the dependency and EVERY import failed at runtime with
// "missing-dependency". Injecting the real build here, with its worker as
// a Vite asset URL, is what actually turns PDF import on.
configurePdfjs({
  pdfjs: pdfjsLib as never,
  workerSrc: pdfjsWorkerUrl,
});
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
