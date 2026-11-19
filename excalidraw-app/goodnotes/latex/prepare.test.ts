import { describe, expect, it } from "vitest";

import { findUnsupported, prepareSource } from "./prepare";

describe("rewriting amsmath for LaTeX.js", () => {
  it("turns equation into numbered display maths", () => {
    // LaTeX.js rejects `equation` outright but accepts `\[ … \]`, and
    // KaTeX renders `\tag`. Measured against the shipped build.
    const { text, rewritten } = prepareSource(
      "\\begin{equation}a=b\\end{equation}",
    );
    expect(text).toBe("\\[a=b\\tag{1}\\]");
    expect(rewritten).toEqual(["equation"]);
  });

  it("numbers equations in order and skips the starred ones", () => {
    const { text } = prepareSource(
      "\\begin{equation}a\\end{equation}" +
        "\\begin{equation*}b\\end{equation*}" +
        "\\begin{equation}c\\end{equation}",
    );
    expect(text).toContain("a\\tag{1}");
    expect(text).not.toContain("b\\tag");
    expect(text).toContain("c\\tag{2}");
  });

  it("wraps align in aligned, which KaTeX does understand", () => {
    const { text } = prepareSource(
      "\\begin{align}a &= b \\\\ c &= d\\end{align}",
    );
    expect(text).toContain("\\begin{aligned}");
    expect(text).toContain("\\end{aligned}");
    expect(text).toContain("\\tag{1}");
  });

  it("leaves align* unnumbered", () => {
    const { text } = prepareSource("\\begin{align*}a &= b\\end{align*}");
    expect(text).toContain("\\begin{aligned}");
    expect(text).not.toContain("\\tag");
  });

  it("treats displaymath as unnumbered, as LaTeX does", () => {
    const { text } = prepareSource("\\begin{displaymath}x\\end{displaymath}");
    expect(text).toBe("\\[x\\]");
  });

  it("leaves everything else exactly as written", () => {
    const source =
      "\\section{One}\nText with $x^2$ and \\[y\\] and \\begin{itemize}\\item a\\end{itemize}";
    expect(prepareSource(source).text).toBe(source);
  });

  it("does not rewrite inside verbatim", () => {
    // a literal \begin{equation} in a code sample must reach the page
    const source =
      "\\begin{verbatim}\n\\begin{equation}a=b\\end{equation}\n\\end{verbatim}";
    const { text, rewritten } = prepareSource(source);
    expect(text).toBe(source);
    expect(rewritten).toEqual([]);
  });

  it("still rewrites outside a verbatim block that follows", () => {
    const { text } = prepareSource(
      "\\begin{verbatim}\\begin{equation}x\\end{equation}\\end{verbatim}" +
        "\\begin{equation}y\\end{equation}",
    );
    expect(text).toContain("\\begin{equation}x\\end{equation}");
    expect(text).toContain("\\[y\\tag{1}\\]");
  });

  it("handles an empty document", () => {
    expect(prepareSource("").text).toBe("");
    expect(prepareSource("").rewritten).toEqual([]);
  });
});

describe("naming what still will not render", () => {
  it("reports tabular rather than leaving a raw parser error", () => {
    expect(findUnsupported("\\begin{tabular}{ll}a&b\\end{tabular}")).toEqual([
      "tabular",
    ]);
  });

  it("reports each distinct environment once, sorted", () => {
    expect(
      findUnsupported(
        "\\begin{figure}x\\end{figure}\\begin{tabular}{l}y\\end{tabular}\\begin{figure}z\\end{figure}",
      ),
    ).toEqual(["figure", "tabular"]);
  });

  it("ignores one written inside verbatim", () => {
    expect(
      findUnsupported("\\begin{verbatim}\\begin{tabular}{l}\\end{verbatim}"),
    ).toEqual([]);
  });

  it("says nothing about a document that will render", () => {
    expect(findUnsupported("\\section{A}\n$x$")).toEqual([]);
  });
});
