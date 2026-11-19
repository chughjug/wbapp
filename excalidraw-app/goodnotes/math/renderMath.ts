/**
 * TeX → SVG, with MathJax.
 *
 * ## Why SVG, and why MathJax rather than KaTeX
 *
 * The equation has to become a *scene element*: something that saves into
 * the document, exports into a PDF, and survives a reload. KaTeX renders
 * HTML that depends on its stylesheet and on four woff2 font families, none
 * of which exist inside a scene file — turning that into a picture means
 * `foreignObject` plus base64 fonts, which is fragile and enormous.
 *
 * MathJax's SVG output draws every glyph as a `<path>`. With
 * `fontCache: "local"` the paths and their `<defs>` live inside the one
 * `<svg>`, so the result is self-contained: no CSS, no font files, nothing
 * to resolve at paint time. That is exactly what an image element needs,
 * and it stays sharp at any zoom because it never becomes pixels.
 *
 * ## Loading
 *
 * MathJax is large and most notebooks never hold an equation, so it is
 * imported dynamically on first use and the document is built once and
 * reused. {@link configureMathjax} is the seam tests use to supply a stub
 * instead of loading the real thing.
 */

import {
  DEFAULT_MATH_COLOR,
  MAX_TEX_LENGTH,
  describeMath,
  hasMathSource,
} from "./spec";

import type { MathSpec } from "./spec";

/** Anything that fails between "the user typed it" and "there is an SVG". */
export class MathRenderError extends Error {
  /** The TeX the typesetter rejected, when the failure was about the source. */
  readonly tex: string | null;
  readonly cause: unknown;

  constructor(message: string, tex: string | null = null, cause?: unknown) {
    super(message);
    this.name = "MathRenderError";
    this.tex = tex;
    this.cause = cause;
  }
}

/** The slice of MathJax this module uses. Keeps the stub seam small. */
export interface MathTypesetter {
  /** Converts TeX to an `<svg>…</svg>` string. Throws on a TeX error. */
  toSvg: (
    tex: string,
    options: { display: boolean; em: number; ex: number },
  ) => string;
}

type Loader = () => Promise<MathTypesetter>;

let injected: MathTypesetter | null = null;
let injectedLoader: Loader | null = null;
let typesetterPromise: Promise<MathTypesetter> | null = null;

/**
 * Supply the typesetter (or a loader for it). Each form clears the other,
 * so configuring a loader after a direct injection actually takes effect —
 * the same bug the PDF importer's loader had.
 */
export const configureMathjax = (config: {
  typesetter?: MathTypesetter;
  load?: Loader;
}): void => {
  if (config.typesetter) {
    injected = config.typesetter;
    injectedLoader = null;
    typesetterPromise = null;
  }
  if (config.load) {
    injectedLoader = config.load;
    injected = null;
    typesetterPromise = null;
  }
};

/** Test helper — forget any injection and any cached MathJax document. */
export const resetMathjaxForTests = (): void => {
  injected = null;
  injectedLoader = null;
  typesetterPromise = null;
};

/**
 * The TeX extensions worth carrying, and the modules that register them.
 *
 * `AllPackages` is deliberately not used: it drags in `require` (which
 * loads more code at runtime from a CDN), `bussproofs`, `colortbl`, and —
 * via semantic enrichment — the whole speech-rule engine, none of which a
 * student's notes need.
 *
 * `noerrors` and `noundefined` are left out ON PURPOSE. With them a typo
 * renders as red text *inside* the equation and lands silently on the
 * page; without them the error is detectable (see {@link findTexError})
 * and the dialog can say what is wrong while the student is still typing.
 */
const TEX_PACKAGES = [
  "base",
  // \begin{pmatrix}, \begin{aligned}, \text, \overset, most of what a
  // maths course writes
  "ams",
  // \newcommand in the source, and macros configured by the host
  "newcommand",
  "configmacros",
  // \boldsymbol for vectors, \cancel for crossing out a term mid-working
  "boldsymbol",
  "cancel",
  // \begin{cases} for piecewise definitions
  "cases",
  // \color, for a highlighted step
  "color",
  // \coloneqq, \abs, \norm and friends
  "mathtools",
  // \ce{H2O} — chemistry notes are notes too
  "mhchem",
  // \dv, \pdv, \bra, \ket: a physics course writes these constantly
  "physics",
  "braket",
  // \text{...} with real text markup inside it
  "textmacros",
  // \unicode{x2713} as an escape hatch for a glyph TeX has no name for
  "unicode",
];

