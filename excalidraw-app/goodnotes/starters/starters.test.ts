import { describe, expect, it } from "vitest";

import { PAPER_TEMPLATES } from "../paper/templates";

import { buildStarterElements } from "./seedStarter";
import { getStarter, NOTEBOOK_STARTERS, starterSeedsContent } from "./starters";

const frame = {
  id: "page-1",
  x: 100,
  y: 200,
  width: 800,
  height: 1130,
};

describe("the starters", () => {
  it("offers Blank first, and Blank seeds nothing", () => {
    expect(NOTEBOOK_STARTERS[0].id).toBe("blank");
    expect(starterSeedsContent(NOTEBOOK_STARTERS[0])).toBe(false);
  });

  it("only names paper templates that actually exist", () => {
    // a starter that picks a template the paper module does not have would
    // silently fall back to blank, so the preset would quietly do nothing
    for (const starter of NOTEBOOK_STARTERS) {
      expect(PAPER_TEMPLATES[starter.template]).toBeDefined();
    }
  });

  it("has unique ids", () => {
    const ids = NOTEBOOK_STARTERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every seeded line inside the page", () => {
    for (const starter of NOTEBOOK_STARTERS) {
      for (const line of starter.seed) {
        expect(line.atX).toBeGreaterThanOrEqual(0);
        expect(line.atX).toBeLessThan(1);
        expect(line.atY).toBeGreaterThanOrEqual(0);
        expect(line.atY).toBeLessThan(1);
      }
    }
  });

  it("falls back to Blank for an unknown or missing id", () => {
    expect(getStarter("no-such-starter").id).toBe("blank");
    expect(getStarter(null).id).toBe("blank");
    expect(getStarter(undefined).id).toBe("blank");
  });

  it("picks Cornell paper for lecture notes and staff for music", () => {
    expect(getStarter("lecture").template).toBe("cornell");
    expect(getStarter("music").template).toBe("staff");
    expect(getStarter("music").landscape).toBe(true);
  });
});

describe("seeding a starter onto the page", () => {
  it("writes nothing for a starter with no scaffolding", () => {
    expect(buildStarterElements(getStarter("blank"), frame)).toEqual([]);
    expect(buildStarterElements(getStarter("music"), frame)).toEqual([]);
  });

  it("parents every line to the page frame", () => {
    // without frameId the line would not move, export, or be found on the
    // page with the rest of its content
    const out = buildStarterElements(getStarter("lab"), frame);
    expect(out).toHaveLength(4);
    for (const element of out) {
      expect(element.frameId).toBe("page-1");
    }
  });

  it("places lines inside the frame's bounds", () => {
    const out = buildStarterElements(getStarter("problem-set"), frame);
    for (const element of out) {
      expect(element.x).toBeGreaterThanOrEqual(frame.x);
      expect(element.x).toBeLessThan(frame.x + frame.width);
      expect(element.y).toBeGreaterThanOrEqual(frame.y);
      expect(element.y).toBeLessThan(frame.y + frame.height);
    }
  });

  it("keeps the lab report's headings in reading order down the page", () => {
    const out = buildStarterElements(getStarter("lab"), frame);
    const ys = out.map((element) => element.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(out.map((element) => element.text)).toEqual([
      "Aim",
      "Method",
      "Results",
      "Conclusion",
    ]);
  });

  it("writes scaffolding in grey, so the student's own ink is darker", () => {
    const out = buildStarterElements(getStarter("lecture"), frame);
    expect(out[0].strokeColor).toBe("#868e96");
  });

  it("gives a heading a big enough size for the outline to see it", () => {
    // buildOutline needs the largest text to be >= 1.25x the next size
    // down before it will call it a heading
    const out = buildStarterElements(getStarter("problem-set"), frame);
    const heading = out.find((element) => element.text === "Problem set")!;
    const body = out.find((element) => element.text === "1.")!;
    expect(heading.fontSize / body.fontSize).toBeGreaterThanOrEqual(1.25);
  });

  it("scales with the page rather than using fixed coordinates", () => {
    const small = buildStarterElements(getStarter("lab"), {
      ...frame,
      width: 400,
      height: 565,
    });
    const large = buildStarterElements(getStarter("lab"), frame);
    expect(small[1].y - small[0].y).toBeLessThan(large[1].y - large[0].y);
  });
});
