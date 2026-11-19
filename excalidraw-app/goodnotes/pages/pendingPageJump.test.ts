import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingPageJumps,
  setPendingPageJump,
  takePendingPageJump,
} from "./pendingPageJump";

describe("pendingPageJump", () => {
  beforeEach(() => {
    clearPendingPageJumps();
  });

  it("round-trips a jump", () => {
    setPendingPageJump("doc-1", { page: 3, query: "eigenvalues" });
    expect(takePendingPageJump("doc-1")).toEqual({
      page: 3,
      query: "eigenvalues",
    });
  });

  it("is consumed exactly once", () => {
    setPendingPageJump("doc-1", { page: 3, query: "x" });
    takePendingPageJump("doc-1");
    expect(takePendingPageJump("doc-1")).toBeNull();
  });

  it("returns null for an unknown or absent id", () => {
    expect(takePendingPageJump("missing")).toBeNull();
    expect(takePendingPageJump(null)).toBeNull();
    expect(takePendingPageJump(undefined)).toBeNull();
  });

  it("keeps documents apart", () => {
    setPendingPageJump("doc-1", { page: 1, query: "a" });
    setPendingPageJump("doc-2", { page: 7, query: "b" });
    expect(takePendingPageJump("doc-2")?.page).toBe(7);
    expect(takePendingPageJump("doc-1")?.page).toBe(1);
  });

  // search reports page 0 for text that is not inside any page frame; there
  // is nothing to scroll to, so the stash must not hold it
  it("drops page 0", () => {
    setPendingPageJump("doc-1", { page: 0, query: "a" });
    expect(takePendingPageJump("doc-1")).toBeNull();
  });

  it("drops a negative page", () => {
    setPendingPageJump("doc-1", { page: -2, query: "a" });
    expect(takePendingPageJump("doc-1")).toBeNull();
  });

  // a stale jump must not survive a later open with no page to jump to
  it("page 0 clears a jump already stashed for that document", () => {
    setPendingPageJump("doc-1", { page: 4, query: "a" });
    setPendingPageJump("doc-1", { page: 0, query: "b" });
    expect(takePendingPageJump("doc-1")).toBeNull();
  });

  it("a later jump replaces an earlier one", () => {
    setPendingPageJump("doc-1", { page: 4, query: "a" });
    setPendingPageJump("doc-1", { page: 9, query: "b" });
    expect(takePendingPageJump("doc-1")).toEqual({ page: 9, query: "b" });
  });
});
