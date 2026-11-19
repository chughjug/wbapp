/**
 * The seam a real LaTeX engine would plug into.
 *
 * This app ships `liteEngine` — the subset parser in `./parse` plus the
 * MathJax this app already loads — because every real engine costs either
 * a licence this project cannot take or a download it cannot justify:
 *
 * | Engine                     | Licence    | Download                         |
 * | -------------------------- | ---------- | -------------------------------- |
 * | SwiftLaTeX (pdfTeX/XeTeX)  | AGPL-3.0   | ~1.7 MB wasm, then ~27 MB of TeX |
 * | TeXlyre / busytex          | AGPL-3.0   | ~32 MB wasm + 90–400 MB packs    |
 * | Overleaf (self-hosted)     | AGPL-3.0   | 4.5–8.5 GB image, a build farm   |
 * | Tectonic via glyphtex      | MIT        | ~20–30 MB, packs on demand       |
 * | Typst (not LaTeX)          | Apache-2.0 | ~28 MB (10.8 MB gzipped)         |
 *
 * AGPL is the hard one: this is an MIT Excalidraw fork, and linking AGPL
 * code into a network-delivered app would force the whole combined work
 * open. That is the owner's decision to make, not something to slip into
 * a feature branch. The MIT options are viable but only as an **opt-in
 * download**, and every one of them fetches packages from a TeX Live
 * endpoint at compile time — SwiftLaTeX's public one is already dead,
 * which is exactly the dependency an offline-first notes app must not
 * acquire by accident.
 *
 * So: the lite engine is the default and always works offline. Adding a
 * real one later means implementing `LatexEngine` and registering it —
 * nothing in the editor, the storage or the export path needs to change.
 */

import { parseLatex } from "./parse";

import type { LatexDocument } from "./parse";

export interface CompileResult {
  /** The parsed document, for the preview renderer. */
  document: LatexDocument;
  /** A real engine would also return a PDF; the lite engine does not. */
  pdf: Blob | null;
  /** Which engine produced this, for the UI to be honest about. */
  engineId: string;
}

export interface LatexEngine {
  id: string;
  label: string;
  /** Shown where the user chooses an engine, and in the preview's footer. */
  description: string;
  /** True when the engine renders a real PDF rather than an approximation. */
  producesPdf: boolean;
  /** Bytes this engine downloads on first use. 0 for the built-in. */
  downloadBytes: number;
  compile: (source: string) => Promise<CompileResult>;
}

/**
 * The built-in engine: parse the subset, let the preview render it.
 *
 * Synchronous work wrapped in a promise so the interface is the same one
 * a wasm engine will need. The PDF is produced from the rendered preview
 * by the browser's own print pipeline, not here — see `exportLatexPdf`.
 */
export const liteEngine: LatexEngine = {
  id: "lite",
  label: "Built in",
  description:
    "Renders the common parts of LaTeX instantly and offline. Not a TeX engine: no custom macros, TikZ or BibTeX.",
  producesPdf: false,
  downloadBytes: 0,
  compile: async (source: string) => ({
    document: parseLatex(source),
    pdf: null,
    engineId: "lite",
  }),
};

const engines = new Map<string, LatexEngine>([[liteEngine.id, liteEngine]]);

/** Register an engine — the hook a downloadable wasm engine would use. */
export const registerEngine = (engine: LatexEngine): void => {
  engines.set(engine.id, engine);
};

export const getEngine = (id: string | null | undefined): LatexEngine =>
  (id && engines.get(id)) || liteEngine;

export const listEngines = (): LatexEngine[] => [...engines.values()];
