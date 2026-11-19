import { describe, expect, it } from "vitest";

import { contrastRatio } from "./darkMode";
import {
  EXPORT_PAPER_COLOR,
  inkForPaper,
  MIN_EXPORT_INK_CONTRAST,
  toPrintableElements,
} from "./exportSafety";

const el = (props: Record<string, unknown>) =>
  ({ type: "freedraw", strokeColor: "#1e1e1e", opacity: 100, ...props } as any);

describe("ink that would vanish on paper", () => {
  it("leaves ordinary dark ink exactly as it is", () => {
    expect(inkForPaper("#1e1e1e")).toBe("#1e1e1e");
    expect(inkForPaper("#e03131")).toBe("#e03131");
    expect(inkForPaper("#1971c2")).toBe("#1971c2");
  });

  it("darkens white ink until it can be read on white paper", () => {
    const fixed = inkForPaper("#ffffff");

    expect(fixed).not.toBe("#ffffff");
    expect(contrastRatio(fixed, EXPORT_PAPER_COLOR)).toBeGreaterThanOrEqual(
      MIN_EXPORT_INK_CONTRAST,
    );
  });

  it("keeps the hue, so a pale yellow stays yellow", () => {
    // #fff3bf — the sort of colour picked to be visible on a dark page
    const fixed = inkForPaper("#fff3bf");
    const [, r, g, b] = /^#(..)(..)(..)/
      .exec(fixed)!
      .map((part, index) => (index === 0 ? 0 : Number.parseInt(part, 16)));

    expect(contrastRatio(fixed, EXPORT_PAPER_COLOR)).toBeGreaterThanOrEqual(
      MIN_EXPORT_INK_CONTRAST,
    );
    // still recognisably yellow: red and green well above blue
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("is idempotent — exporting twice does not keep darkening", () => {
    const once = inkForPaper("#ffffff");
    expect(inkForPaper(once)).toBe(once);
  });

  it("leaves transparent and unparseable values alone", () => {
    expect(inkForPaper("transparent")).toBe("transparent");
    expect(inkForPaper("not a colour")).toBe("not a colour");
  });

  it("respects a non-white sheet", () => {
    // on cream paper, very pale ink still has to be darkened
    const cream = "#fdf6e3";
    const fixed = inkForPaper("#fffdf7", cream);
    expect(contrastRatio(fixed, cream)).toBeGreaterThanOrEqual(
      MIN_EXPORT_INK_CONTRAST,
    );
  });
});

describe("preparing a scene for paper", () => {
  it("fixes the invisible stroke and nothing else", () => {
    const elements = [
      el({ id: "a", strokeColor: "#1e1e1e" }),
      el({ id: "b", strokeColor: "#ffffff" }),
    ];

    const out = toPrintableElements(elements);

    expect(out[0]).toBe(elements[0]);
    expect(out[1].strokeColor).not.toBe("#ffffff");
  });

  it("returns the very same array when nothing needs changing", () => {
    const elements = [el({ id: "a" }), el({ id: "b", strokeColor: "#e03131" })];
    expect(toPrintableElements(elements)).toBe(elements);
  });

  it("does not repaint a highlighter into a brown bar", () => {
    // a highlighter is pale on purpose; it is drawn over the words
    const highlight = el({
      id: "h",
      strokeColor: "#ffd43b",
      opacity: 40,
    });
    expect(toPrintableElements([highlight])[0]).toBe(highlight);
  });

  it("does not touch images", () => {
    const image = el({ id: "i", type: "image", strokeColor: "#ffffff" });
    expect(toPrintableElements([image])[0]).toBe(image);
  });

  it("leaves page frames referentially identical", () => {
    // `exportingFrame` is matched by identity; a copy would silently stop
    // the page being clipped to its frame
    const frame = el({
      id: "page-1",
      type: "frame",
      name: "page:1",
      strokeColor: "#bbb",
    });
    const out = toPrintableElements([frame, el({ id: "x" })]);
    expect(out[0]).toBe(frame);
  });

  it("leaves a white fill alone — that is usually a deliberate knockout", () => {
    const label = el({
      id: "l",
      type: "rectangle",
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffffff",
    });
    expect(toPrintableElements([label])[0].backgroundColor).toBe("#ffffff");
  });
});
