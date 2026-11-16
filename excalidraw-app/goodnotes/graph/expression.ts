/**
 * A small, bounded mathematical-expression parser and evaluator.
 *
 * ## Why this exists
 *
 * The graph feature lets a student type an expression (`y = x^2 - 3x + 2`)
 * into a text box. Running that through `eval()` or `new Function()` would be
 * arbitrary code execution from untrusted input — a note shared between
 * students, or a spec round-tripped through `customData` in a saved scene,
 * would be able to run anything in the page's origin. **Nothing in this file
 * calls `eval`, `new Function`, `setTimeout(string)` or `import()`.** The
 * grammar below is the entire language: there is no way to reach a property,
 * a global, or a string from it.
 *
 * ## The grammar
 *
 * ```
 * expr    := term (("+" | "-") term)*
 * term    := factor (("*" | "/" | <implicit>) factor)*
 * factor  := ("-" | "+")* power
 * power   := atom ("^" factor)?            // right-associative
 * atom    := NUMBER | CONST | VAR | FUNC "(" expr ")" | "(" expr ")"
 * ```
 *
 * Implemented as a tokenizer plus a **shunting-yard** pass that builds an AST
 * ({@link ExpressionNode}), which {@link evaluateNode} then walks numerically.
 *
 * - operators: `+ - * / ^` (and `**` as a synonym for `^`)
 * - parentheses, unary minus/plus
 * - implicit multiplication where unambiguous: `2x`, `3sin(x)`, `2(x+1)`,
 *   `(x+1)(x-1)`, `x pi`
 * - functions: sin cos tan asin acos atan sinh cosh tanh sqrt abs ln log exp
 *   floor ceil round  (`log` is base 10, `ln` is natural)
 * - constants: `pi`, `e`
 * - variable: `x` by default (configurable)
 *
 * Anything else is rejected with an {@link ExpressionError} that carries the
 * offending token and its index in the source string, so the UI can say
 * exactly what it choked on.
 *
 * Scientific-notation literals (`1e3`) are deliberately NOT supported: `e` is
 * a constant here, so `2e` already means `2 × e`. Write `2*10^3`.
 */

/** Unary numeric functions the language exposes. */
export const FUNCTIONS: Readonly<Record<string, (value: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

/** Named constants the language exposes. */
export const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
};

/** Every function name, longest first — used for greedy name splitting. */
const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export type BinaryOperator = "+" | "-" | "*" | "/" | "^";

export type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "negate"; argument: ExpressionNode }
  | { type: "call"; name: string; argument: ExpressionNode }
  | {
      type: "binary";
      operator: BinaryOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    };

/** A parse failure, with the exact token and offset that caused it. */
export class ExpressionError extends Error {
  /** 0-based index into the (normalized) source string. */
  readonly position: number;
  /** The offending text, `""` at end of input. */
  readonly token: string;
  /** The source the parser was given. */
  readonly source: string;

  constructor(
    message: string,
    options: { position: number; token: string; source: string },
  ) {
    super(message);
    this.name = "ExpressionError";
    this.position = options.position;
    this.token = options.token;
    this.source = options.source;
  }
}

