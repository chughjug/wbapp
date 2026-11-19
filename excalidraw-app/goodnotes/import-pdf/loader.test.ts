import { describe, expect, it, vi } from "vitest";

import { configurePdfjs, isPdfjsAvailable, loadPdfjs } from "./importPdf";

/**
 * The entry point injects pdf.js into this module as a pair of *thunks* so the
 * bundler code-splits it. Nothing else exercises that path — the dialog only
 * ever sees the resolved module — so without these tests a regression to the
 * eager form, or to no injection at all, would only show up as a 110 kB
 * regression on every cold start, or as "missing-dependency" in production.
 */

const fakePdfjs = () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {} as { workerSrc?: string },
});

describe("pdf.js injection", () => {
  // each configurePdfjs() call clears the counterpart form, so every test's
  // own configure call is enough to isolate it from the previous one.

  it("resolves the module from a `load` thunk", async () => {
    const load = vi.fn(async () => fakePdfjs());
    configurePdfjs({ load });

    const pdfjs = await loadPdfjs();

    expect(load).toHaveBeenCalledTimes(1);
    expect(typeof pdfjs.getDocument).toBe("function");
  });

  it("does not call the `load` thunk until something needs pdf.js", () => {
    const load = vi.fn(async () => fakePdfjs());
    configurePdfjs({ load });

    // configuring alone must not pull the chunk in — that is the whole point
    expect(load).not.toHaveBeenCalled();
  });

  it("caches the resolved module instead of re-importing it", async () => {
    const load = vi.fn(async () => fakePdfjs());
    configurePdfjs({ load });

    await loadPdfjs();
    await loadPdfjs();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("applies a worker URL resolved from a `loadWorkerSrc` thunk", async () => {
    const module = fakePdfjs();
    configurePdfjs({
      load: async () => module,
      loadWorkerSrc: async () => "blob://pdf.worker.mjs",
    });

    await loadPdfjs();

    expect(module.GlobalWorkerOptions.workerSrc).toBe("blob://pdf.worker.mjs");
  });

  it("still resolves pdf.js when the worker URL fails to load", async () => {
    const module = fakePdfjs();
    configurePdfjs({
      load: async () => module,
      loadWorkerSrc: async () => {
        throw new Error("chunk 404");
      },
    });

    // pdf.js can fall back to its own worker resolution, so a missing URL
    // must not take the whole import down
    await expect(loadPdfjs()).resolves.toBe(module);
    expect(module.GlobalWorkerOptions.workerSrc).toBeUndefined();
  });

  it("reports a module without getDocument() as unavailable", async () => {
    configurePdfjs({ load: async () => ({ nope: true }) });

    await expect(isPdfjsAvailable()).resolves.toBe(false);
  });

  it("does not cache a failed load, so a later retry can succeed", async () => {
    let attempt = 0;
    configurePdfjs({
      load: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("offline");
        }
        return fakePdfjs();
      },
    });

    await expect(loadPdfjs()).rejects.toThrow(/pdfjs-dist/);
    await expect(loadPdfjs()).resolves.toBeTruthy();
    expect(attempt).toBe(2);
  });
});
