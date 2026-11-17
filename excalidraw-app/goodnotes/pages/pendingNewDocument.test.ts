import { describe, expect, it, beforeEach } from "vitest";

import {
  clearPendingNewDocumentSeeds,
  setPendingNewDocumentSeed,
  takePendingNewDocumentSeed,
} from "./pendingNewDocument";

describe("pendingNewDocument", () => {
  beforeEach(() => {
    clearPendingNewDocumentSeeds();
  });

  it("stores and consumes a seed once", () => {
    setPendingNewDocumentSeed("doc-1", {
      template: "grid",
      size: "LETTER",
      landscape: true,
    });

    expect(takePendingNewDocumentSeed("doc-1")).toEqual({
      template: "grid",
      size: "LETTER",
      landscape: true,
    });
    expect(takePendingNewDocumentSeed("doc-1")).toBeNull();
  });

  it("returns null for unknown or empty ids", () => {
    expect(takePendingNewDocumentSeed(null)).toBeNull();
    expect(takePendingNewDocumentSeed("missing")).toBeNull();
  });
});
