import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMathCustomData,
  isMathElement,
  mergeMathCustomData,
} from "./insertMath";
import {
  configureMathjax,
  MathRenderError,
  renderMathToSvg,
  resetMathjaxForTests,
} from "./renderMath";
import {
  createMathSpec,
  DEFAULT_MATH_COLOR,
  DEFAULT_MATH_FONT_SIZE,
  describeMath,
  hasMathSource,
  MAX_MATH_FONT_SIZE,
  MAX_TEX_LENGTH,
  MIN_MATH_FONT_SIZE,
  normalizeMathSpec,
} from "./spec";

import type { MathTypesetter } from "./renderMath";

/** A stand-in for MathJax: no 1.6MB of glyph outlines in a unit test. */
const stubTypesetter = (svg: (tex: string) => string): MathTypesetter => ({
  toSvg: (tex) => svg(tex),
});

const OK_SVG = (width = "10ex", height = "4ex") =>
  `<mjx-container><svg style="vertical-align: -1.5ex;" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 40"><g data-mml-node="math"><path d="M0 0h10"/></g></svg></mjx-container>`;

describe("math spec", () => {
  it("fills in the defaults", () => {
    const spec = createMathSpec("x^2");
    expect(spec).toEqual({
      version: 1,
      tex: "x^2",
      display: true,
      fontSize: DEFAULT_MATH_FONT_SIZE,
      color: DEFAULT_MATH_COLOR,
    });
  });

  it("clamps the font size", () => {
    expect(createMathSpec("x", { fontSize: 2 }).fontSize).toBe(
      MIN_MATH_FONT_SIZE,
    );
    expect(createMathSpec("x", { fontSize: 5000 }).fontSize).toBe(
      MAX_MATH_FONT_SIZE,
    );
  });

  it("truncates absurd source", () => {
    expect(createMathSpec("x".repeat(MAX_TEX_LENGTH + 500)).tex).toHaveLength(
      MAX_TEX_LENGTH,
    );
  });

  it("rejects a colour that is not a hex triplet", () => {
    // a saved scene is untrusted input; this ends up in a `style` attribute
    expect(createMathSpec("x", { color: "red; background:url(x)" }).color).toBe(
      DEFAULT_MATH_COLOR,
    );
    expect(createMathSpec("x", { color: "#abc" }).color).toBe(
      DEFAULT_MATH_COLOR,
    );
    expect(createMathSpec("x", { color: "#AABBCC" }).color).toBe("#AABBCC");
  });

  it("normalizes what a saved scene might hold", () => {
    expect(normalizeMathSpec(null)).toBeNull();
    expect(normalizeMathSpec({})).toBeNull();
    expect(normalizeMathSpec({ tex: 42 })).toBeNull();
    expect(
      normalizeMathSpec({ tex: "x", fontSize: Number.NaN })?.fontSize,
    ).toBe(DEFAULT_MATH_FONT_SIZE);
    expect(normalizeMathSpec({ tex: "x", display: false })?.display).toBe(
      false,
    );
  });

  it("knows when there is nothing to typeset", () => {
    expect(hasMathSource(createMathSpec("   "))).toBe(false);
    expect(hasMathSource(createMathSpec("x"))).toBe(true);
  });

  it("describes an equation by its source", () => {
    expect(describeMath(createMathSpec("a  +\n b"))).toBe("Equation: a + b");
    expect(describeMath(createMathSpec(""))).toBe("Equation");
  });
});

