import { describe, expect, it } from "vitest";

import { parseLatex, stripComments } from "./parse";

import type { Block, Inline } from "./parse";

const textOf = (nodes: Inline[]): string =>
  nodes
    .map((n) =>
      n.kind === "text"
        ? n.text
        : n.kind === "emph"
        ? textOf(n.children)
        : n.kind === "math"
        ? `$${n.tex}$`
        : n.kind === "ref"
        ? `[${n.label}]`
        : "\n",
    )
    .join("");

const blocksOf = (src: string): Block[] => parseLatex(src).blocks;

const doc = (body: string) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;

describe("comments", () => {
  it("drops a comment and the newline after it, as TeX does", () => {
    expect(stripComments("one% a note\ntwo")).toBe("one\ntwo");
  });

  it("keeps an escaped percent", () => {
    expect(stripComments("50\\% off")).toBe("50\\% off");
  });
});

describe("structure", () => {
  it("renders only the body, not the preamble", () => {
    const blocks = blocksOf(
      "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHello\n\\end{document}",
    );
    expect(blocks).toHaveLength(1);
    expect(textOf((blocks[0] as any).children)).toContain("Hello");
  });

  it("numbers sections the way LaTeX does", () => {
    const blocks = blocksOf(
      doc(
        "\\section{One}\\subsection{One A}\\subsubsection{Deep}\\section{Two}",
      ),
    ).filter((b) => b.kind === "heading") as any[];
    expect(blocks.map((b) => [b.level, b.number])).toEqual([
      [1, "1"],
      [2, "1.1"],
      [3, "1.1.1"],
      [1, "2"],
    ]);
  });

  it("leaves a starred section unnumbered", () => {
    const [heading] = blocksOf(doc("\\section*{Preface}")) as any[];
    expect(heading.number).toBeNull();
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = blocksOf(doc("First one.\n\nSecond one."));
    expect(blocks).toHaveLength(2);
    expect(textOf((blocks[1] as any).children)).toContain("Second");
  });

  it("builds a title block only when \\maketitle asks for one", () => {
    const withTitle = parseLatex(
      `\\title{Notes}\\author{A}\\date{Today}${doc("\\maketitle Body")}`,
    );
    expect(withTitle.blocks[0].kind).toBe("title");
    expect(withTitle.meta.title).toBe("Notes");

    const without = parseLatex(`\\title{Notes}${doc("Body")}`);
    expect(without.blocks.some((b) => b.kind === "title")).toBe(false);
    // the metadata is still read, for the document's own name
    expect(without.meta.title).toBe("Notes");
  });
});

describe("inline", () => {
  it("handles nested styles", () => {
    const [p] = blocksOf(doc("\\textbf{bold and \\textit{italic}}")) as any[];
    // children[0] is the whitespace before it; find the styled node
    const bold = p.children.find((c: Inline) => c.kind === "emph");
    expect(bold.style).toBe("bold");
    expect(bold.children.some((c: Inline) => c.kind === "emph")).toBe(true);
  });

  it("reads inline maths in both spellings", () => {
    const [p] = blocksOf(doc("where $x^2$ and \\(y_1\\) meet")) as any[];
    const maths = p.children.filter((c: Inline) => c.kind === "math");
    expect(maths.map((m: any) => m.tex)).toEqual(["x^2", "y_1"]);
  });

  it("does not mistake an escaped dollar for maths", () => {
    const [p] = blocksOf(doc("costs \\$5 today")) as any[];
    expect(p.children.every((c: Inline) => c.kind !== "math")).toBe(true);
    expect(textOf(p.children)).toContain("$5");
  });

  it("turns \\\\ into a line break", () => {
    const [p] = blocksOf(doc("one \\\\ two")) as any[];
    expect(p.children.some((c: Inline) => c.kind === "break")).toBe(true);
  });

  it("unescapes the characters TeX reserves", () => {
    const [p] = blocksOf(doc("a \\& b \\% c \\_ d \\# e")) as any[];
    const text = textOf(p.children);
    expect(text).toContain("&");
    expect(text).toContain("%");
    expect(text).toContain("_");
    expect(text).toContain("#");
  });

  it("collapses whitespace the way TeX does", () => {
    const [p] = blocksOf(doc("one    two\nthree")) as any[];
    expect(textOf(p.children).replace(/^\s+|\s+$/g, "")).toBe("one two three");
  });
});

describe("environments", () => {
  it("reads both kinds of list", () => {
    const [bullets, numbers] = blocksOf(
      doc(
        "\\begin{itemize}\\item one\\item two\\end{itemize}\\begin{enumerate}\\item a\\end{enumerate}",
      ),
    ) as any[];
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(numbers.ordered).toBe(true);
  });

  it("keeps verbatim exactly, including the backslashes", () => {
    const [v] = blocksOf(
      doc("\\begin{verbatim}\n\\textbf{not bold}\n\\end{verbatim}"),
    ) as any[];
    expect(v.kind).toBe("verbatim");
    expect(v.text).toContain("\\textbf{not bold}");
  });

  it("numbers equations, and leaves starred ones unnumbered", () => {
    const blocks = blocksOf(
      doc(
        "\\begin{equation}a=b\\end{equation}\\begin{equation*}c=d\\end{equation*}\\begin{equation}e=f\\end{equation}",
      ),
    ).filter((b) => b.kind === "math") as any[];
    expect(blocks.map((b) => b.number)).toEqual(["1", null, "2"]);
  });

  it("wraps align so the ampersands actually align", () => {
    const [m] = blocksOf(
      doc("\\begin{align}a &= b \\\\ c &= d\\end{align}"),
    ) as any[];
    expect(m.tex).toContain("\\begin{aligned}");
  });

  it("reads display maths written as $$ or \\[", () => {
    const blocks = blocksOf(doc("$$x=1$$ and \\[y=2\\]")).filter(
      (b) => b.kind === "math",
    ) as any[];
    expect(blocks.map((b) => b.tex)).toEqual(["x=1", "y=2"]);
  });
});

describe("degrading honestly", () => {
  it("keeps the words inside a command it does not know", () => {
    // silently deleting someone's sentence is the worst possible failure
    const parsed = parseLatex(doc("\\marginpar{keep this text}"));
    const text = parsed.blocks
      .map((b: any) => textOf(b.children ?? []))
      .join("");
    expect(text).toContain("keep this text");
    expect(parsed.unsupported).toContain("\\marginpar");
  });

  it("reports an unsupported environment rather than dropping it", () => {
    const parsed = parseLatex(
      doc("\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}"),
    );
    expect(parsed.unsupported).toContain("tikzpicture environment");
  });

  it("warns about an unclosed environment instead of throwing", () => {
    const parsed = parseLatex(doc("\\begin{itemize}\\item one"));
    expect(parsed.warnings.join(" ")).toContain("has no \\end{itemize}");
  });

  it("warns about unbalanced maths instead of throwing", () => {
    expect(() => parseLatex(doc("$x^2"))).not.toThrow();
    expect(parseLatex(doc("$x^2")).warnings.join(" ")).toMatch(/closing \$/);
  });

  it("survives an empty document and a bare fragment", () => {
    expect(parseLatex("").blocks).toEqual([]);
    // no \begin{document} at all: treat the whole string as the body
    expect(parseLatex("Just a sentence.").blocks).toHaveLength(1);
  });

  it("does not hang on a stray backslash or brace", () => {
    expect(() => parseLatex(doc("a \\ b { c } d"))).not.toThrow();
  });
});
