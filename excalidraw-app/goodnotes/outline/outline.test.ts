import { describe, expect, it } from "vitest";

import { buildOutline, tidyTitle } from "./buildOutline";

import type { DocScene } from "../types";

const frame = (page: number, props: Record<string, unknown> = {}) => ({
  id: `page-${page}`,
  type: "frame",
  name: `page:${page}`,
  isDeleted: false,
  frameId: null,
  version: 1,
  ...props,
});

const text = (
  id: string,
  frameId: string,
  value: string,
  fontSize = 20,
  y = 0,
) => ({
  id,
  type: "text",
  text: value,
  fontSize,
  y,
  frameId,
  isDeleted: false,
  version: 1,
});

const scene = (elements: unknown[]): DocScene =>
  ({ elements, appState: {}, files: {} } as any);

describe("tidyTitle", () => {
  it("collapses whitespace", () => {
    expect(tidyTitle("  Lagrange   multipliers\n ")).toBe(
      "Lagrange multipliers",
    );
  });

  it("cuts long titles on a word boundary", () => {
    const long = `${"word ".repeat(40)}end`;
    const out = tidyTitle(long);
    expect(out.length).toBeLessThanOrEqual(73);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("wor…");
  });
});

describe("the outline", () => {
  it("lists every page in order, numbered", () => {
    const out = buildOutline(scene([frame(2), frame(1), frame(3)]));
    expect(out.map((entry) => entry.page)).toEqual([1, 2, 3]);
  });

  it("takes the biggest text on a page as its heading", () => {
    const out = buildOutline(
      scene([
        frame(1),
        text("a", "page-1", "Lagrange multipliers", 36, 10),
        text("b", "page-1", "constrained optimisation", 20, 80),
      ]),
    );
    expect(out[0].title).toBe("Lagrange multipliers");
    expect(out[0].source).toBe("heading");
  });

  it("prefers the topmost when two lines share the biggest size", () => {
    const out = buildOutline(
      scene([
        frame(1),
        text("low", "page-1", "Second", 36, 200),
        text("high", "page-1", "First", 36, 10),
        text("body", "page-1", "body", 16, 300),
      ]),
    );
    expect(out[0].title).toBe("First");
  });

  it("refuses to promote a sentence when nothing is bigger than the rest", () => {
    // every line the same size: there is no heading, and guessing one
    // would make the contents list lie
    const out = buildOutline(
      scene([
        frame(1),
        text("a", "page-1", "a thought I had", 20, 10),
        text("b", "page-1", "another thought", 20, 60),
      ]),
    );
    expect(out[0].title).toBeNull();
    expect(out[0].source).toBeNull();
    expect(out[0].hasText).toBe(true);
  });

  it("accepts a single text element as the heading", () => {
    const out = buildOutline(
      scene([frame(1), text("a", "page-1", "Just the one", 20, 10)]),
    );
    expect(out[0].title).toBe("Just the one");
  });

  it("does not read a title out of the frame label", () => {
    // Excalidraw renders the frame name on the canvas and lets it be
    // edited, so it looks like somewhere to write a page title — but
    // `goodnotes/pages` rewrites it back to `page:<n>` on its next sync.
    // Measured in the browser: the edit shows on screen and is gone from
    // the stored scene by the following save. A title sourced from there
    // would disappear without warning, so the heading wins.
    const out = buildOutline(
      scene([
        frame(1, { name: "page:1" }),
        text("a", "page-1", "Eigenvalues", 48, 10),
      ]),
    );
    expect(out[0].title).toBe("Eigenvalues");
    expect(out[0].source).toBe("heading");
  });

  it("falls back to the first line of an imported PDF page", () => {
    const out = buildOutline(
      scene([
        frame(1, {
          customData: {
            goodnotesPdfImport: {
              text: "\n  CHAPTER 4 \nSome body text that follows it\n",
            },
          },
        }),
      ]),
    );
    expect(out[0].title).toBe("CHAPTER 4");
    expect(out[0].source).toBe("pdf");
  });

  it("leaves a page of pure handwriting untitled rather than inventing one", () => {
    const out = buildOutline(
      scene([
        frame(1),
        {
          id: "stroke",
          type: "freedraw",
          frameId: "page-1",
          isDeleted: false,
          version: 1,
        },
      ]),
    );
    expect(out[0].title).toBeNull();
    expect(out[0].hasText).toBe(false);
  });

  it("still lists a blank page, so later numbers stay right", () => {
    const out = buildOutline(
      scene([
        frame(1),
        frame(2),
        frame(3),
        text("a", "page-3", "Third", 36, 10),
      ]),
    );
    expect(out.map((entry) => entry.page)).toEqual([1, 2, 3]);
    expect(out[2].title).toBe("Third");
  });

  it("ignores deleted elements", () => {
    const out = buildOutline(
      scene([
        frame(1),
        { ...text("a", "page-1", "Deleted heading", 48, 10), isDeleted: true },
        text("b", "page-1", "Real heading", 20, 60),
      ]),
    );
    expect(out[0].title).toBe("Real heading");
  });

  it("ignores text that is not on any page", () => {
    const out = buildOutline(
      scene([frame(1), text("loose", "", "Floating note", 48, 10)]),
    );
    expect(out[0].title).toBeNull();
  });

  it("handles an empty scene", () => {
    expect(buildOutline(scene([]))).toEqual([]);
  });
});