describe("rendering", () => {
  beforeEach(() => {
    resetMathjaxForTests();
  });

  it("sizes the SVG in px and bakes the ink in", async () => {
    configureMathjax({
      typesetter: stubTypesetter(() => OK_SVG("10ex", "4ex")),
    });
    const render = await renderMathToSvg(
      createMathSpec("x^2", { fontSize: 20 }),
    );
    // ex is half an em, so 10ex at 20px/em is 100px
    expect(render.width).toBe(100);
    expect(render.height).toBe(40);
    expect(render.svg).toContain('width="100"');
    expect(render.svg).toContain('height="40"');
    expect(render.svg).toContain(`style="color:${DEFAULT_MATH_COLOR}"`);
    // the inline-flow alignment must not survive into a standalone file
    expect(render.svg).not.toContain("vertical-align");
    expect(render.svg).not.toContain('ex"');
  });

  it("refuses an empty equation without loading the typesetter", async () => {
    const load = vi.fn();
    configureMathjax({ load });
    await expect(renderMathToSvg(createMathSpec("  "))).rejects.toThrow(
      MathRenderError,
    );
    expect(load).not.toHaveBeenCalled();
  });

  // MathJax renders a TeX error rather than throwing one — see findTexError
  it("reports a TeX error instead of drawing it", async () => {
    configureMathjax({
      typesetter: stubTypesetter(
        () =>
          '<mjx-container><svg width="10ex" height="4ex"><g data-mml-node="merror" data-mjx-error="Missing close brace"><path d="M0 0"/></g></svg></mjx-container>',
      ),
    });
    await expect(renderMathToSvg(createMathSpec("\\frac{1}{"))).rejects.toThrow(
      "Missing close brace",
    );
  });

  it("decodes entities in the error message", async () => {
    configureMathjax({
      typesetter: stubTypesetter(
        () =>
          '<mjx-container><svg width="1ex" height="1ex"><g data-mjx-error="Misplaced &amp; in \\begin{aligned}"></g></svg></mjx-container>',
      ),
    });
    await expect(renderMathToSvg(createMathSpec("&"))).rejects.toThrow(
      "Misplaced & in \\begin{aligned}",
    );
  });

  it("falls back to a readable message for an unlabelled error node", async () => {
    configureMathjax({
      typesetter: stubTypesetter(
        () =>
          '<mjx-container><svg width="1ex" height="1ex"><g data-mml-node="merror"></g></svg></mjx-container>',
      ),
    });
    await expect(renderMathToSvg(createMathSpec("?"))).rejects.toThrow(
      /does not understand|not something the typesetter understands/,
    );
  });

  it("turns a thrown TeX error into a readable one", async () => {
    configureMathjax({
      typesetter: stubTypesetter(() => {
        throw new Error("Undefined control sequence \\nope");
      }),
    });
    await expect(renderMathToSvg(createMathSpec("\\nope"))).rejects.toThrow(
      "Undefined control sequence \\nope",
    );
  });

  it("says so when MathJax itself cannot be loaded", async () => {
    configureMathjax({ load: () => Promise.reject(new Error("offline")) });
    await expect(renderMathToSvg(createMathSpec("x"))).rejects.toThrow(
      /Could not load the maths typesetter/,
    );
  });

  it("retries after a failed load instead of staying broken", async () => {
    let attempt = 0;
    configureMathjax({
      load: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(stubTypesetter(() => OK_SVG()));
      },
    });
    await expect(renderMathToSvg(createMathSpec("x"))).rejects.toThrow();
    await expect(renderMathToSvg(createMathSpec("x"))).resolves.toMatchObject({
      alt: "Equation: x",
    });
    expect(attempt).toBe(2);
  });

  // the same bug the PDF loader had: one injection form shadowing the other
  it("lets a loader replace an already-injected typesetter", async () => {
    configureMathjax({
      typesetter: stubTypesetter(() => OK_SVG("2ex", "2ex")),
    });
    configureMathjax({
      load: async () => stubTypesetter(() => OK_SVG("8ex", "8ex")),
    });
    const render = await renderMathToSvg(createMathSpec("x", { fontSize: 20 }));
    // 8ex at 20px/em, i.e. the loader's SVG and not the injected one's 2ex
    expect(render.width).toBe(80);
  });

  it("gives a minimum size to a degenerate box", async () => {
    configureMathjax({
      typesetter: stubTypesetter(() => OK_SVG("0ex", "0ex")),
    });
    const render = await renderMathToSvg(createMathSpec("x"));
    expect(render.width).toBeGreaterThan(0);
    expect(render.height).toBeGreaterThan(0);
  });
});

describe("customData", () => {
  const state = {
    spec: createMathSpec("x^2"),
    alt: "Equation: x^2",
    rendered: { width: 10, height: 5 },
    updatedAt: 1,
  };

  it("does not clobber sibling goodnotes keys", () => {
    const element = {
      customData: { goodnotes: { graph: { alt: "a graph" } }, other: 1 },
    };
    const next = mergeMathCustomData(element, state) as Record<string, any>;
    expect(next.goodnotes.graph).toEqual({ alt: "a graph" });
    expect(next.goodnotes.math.alt).toBe("Equation: x^2");
    expect(next.other).toBe(1);
  });

  it("removes only its own key", () => {
    const element = {
      customData: { goodnotes: { graph: { alt: "a graph" }, math: state } },
    };
    const next = mergeMathCustomData(element, null) as Record<string, any>;
    expect(next.goodnotes.math).toBeUndefined();
    expect(next.goodnotes.graph).toEqual({ alt: "a graph" });
  });

  it("drops an empty namespace entirely", () => {
    const element = { customData: { goodnotes: { math: state } } };
    expect(mergeMathCustomData(element, null)).toBeUndefined();
  });

  it("reads a stored spec back", () => {
    const element = {
      type: "image",
      customData: mergeMathCustomData(undefined, state),
    } as any;
    expect(getMathCustomData(element)?.spec.tex).toBe("x^2");
    expect(isMathElement(element)).toBe(true);
  });

  it("is not fooled by another image, or by a deleted one", () => {
    expect(isMathElement({ type: "image" } as any)).toBe(false);
    expect(isMathElement({ type: "rectangle" } as any)).toBe(false);
    expect(
      isMathElement({
        type: "image",
        isDeleted: true,
        customData: mergeMathCustomData(undefined, state),
      } as any),
    ).toBe(false);
  });

  it("survives a corrupted record", () => {
    expect(
      getMathCustomData({
        type: "image",
        customData: { goodnotes: { math: { spec: { tex: 7 } } } },
      } as any),
    ).toBeNull();
  });
});