export interface ParsedExpression {
  /** The normalized source actually parsed (after `y =` and alias stripping). */
  readonly source: string;
  /** The original, untouched input. */
  readonly input: string;
  readonly ast: ExpressionNode;
  /** Variable names referenced, in first-seen order. */
  readonly variables: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* normalization                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Folds the characters a student actually types (a Unicode minus pasted from
 * a textbook, `×`, `÷`, `**`) onto the ASCII the tokenizer understands, and
 * strips a leading `y =` / `f(x) =`. Length-preserving except for the
 * `y =` prefix and `**`, both of which are compensated for so reported
 * positions stay meaningful relative to the returned string.
 */
export const normalizeExpressionSource = (input: string): string => {
  let text = input
    .replace(/[−‒–—]/g, "-")
    .replace(/[×⋅·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[⁡​]/g, "")
    .replace(/\*\*/g, "^");
  // "y = …", "f(x) = …", "g(t)=…"
  const assignment = /^\s*(?:[a-z]\s*(?:\(\s*[a-z]\s*\))?)\s*=\s*(?!=)/i.exec(
    text,
  );
  if (assignment) {
    text = " ".repeat(assignment[0].length) + text.slice(assignment[0].length);
  }
  return text;
};

/* -------------------------------------------------------------------------- */
/* tokenizer                                                                  */
/* -------------------------------------------------------------------------- */

type Token =
  | { kind: "number"; value: number; text: string; position: number }
  | { kind: "name"; text: string; position: number }
  | { kind: "operator"; text: BinaryOperator; position: number }
  | { kind: "lparen" | "rparen"; text: string; position: number };

const isDigit = (ch: string) => ch >= "0" && ch <= "9";
const isLetter = (ch: string) => /[a-zA-Z]/.test(ch);

/**
 * Splits a run of letters into known names, greedily longest-first, so
 * `2xsin(x)` tokenizes as `2 * x * sin(x)` and `xpi` as `x * pi`.
 * Throws on the first piece that is not a known function, constant or
 * variable.
 */
const splitNameRun = (
  run: string,
  runStart: number,
  source: string,
  variables: readonly string[],
): { name: string; position: number }[] => {
  const known = [...FUNCTION_NAMES, ...Object.keys(CONSTANTS), ...variables]
    .slice()
    .sort((a, b) => b.length - a.length);
  const pieces: { name: string; position: number }[] = [];
  let index = 0;
  while (index < run.length) {
    const match = known.find(
      (candidate) =>
        run.startsWith(candidate, index) &&
        // a variable/constant must not swallow the head of a longer unknown
        // word silently: that is handled by continuing the loop, which will
        // throw on the remainder.
        true,
    );
    if (!match) {
      // report the whole remaining word — that is what the user sees as wrong
      const rest = /^[a-zA-Z]+/.exec(run.slice(index))?.[0] ?? run.slice(index);
      throw new ExpressionError(
        `I don't know what "${rest}" means. Use x, pi, e, or one of: ${FUNCTION_NAMES.join(
          ", ",
        )}.`,
        { position: runStart + index, token: rest, source },
      );
    }
    pieces.push({ name: match, position: runStart + index });
    index += match.length;
  }
  return pieces;
};

const tokenize = (
  source: string,
  variables: readonly string[],
): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(source[index + 1] ?? ""))) {
      const start = index;
      while (index < source.length && isDigit(source[index])) {
        index += 1;
      }
      if (source[index] === ".") {
        index += 1;
        while (index < source.length && isDigit(source[index])) {
          index += 1;
        }
      }
      const text = source.slice(start, index);
      if (source[index] === ".") {
        throw new ExpressionError(
          `"${text}." has two decimal points.`,
          { position: start, token: `${text}.`, source },
        );
      }
      tokens.push({
        kind: "number",
        value: Number(text),
        text,
        position: start,
      });
      continue;
    }
    if (isLetter(ch)) {
      const start = index;
      while (index < source.length && isLetter(source[index])) {
        index += 1;
      }
      const run = source.slice(start, index);
      for (const piece of splitNameRun(run, start, source, variables)) {
        tokens.push({
          kind: "name",
          text: piece.name,
          position: piece.position,
        });
      }
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ kind: "operator", text: ch, position: index });
      index += 1;
      continue;
    }
    if (ch === "(" || ch === "[") {
      tokens.push({ kind: "lparen", text: ch, position: index });
      index += 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      tokens.push({ kind: "rparen", text: ch, position: index });
      index += 1;
      continue;
    }
    throw new ExpressionError(`"${ch}" isn't something I can plot.`, {
      position: index,
      token: ch,
      source,
    });
  }
  return tokens;
};

/* -------------------------------------------------------------------------- */
/* shunting-yard → AST                                                        */
/* -------------------------------------------------------------------------- */

interface OperatorInfo {
  precedence: number;
  rightAssociative: boolean;
}

const BINARY_OPERATORS: Record<BinaryOperator, OperatorInfo> = {
  "+": { precedence: 1, rightAssociative: false },
  "-": { precedence: 1, rightAssociative: false },
  "*": { precedence: 2, rightAssociative: false },
  "/": { precedence: 2, rightAssociative: false },
  "^": { precedence: 4, rightAssociative: true },
};