const TEX_EXTENSIONS: (() => Promise<unknown>)[] = [
  () => import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
  () =>
    import("mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js"),
  () =>
    import(
      "mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js"
    ),
  () =>
    import("mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js"),
  () => import("mathjax-full/js/input/tex/cancel/CancelConfiguration.js"),
  () => import("mathjax-full/js/input/tex/cases/CasesConfiguration.js"),
  () => import("mathjax-full/js/input/tex/color/ColorConfiguration.js"),
  () => import("mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js"),
  () => import("mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js"),
  () => import("mathjax-full/js/input/tex/physics/PhysicsConfiguration.js"),
  () => import("mathjax-full/js/input/tex/braket/BraketConfiguration.js"),
  () =>
    import("mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js"),
  () => import("mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js"),
];

/**
 * Builds the real MathJax pipeline, once, on first use.
 */
const loadRealTypesetter = async (): Promise<MathTypesetter> => {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler },
  ] = await Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    // Each extension registers itself with MathJax's configuration handler
    // as a side effect of being loaded, and naming it in `packages` below
    // is then enough. Under Node, MathJax finds these itself; under a
    // bundler it cannot, because the lookup is a runtime `require` of a
    // computed path, so nothing is bundled and every extension is missing.
    // That failure is quiet and specific: `\frac` and `^` still work
    // because they are base TeX, and then `\begin{pmatrix}` comes back
    // "Unknown environment 'pmatrix'". Importing them explicitly is what
    // puts them in the chunk.
    ...TEX_EXTENSIONS.map((load) => load()),
  ]);

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const input = new TeX({ packages: TEX_PACKAGES });
  // "local" keeps each glyph's path in this SVG's own <defs>; "global" would
  // reference a cache living in the host page, which a saved file does not
  // have.
  const output = new SVG({ fontCache: "local" });
  const doc = mathjax.document("", { InputJax: input, OutputJax: output });

  return {
    toSvg: (tex, { display, em, ex }) => {
      const node = doc.convert(tex, {
        display,
        em,
        ex,
        containerWidth: 100 * em,
      });
      return adaptor.outerHTML(node);
    },
  };
};

const loadTypesetter = async (): Promise<MathTypesetter> => {
  if (injected) {
    return injected;
  }
  if (!typesetterPromise) {
    typesetterPromise = (injectedLoader ?? loadRealTypesetter)().catch(
      (error) => {
        // Clear the cached promise so a later attempt can try again. This
        // helps a caller-supplied loader and anything that failed before
        // the network, but it CANNOT rescue the real `import()`: when a
        // module script fails to load, the browser records that failure in
        // the document's module map, and every later import of the same
        // specifier gets the recorded failure without a new request.
        //
        // Measured, not assumed — offline, then online in the same tab,
        // then online after a reload: fail, fail, work. So the message
        // asks for the reload rather than for another try, which is what
        // it used to ask for and would never have worked.
        typesetterPromise = null;
        throw new MathRenderError(
          "Could not load the maths typesetter — you may be offline. Reconnect, then reload the page.",
          null,
          error,
        );
      },
    );
  }
  return typesetterPromise;
};

/**
 * MathJax does not throw on a TeX error.
 *
 * This surprised me and it is worth writing down: `document.convert` catches
 * the `TeXError` itself and renders it, so `\frac{1}{` comes back as a
 * perfectly valid SVG containing a red error box. Without this check the
 * dialog showed no error, the Insert button stayed enabled, and a picture
 * of the words "Missing close brace" would have landed on the page.
 *
 * The error node carries the message in `data-mjx-error`, and those
 * messages are already the right ones to show a student: "Missing close
 * brace", "Undefined control sequence \foo", "Extra \left or missing
 * \right".
 */
const findTexError = (html: string): string | null => {
  const message = /data-mjx-error="([^"]*)"/.exec(html);
  if (message) {
    return decodeEntities(message[1]);
  }
  return html.includes('data-mml-node="merror"')
    ? "That is not something the typesetter understands."
    : null;
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");

