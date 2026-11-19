/**
 * A LaTeX parser for the subset a student actually writes.
 *
 * ## Why this exists rather than a real engine
 *
 * Real LaTeX in the browser is possible — SwiftLaTeX, TeXlyre and
 * Tectonic/glyphtex all compile TeX to PDF in WASM — but every option
 * costs either a licence this project cannot take or a download this app
 * cannot justify:
 *
 * - SwiftLaTeX, TeXlyre and Overleaf itself are **AGPL-3.0**. This app is
 *   an MIT Excalidraw fork; linking AGPL code into it would force the
 *   whole combined work open. That is a decision for the project's owner,
 *   not a detail to slip into a feature branch.
 * - The MIT options (Tectonic via `glyphtex-engine`) are reported around
 *   20–30 MB before any package packs, and every on-demand design depends
 *   on a TeX Live package endpoint staying up. SwiftLaTeX's public one is
 *   already dead, which is exactly the failure mode an offline-first notes
 *   app must not inherit.
 *
 * So this module renders a documented subset, offline, at no download
 * cost, and `engine.ts` keeps the seam open for a real engine to be added
 * later as an opt-in download without any of this being rewritten.
 *
 * ## What it is NOT
 *
 * Not a TeX implementation. There is no macro expansion, no `\newcommand`,
 * no category codes, no TikZ, no BibTeX. A document using those will parse
 * — unknown commands degrade to their argument text rather than throwing —
 * but it will not look like pdfTeX's output, and `UNSUPPORTED` reports
 * what was skipped so the editor can say so plainly instead of silently
 * dropping it.
 */

/** A span of inline content. */
export type Inline =
  | { kind: "text"; text: string }
  | {
      kind: "emph";
      style: "bold" | "italic" | "mono" | "underline";
      children: Inline[];
    }
  | { kind: "math"; tex: string; display: false }
  | { kind: "ref"; label: string }
  | { kind: "break" };

/** A block-level node. */
export type Block =
  | {
      kind: "heading";
      level: 1 | 2 | 3;
      number: string | null;
      children: Inline[];
    }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: Block[][] }
  | { kind: "math"; tex: string; number: string | null }
  | { kind: "verbatim"; text: string }
  | { kind: "title"; title: Inline[]; author: Inline[]; date: Inline[] };

export interface LatexDocument {
  blocks: Block[];
  /** `\title{}` etc., whether or not `\maketitle` was used. */
  meta: { title: string; author: string; date: string };
  /** Commands and environments encountered that this subset does not do. */
  unsupported: string[];
  /** Problems worth showing the writer — unclosed braces and the like. */
  warnings: string[];
}

/** Environments this subset understands. */
const KNOWN_ENVIRONMENTS = new Set([
  "document",
  "itemize",
  "enumerate",
  "verbatim",
  "equation",
  "equation*",
  "align",
  "align*",
  "displaymath",
  "center",
  "quote",
  "abstract",
]);

/** Inline commands that wrap one argument in a style. */
const STYLE_COMMANDS: Record<string, "bold" | "italic" | "mono" | "underline"> =
  {
    textbf: "bold",
    textit: "italic",
    emph: "italic",
    texttt: "mono",
    underline: "underline",
    textsc: "bold",
  };

/** Characters that are only special because TeX says so. */
const ESCAPES: Record<string, string> = {
  "&": "&",
  "%": "%",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  "\\": "\n",
};

/** Commands that take an argument we simply drop (preamble bookkeeping). */
const DISCARDED_WITH_ARG = new Set([
  "documentclass",
  "usepackage",
  "label",
  "bibliographystyle",
  "bibliography",
  "pagestyle",
  "thispagestyle",
  "setlength",
  "geometry",
  "hypersetup",
]);

/** Commands with no argument that produce nothing visible. */
const DISCARDED_BARE = new Set([
  "maketitle",
  "newpage",
  "clearpage",
  "noindent",
  "centering",
  "tableofcontents",
  "bigskip",
  "medskip",
  "smallskip",
  "hline",
  "par",
]);

/**
 * Strip comments, honouring `\%`.
 *
 * TeX also eats the newline after a comment; doing the same keeps
 * `word% comment\nword` as one word, which is the whole reason people
 * write trailing comments in the first place.
 */
export const stripComments = (source: string): string =>
  source
    .split("\n")
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "\\" && i + 1 < line.length) {
          out += line[i] + line[i + 1];
          i += 1;
          continue;
        }
        if (line[i] === "%") {
          return out;
        }
        out += line[i];
      }
      return out;
    })
    .join("\n");

/** Read a `{...}` group starting at `at` (which must be the brace). */
const readGroup = (
  source: string,
  at: number,
): { body: string; end: number } | null => {
  if (source[at] !== "{") {
    return null;
  }
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(at + 1, i), end: i + 1 };
      }
    }
  }
  return null;
};

