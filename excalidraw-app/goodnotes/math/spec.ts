/**
 * The **math spec**: everything needed to re-render an equation.
 *
 * Same contract as the graph spec next door. The spec is what the dialog
 * edits, what the renderer typesets, and what is stored on the inserted
 * image element in `customData.goodnotes.math`, so an equation can be
 * reopened and corrected rather than deleted and retyped.
 *
 * Specs come back out of saved scenes, so they are **untrusted input**:
 * {@link normalizeMathSpec} re-validates every field and clamps it into
 * range. The TeX source is never evaluated — it goes to MathJax's parser,
 * which produces geometry, not code.
 */

/** Namespace shared by every GoodNotes feature on `element.customData`. */
export const GOODNOTES_CUSTOM_DATA_NAMESPACE = "goodnotes";
/** Our key inside that namespace: `customData.goodnotes.math`. */
export const MATH_CUSTOM_DATA_KEY = "math";
/** Bumped when the spec shape changes incompatibly. */
export const MATH_SPEC_VERSION = 1;

/**
 * Upper bound on the source. Long enough for a multi-line aligned
 * derivation, short enough that a paste of an entire paper cannot wedge the
 * typesetter on a keystroke-driven preview.
 */
export const MAX_TEX_LENGTH = 2000;

export const MIN_MATH_FONT_SIZE = 12;
export const MAX_MATH_FONT_SIZE = 96;
export const DEFAULT_MATH_FONT_SIZE = 28;

/**
 * The ink. Equations are drawn for a light surface for the same reason
 * graphs are: the result is a picture on a white page and in an exported
 * PDF. Excalidraw's dark theme inverts the canvas, so this still reads
 * light-on-dark in the editor.
 */
export const DEFAULT_MATH_COLOR = "#0b0b0b";

export interface MathSpec {
  version: number;
  /** LaTeX source, exactly as typed. */
  tex: string;
  /**
   * Display style (`\displaystyle`: big integrals, stacked limits) versus
   * inline style. Display is the default — an equation inserted as its own
   * object on a page is a displayed equation.
   */
  display: boolean;
  /** Type size in CSS px, before any resize on the canvas. */
  fontSize: number;
  /** Ink colour, `#rrggbb`. */
  color: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

/** A spec with the defaults filled in. */
export const createMathSpec = (
  tex = "",
  overrides: Partial<Omit<MathSpec, "version" | "tex">> = {},
): MathSpec => ({
  version: MATH_SPEC_VERSION,
  tex: tex.slice(0, MAX_TEX_LENGTH),
  display: overrides.display ?? true,
  fontSize: clamp(
    Math.round(overrides.fontSize ?? DEFAULT_MATH_FONT_SIZE),
    MIN_MATH_FONT_SIZE,
    MAX_MATH_FONT_SIZE,
  ),
  color: isHexColor(overrides.color) ? overrides.color : DEFAULT_MATH_COLOR,
});

/**
 * Validates and clamps a spec from an untrusted source (a saved scene, a
 * shared link). Returns `null` when there is nothing usable — notably when
 * `tex` is absent or not a string, which is what distinguishes one of our
 * equations from any other image element.
 */
export const normalizeMathSpec = (raw: unknown): MathSpec | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<MathSpec>;
  if (typeof candidate.tex !== "string") {
    return null;
  }
  return createMathSpec(candidate.tex, {
    display: candidate.display !== false,
    fontSize:
      typeof candidate.fontSize === "number" &&
      Number.isFinite(candidate.fontSize)
        ? candidate.fontSize
        : DEFAULT_MATH_FONT_SIZE,
    color: candidate.color,
  });
};

/** True when there is actually something to typeset. */
export const hasMathSource = (spec: MathSpec): boolean =>
  spec.tex.trim().length > 0;

/**
 * The text alternative stored on the element and read by screen readers,
 * the object menu and the notebook search index.
 *
 * There is no good way to speak LaTeX, and pretending otherwise ("x equals
 * minus b plus or minus…") would need a second typesetter. The source is
 * the honest answer, and it is also what a student searching their notes
 * for `\int` would type.
 */
export const describeMath = (spec: MathSpec): string => {
  const source = spec.tex.replace(/\s+/g, " ").trim();
  return source ? `Equation: ${source}` : "Equation";
};
