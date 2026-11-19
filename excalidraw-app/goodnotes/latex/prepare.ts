/**
 * Making real student LaTeX parse.
 *
 * LaTeX.js implements the base `article` class, not amsmath. Measured
 * against the shipped build, it rejects outright:
 *
 *   \begin{equation}  \begin{equation*}  \begin{align}
 *   \begin{align*}    \begin{displaymath}
 *
 * and accepts `\[ … \]` and `$ … $`, handing both to KaTeX. That gap
 * matters, because `equation` and `align` are what a student actually
 * types in a problem set — a renderer that refuses them is not a LaTeX
 * renderer in any useful sense.
 *
 * KaTeX, however, understands `aligned` and `\tag`. So the fix is a
 * rewrite rather than a parser: turn the amsmath environments into the
 * display maths LaTeX.js accepts, keeping the equation numbering that
 * `equation` and `align` imply. Nothing here interprets maths; it only
 * changes which wrapper the maths arrives in.
 *
 * Deliberately NOT a general macro processor. It rewrites five named
 * environments and leaves everything else exactly as written, including
 * the contents of `verbatim`, where a literal `\begin{equation}` must
 * survive to the page.
 */

/** Spans of the source that must not be rewritten. */
const PROTECTED = /\\begin\{verbatim\}[\s\S]*?\\end\{verbatim\}/g;

export interface PreparedSource {
  /** Source LaTeX.js can parse. */
  text: string;
  /** Environments that were rewritten, for the editor to disclose. */
  rewritten: string[];
}

/** Replace `body` while leaving protected spans untouched. */
const outsideProtected = (
  source: string,
  rewrite: (chunk: string) => string,
): string => {
  const out: string[] = [];
  let last = 0;
  for (const match of source.matchAll(PROTECTED)) {
    out.push(rewrite(source.slice(last, match.index)));
    out.push(match[0]);
    last = (match.index ?? 0) + match[0].length;
  }
  out.push(rewrite(source.slice(last)));
  return out.join("");
};

/**
 * Rewrite amsmath display environments into `\[ … \]`.
 *
 * Numbering is applied here because LaTeX.js has no equation counter of
 * its own: `equation` and `align` get `\tag`, their starred forms do
 * not, which is exactly LaTeX's rule.
 */
export const prepareSource = (source: string): PreparedSource => {
  const rewritten = new Set<string>();
  let counter = 0;

  const text = outsideProtected(source, (chunk) =>
    chunk.replace(
      /\\begin\{(equation\*?|align\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g,
      (_whole, name: string, body: string) => {
        rewritten.add(name);
        const starred = name.endsWith("*");
        const aligned = name.startsWith("align");
        const inner = aligned
          ? `\\begin{aligned}${body}\\end{aligned}`
          : body.trim();
        // `displaymath` is unnumbered in LaTeX too
        if (starred || name === "displaymath") {
          return `\\[${inner}\\]`;
        }
        counter += 1;
        return `\\[${inner}\\tag{${counter}}\\]`;
      },
    ),
  );

  return { text, rewritten: [...rewritten].sort() };
};

/**
 * Environments LaTeX.js rejects and this shim does not rewrite.
 *
 * Reported so the editor can say which construct failed rather than
 * leaving the writer to decode "unknown environment: tabular". Scanned
 * outside `verbatim` for the same reason as above.
 */
const UNSUPPORTED = ["tabular", "tabularx", "array", "figure", "table"];

export const findUnsupported = (source: string): string[] => {
  const found = new Set<string>();
  outsideProtected(source, (chunk) => {
    for (const name of UNSUPPORTED) {
      if (new RegExp(`\\\\begin\\{${name}\\*?\\}`).test(chunk)) {
        found.add(name);
      }
    }
    return chunk;
  });
  return [...found].sort();
};