/** Pull `<svg …>…</svg>` out of whatever wrapper the adaptor returned. */
const extractSvg = (html: string): string => {
  const start = html.indexOf("<svg");
  const end = html.lastIndexOf("</svg>");
  if (start === -1 || end === -1) {
    throw new MathRenderError("The typesetter did not return a drawing.");
  }
  return html.slice(start, end + "</svg>".length);
};

/** `"20.765ex"` → `20.765`. Returns `null` for anything else. */
const parseExLength = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const match = /^(-?[\d.]+)ex$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const readAttribute = (svg: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(svg);
  return match ? match[1] : null;
};

export interface MathRender {
  /** A standalone SVG document, sized in px and with the ink baked in. */
  svg: string;
  /** Layout size in CSS px. */
  width: number;
  height: number;
  /** The text alternative for the element. */
  alt: string;
}

/**
 * MathJax reports sizes in `ex`. One ex is about half an em in the maths
 * fonts it ships, which is the ratio its own CSS output assumes.
 */
const EX_PER_EM = 0.5;
/** Nothing smaller than this is visible; guards a degenerate `0ex` box. */
const MIN_SIZE_PX = 8;

/** Typesets a spec. Throws {@link MathRenderError} with a readable message. */
export const renderMathToSvg = async (spec: MathSpec): Promise<MathRender> => {
  if (!hasMathSource(spec)) {
    throw new MathRenderError("Type an equation first.", spec.tex);
  }
  if (spec.tex.length > MAX_TEX_LENGTH) {
    throw new MathRenderError(
      `That is longer than ${MAX_TEX_LENGTH} characters. Split it into separate equations.`,
      spec.tex,
    );
  }

  const typesetter = await loadTypesetter();
  const em = spec.fontSize;
  const ex = em * EX_PER_EM;

  let html: string;
  try {
    html = typesetter.toSvg(spec.tex, { display: spec.display, em, ex });
  } catch (error) {
    throw new MathRenderError(texErrorMessage(error), spec.tex, error);
  }

  const texError = findTexError(html);
  if (texError) {
    throw new MathRenderError(texError, spec.tex);
  }

  const raw = extractSvg(html);
  const widthEx = parseExLength(readAttribute(raw, "width"));
  const heightEx = parseExLength(readAttribute(raw, "height"));
  const width = Math.max(MIN_SIZE_PX, Math.round((widthEx ?? 0) * ex));
  const height = Math.max(MIN_SIZE_PX, Math.round((heightEx ?? 0) * ex));

  return {
    svg: finalizeSvg(raw, { width, height, color: spec.color }),
    width,
    height,
    alt: describeMath(spec),
  };
};

/**
 * MathJax throws a `TeXError` whose message is already student-readable
 * ("Undefined control sequence \\foo", "Missing close brace"). Anything
 * else is ours to phrase.
 */
const texErrorMessage = (error: unknown): string => {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return message
    ? message.replace(/\s+/g, " ").trim()
    : "That is not something the typesetter understands.";
};

/**
 * Turns MathJax's inline-flow SVG into a standalone one.
 *
 * Three changes, each load-bearing:
 *
 *  - `width`/`height` become px. In `ex` they would be resolved against the
 *    font size of whatever element the SVG is placed in, and an `<img>` has
 *    no such context — browsers fall back to 300×150.
 *  - `style="vertical-align: …"` goes. It aligns maths with a line of
 *    surrounding text; here there is no line, and it shifts the picture.
 *  - `color` is set on the root. Every glyph path is `fill="currentColor"`,
 *    which in a standalone document resolves to black with nothing to
 *    inherit from.
 */
const finalizeSvg = (
  svg: string,
  { width, height, color }: { width: number; height: number; color: string },
): string => {
  const ink = /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_MATH_COLOR;
  const openEnd = svg.indexOf(">");
  if (openEnd === -1) {
    throw new MathRenderError("The typesetter did not return a drawing.");
  }
  const openTag = svg
    .slice(0, openEnd)
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .replace(/\sstyle="[^"]*"/, "");
  return `${openTag} width="${width}" height="${height}" style="color:${ink}">${svg.slice(
    openEnd + 1,
  )}`;
};