interface ParseState {
  unsupported: Set<string>;
  warnings: string[];
}

/** Collapse the whitespace TeX collapses: runs of spaces and single newlines. */
const squash = (text: string): string => text.replace(/[ \t\n]+/g, " ");

const parseInline = (source: string, state: ParseState): Inline[] => {
  const out: Inline[] = [];
  const pushText = (text: string) => {
    if (text === "") {
      return;
    }
    const last = out[out.length - 1];
    if (last && last.kind === "text") {
      last.text += text;
    } else {
      out.push({ kind: "text", text });
    }
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // inline maths: $...$ and \(...\)
    if (ch === "$") {
      const end = source.indexOf("$", i + 1);
      if (end === -1) {
        state.warnings.push("An opening $ has no closing $.");
        pushText(source.slice(i));
        break;
      }
      out.push({ kind: "math", tex: source.slice(i + 1, end), display: false });
      i = end + 1;
      continue;
    }

    if (ch === "\\") {
      const rest = source.slice(i);
      if (rest.startsWith("\\(")) {
        const end = source.indexOf("\\)", i + 2);
        if (end === -1) {
          state.warnings.push("An opening \\( has no closing \\).");
          pushText(rest);
          break;
        }
        out.push({
          kind: "math",
          tex: source.slice(i + 2, end),
          display: false,
        });
        i = end + 2;
        continue;
      }

      const next = source[i + 1];
      if (next !== undefined && ESCAPES[next] !== undefined) {
        if (next === "\\") {
          out.push({ kind: "break" });
        } else {
          pushText(ESCAPES[next]);
        }
        i += 2;
        continue;
      }

      const name = /^\\([a-zA-Z]+)\*?/.exec(rest)?.[1];
      if (!name) {
        // a lone backslash; show it rather than swallowing it
        pushText("\\");
        i += 1;
        continue;
      }
      let cursor = i + rest.indexOf(name) + name.length;
      if (source[cursor] === "*") {
        cursor += 1;
      }
      while (source[cursor] === " ") {
        cursor += 1;
      }

      const style = STYLE_COMMANDS[name];
      if (style) {
        const group = readGroup(source, cursor);
        if (!group) {
          state.warnings.push(`\\${name} is missing its { } argument.`);
          i = cursor;
          continue;
        }
        out.push({
          kind: "emph",
          style,
          children: parseInline(group.body, state),
        });
        i = group.end;
        continue;
      }

      if (name === "ref" || name === "eqref" || name === "pageref") {
        const group = readGroup(source, cursor);
        out.push({ kind: "ref", label: group?.body ?? "?" });
        i = group ? group.end : cursor;
        continue;
      }

      if (DISCARDED_WITH_ARG.has(name)) {
        // an optional [..] first, then the group
        let scan = cursor;
        if (source[scan] === "[") {
          const close = source.indexOf("]", scan);
          scan = close === -1 ? scan : close + 1;
        }
        const group = readGroup(source, scan);
        i = group ? group.end : scan;
        continue;
      }

      if (DISCARDED_BARE.has(name)) {
        i = cursor;
        continue;
      }

      // Unknown: keep the argument's text, record the command. Dropping
      // the text as well would silently delete the student's writing.
      state.unsupported.add(`\\${name}`);
      const group = readGroup(source, cursor);
      if (group) {
        out.push(...parseInline(group.body, state));
        i = group.end;
      } else {
        i = cursor;
      }
      continue;
    }

    if (ch === "{" || ch === "}") {
      i += 1;
      continue;
    }

    // plain run up to the next special character
    const nextSpecial = source.slice(i).search(/[\\${}]/);
    const chunk =
      nextSpecial === -1 ? source.slice(i) : source.slice(i, i + nextSpecial);
    pushText(squash(chunk));
    i += chunk.length === 0 ? 1 : chunk.length;
  }

  return out;
};

/** Section numbering, LaTeX-style: 1, 1.1, 1.1.1. */
class Numbering {
  private counters = [0, 0, 0];

  next(level: 1 | 2 | 3): string {
    this.counters[level - 1] += 1;
    for (let i = level; i < 3; i++) {
      this.counters[i] = 0;
    }
    return this.counters.slice(0, level).join(".");
  }
}

/**
 * Parse a LaTeX source string.
 *
 * Never throws: a malformed document produces the blocks it could read
 * plus warnings. Someone mid-sentence should not lose their preview.
 */