/** Unary minus binds tighter than `*` but looser than `^`, so `-x^2 = -(x^2)`. */
const UNARY_PRECEDENCE = 3;

type StackEntry =
  | { kind: "binary"; operator: BinaryOperator; position: number }
  | { kind: "unary"; position: number }
  | { kind: "function"; name: string; position: number }
  | { kind: "lparen"; position: number };

export interface ParseOptions {
  /** Names treated as free variables. Default `["x"]`. */
  variables?: readonly string[];
}

/**
 * Parses an expression into an AST. Throws {@link ExpressionError} with a
 * message and `position` suitable for showing under the input.
 */
export const parseExpression = (
  input: string,
  options: ParseOptions = {},
): ParsedExpression => {
  const variables = options.variables ?? ["x"];
  const source = normalizeExpressionSource(input);
  if (source.trim() === "") {
    throw new ExpressionError("Type an expression, for example x^2 - 3x + 2.", {
      position: 0,
      token: "",
      source,
    });
  }
  const tokens = tokenize(source, variables);

  const output: ExpressionNode[] = [];
  const stack: StackEntry[] = [];
  const seen: string[] = [];
  /** True when the next token continues a value (so `-` would be binary). */
  let afterValue = false;

  const fail = (message: string, position: number, token: string): never => {
    throw new ExpressionError(message, { position, token, source });
  };

  const popOperand = (position: number, token: string): ExpressionNode => {
    const node = output.pop();
    if (!node) {
      return fail(
        `"${token}" is missing a number or variable to work on.`,
        position,
        token,
      );
    }
    return node;
  };

  const reduce = (entry: StackEntry) => {
    if (entry.kind === "unary") {
      const argument = popOperand(entry.position, "-");
      output.push({ type: "negate", argument });
      return;
    }
    if (entry.kind === "function") {
      const argument = popOperand(entry.position, entry.name);
      output.push({ type: "call", name: entry.name, argument });
      return;
    }
    if (entry.kind === "binary") {
      const right = popOperand(entry.position, entry.operator);
      const left = popOperand(entry.position, entry.operator);
      output.push({
        type: "binary",
        operator: entry.operator,
        left,
        right,
      });
      return;
    }
    fail("Unbalanced parenthesis.", entry.position, "(");
  };

  const pushImplicitMultiply = (position: number) => {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.kind === "lparen") {
        break;
      }
      const precedence =
        top.kind === "unary"
          ? UNARY_PRECEDENCE
          : top.kind === "function"
          ? 5
          : BINARY_OPERATORS[top.operator].precedence;
      if (precedence < 2) {
        break;
      }
      stack.pop();
      reduce(top);
    }
    stack.push({ kind: "binary", operator: "*", position });
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === "number") {
      if (afterValue) {
        pushImplicitMultiply(token.position);
      }
      output.push({ type: "number", value: token.value });
      afterValue = true;
      continue;
    }

    if (token.kind === "name") {
      if (afterValue) {
        pushImplicitMultiply(token.position);
      }
      if (token.text in FUNCTIONS) {
        const next = tokens[i + 1];
        if (!next || next.kind !== "lparen") {
          fail(
            `"${token.text}" needs brackets around what it applies to, like ${token.text}(x).`,
            token.position,
            token.text,
          );
        }
        stack.push({
          kind: "function",
          name: token.text,
          position: token.position,
        });
        afterValue = false;
        continue;
      }
      if (token.text in CONSTANTS) {
        output.push({ type: "number", value: CONSTANTS[token.text] });
        afterValue = true;
        continue;
      }
      if (!seen.includes(token.text)) {
        seen.push(token.text);
      }
      output.push({ type: "variable", name: token.text });
      afterValue = true;
      continue;
    }

    if (token.kind === "lparen") {
      if (afterValue) {
        pushImplicitMultiply(token.position);
      }
      stack.push({ kind: "lparen", position: token.position });
      afterValue = false;
      continue;
    }

    if (token.kind === "rparen") {
      if (!afterValue) {
        fail(
          "There is nothing inside these brackets.",
          token.position,
          token.text,
        );
      }
      let found = false;
      while (stack.length > 0) {
        const top = stack.pop() as StackEntry;
        if (top.kind === "lparen") {
          found = true;
          break;
        }
        reduce(top);
      }
      if (!found) {
        fail(
          'This ")" has no matching "(".',
          token.position,
          token.text,
        );
      }
      // a function application closes with its argument's bracket
      const top = stack[stack.length - 1];
      if (top && top.kind === "function") {
        stack.pop();
        reduce(top);
      }
      afterValue = true;
      continue;
    }

    // operator
    if (!afterValue) {
      if (token.text === "-") {
        stack.push({ kind: "unary", position: token.position });
        continue;
      }
      if (token.text === "+") {
        continue; // unary plus is a no-op
      }
      fail(
        `"${token.text}" needs a number or variable before it.`,
        token.position,
        token.text,
      );
    }
    const info = BINARY_OPERATORS[token.text];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.kind === "lparen") {
        break;
      }
      const topPrecedence =
        top.kind === "unary"
          ? UNARY_PRECEDENCE
          : top.kind === "function"
          ? 5
          : BINARY_OPERATORS[top.operator].precedence;
      if (
        topPrecedence > info.precedence ||
        (topPrecedence === info.precedence && !info.rightAssociative)
      ) {
        stack.pop();
        reduce(top);
      } else {
        break;
      }
    }
    stack.push({
      kind: "binary",
      operator: token.text,
      position: token.position,
    });
    afterValue = false;
  }

  if (!afterValue) {
    const last = tokens[tokens.length - 1];
    fail(
      "The expression stops in the middle — something is missing at the end.",
      last ? last.position : source.length,
      last ? last.text : "",
    );
  }

  while (stack.length > 0) {
    const top = stack.pop() as StackEntry;
    if (top.kind === "lparen") {
      fail('This "(" is never closed.', top.position, "(");
    }
    reduce(top);
  }

  if (output.length !== 1) {
    fail(
      "I couldn't make sense of this expression — check the operators between terms.",
      0,
      source.trim(),
    );
  }

  return { source, input, ast: output[0], variables: seen };
};