export const parseLatex = (source: string): LatexDocument => {
  const state: ParseState = { unsupported: new Set(), warnings: [] };
  const clean = stripComments(source);

  const meta = { title: "", author: "", date: "" };
  for (const field of ["title", "author", "date"] as const) {
    const at = clean.indexOf(`\\${field}{`);
    if (at !== -1) {
      const group = readGroup(clean, at + field.length + 1);
      if (group) {
        meta[field] = squash(group.body).trim();
      }
    }
  }

  // Only the body is rendered; a preamble is configuration, not content.
  const bodyStart = clean.indexOf("\\begin{document}");
  const bodyEnd = clean.indexOf("\\end{document}");
  const body =
    bodyStart === -1
      ? clean
      : clean.slice(
          bodyStart + "\\begin{document}".length,
          bodyEnd === -1 ? undefined : bodyEnd,
        );
  if (bodyStart !== -1 && bodyEnd === -1) {
    state.warnings.push("\\begin{document} has no \\end{document}.");
  }

  const numbering = new Numbering();
  let equationNumber = 0;
  const blocks: Block[] = [];
  const hasMaketitle = /\\maketitle\b/.test(clean);
  if (hasMaketitle && (meta.title || meta.author || meta.date)) {
    blocks.push({
      kind: "title",
      title: parseInline(meta.title, state),
      author: parseInline(meta.author, state),
      date: parseInline(meta.date, state),
    });
  }

  const pushParagraph = (text: string) => {
    const children = parseInline(text, state);
    const empty = children.every(
      (node) => node.kind === "text" && node.text.trim() === "",
    );
    if (children.length > 0 && !empty) {
      blocks.push({ kind: "paragraph", children });
    }
  };

  /** Split a chunk into paragraphs and headings, in order. */
  const consumeText = (text: string) => {
    const headingRe = /\\(sub)?(sub)?section\*?\s*\{/g;
    let last = 0;
    let match = headingRe.exec(text);
    while (match) {
      pushParagraph(text.slice(last, match.index));
      const group = readGroup(text, match.index + match[0].length - 1);
      const level = (match[1] ? (match[2] ? 3 : 2) : 1) as 1 | 2 | 3;
      const starred = match[0].includes("*");
      blocks.push({
        kind: "heading",
        level,
        number: starred ? null : numbering.next(level),
        children: parseInline(group?.body ?? "", state),
      });
      last = group ? group.end : match.index + match[0].length;
      headingRe.lastIndex = last;
      match = headingRe.exec(text);
    }
    for (const part of text.slice(last).split(/\n\s*\n/)) {
      pushParagraph(part);
    }
  };

  const envRe = /\\begin\{([a-zA-Z*]+)\}/g;
  let cursor = 0;
  let env = envRe.exec(body);
  while (env) {
    const name = env[1];
    const close = body.indexOf(`\\end{${name}}`, env.index);
    if (close === -1) {
      state.warnings.push(`\\begin{${name}} has no \\end{${name}}.`);
      break;
    }
    consumeText(body.slice(cursor, env.index));
    const inner = body.slice(env.index + env[0].length, close);

    if (!KNOWN_ENVIRONMENTS.has(name)) {
      state.unsupported.add(`${name} environment`);
      consumeText(inner);
    } else if (name === "itemize" || name === "enumerate") {
      const items = inner
        .split(/\\item\b/)
        .slice(1)
        .map((item) => {
          const children = parseInline(item, state);
          return [{ kind: "paragraph", children } as Block];
        });
      blocks.push({ kind: "list", ordered: name === "enumerate", items });
    } else if (name === "verbatim") {
      blocks.push({ kind: "verbatim", text: inner.replace(/^\n/, "") });
    } else if (
      name === "equation" ||
      name === "equation*" ||
      name === "align" ||
      name === "align*" ||
      name === "displaymath"
    ) {
      const numbered = !name.endsWith("*") && name !== "displaymath";
      if (numbered) {
        equationNumber += 1;
      }
      blocks.push({
        kind: "math",
        // `align` needs its own environment to typeset the & alignment
        tex: name.startsWith("align")
          ? `\\begin{aligned}${inner}\\end{aligned}`
          : inner.trim(),
        number: numbered ? String(equationNumber) : null,
      });
    } else {
      // document / center / quote / abstract: content, no special layout
      consumeText(inner);
    }

    cursor = close + `\\end{${name}}`.length;
    envRe.lastIndex = cursor;
    env = envRe.exec(body);
  }

  // display maths written as $$..$$ or \[..\], outside any environment
  const tail = body.slice(cursor);
  const displayRe = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
  let tailCursor = 0;
  let display = displayRe.exec(tail);
  while (display) {
    consumeText(tail.slice(tailCursor, display.index));
    blocks.push({
      kind: "math",
      tex: (display[1] ?? display[2] ?? "").trim(),
      number: null,
    });
    tailCursor = display.index + display[0].length;
    display = displayRe.exec(tail);
  }
  consumeText(tail.slice(tailCursor));

  return {
    blocks,
    meta,
    unsupported: [...state.unsupported].sort(),
    warnings: state.warnings,
  };
};