/* -------------------------------------------------------------------------- */
/* evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Evaluates an AST. Unknown variables and out-of-domain results come back as
 * `NaN` (never throw) — the plotter treats non-finite samples as gaps.
 */
export const evaluateNode = (
  node: ExpressionNode,
  scope: Record<string, number>,
): number => {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable": {
      const value = scope[node.name];
      return typeof value === "number" ? value : NaN;
    }
    case "negate":
      return -evaluateNode(node.argument, scope);
    case "call": {
      const fn = FUNCTIONS[node.name];
      return fn ? fn(evaluateNode(node.argument, scope)) : NaN;
    }
    case "binary": {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "^":
          return Math.pow(left, right);
        default:
          return NaN;
      }
    }
    default:
      return NaN;
  }
};

/**
 * Parses once and returns a fast single-variable evaluator. Throws
 * {@link ExpressionError} if the source does not parse.
 *
 * ```ts
 * const f = compileExpression("x^2 - 3x + 2");
 * f(3); // => 2
 * ```
 */
export const compileExpression = (
  input: string,
  options: ParseOptions = {},
): ((x: number) => number) & { parsed: ParsedExpression } => {
  const parsed = parseExpression(input, options);
  const variable = (options.variables ?? ["x"])[0];
  const scope: Record<string, number> = {};
  const evaluate = (x: number) => {
    scope[variable] = x;
    return evaluateNode(parsed.ast, scope);
  };
  return Object.assign(evaluate, { parsed });
};

/** Renders an AST back to a canonical, fully-parenthesized-where-needed string. */
export const formatNode = (node: ExpressionNode): string => {
  switch (node.type) {
    case "number":
      return String(node.value);
    case "variable":
      return node.name;
    case "negate":
      return `-${formatNode(node.argument)}`;
    case "call":
      return `${node.name}(${formatNode(node.argument)})`;
    case "binary":
      return `(${formatNode(node.left)} ${node.operator} ${formatNode(
        node.right,
      )})`;
    default:
      return "";
  }
};

/** A one-line, user-facing description of a parse failure. */
export const describeExpressionError = (error: unknown): string => {
  if (error instanceof ExpressionError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "That expression could not be read.";
};
