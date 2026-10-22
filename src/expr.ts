export type Expr =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "neg"; readonly arg: Expr }
  | { readonly kind: "bin"; readonly op: BinOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly fn: FnName; readonly arg: Expr };

type BinOp = "+" | "-" | "*" | "/" | "^";

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  floor: Math.floor,
  round: Math.round,
} as const satisfies Record<string, (x: number) => number>;

type FnName = keyof typeof FUNCTIONS;

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

export type ParseResult = { ok: true; expr: Expr } | { ok: false; error: string };

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; op: BinOp | "(" | ")" };

const OP_CHARS = ["+", "-", "*", "/", "^", "(", ")"] as const;

function isOpChar(ch: string): ch is (typeof OP_CHARS)[number] {
  return (OP_CHARS as readonly string[]).includes(ch);
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Z_]/.test(ch)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
      if (!m) throw new Error(`bad identifier at ${i}`);
      tokens.push({ kind: "ident", name: m[0] });
      i += m[0].length;
    } else if (isOpChar(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
    } else {
      throw new Error(`unexpected character '${ch}' at ${i}`);
    }
  }
  return tokens;
}

function isFn(name: string): name is FnName {
  return Object.hasOwn(FUNCTIONS, name);
}

export function parseExpr(src: string): ParseResult {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (op: string): boolean => {
    const t = peek();
    return t !== undefined && t.kind === "op" && t.op === op;
  };
  const takeBinOp = (...ops: BinOp[]): BinOp | null => {
    const t = peek();
    if (t === undefined || t.kind !== "op") return null;
    const op = ops.find((o) => o === t.op);
    if (op === undefined) return null;
    pos++;
    return op;
  };

  // Precedence climbing: sum < product < unary < power (right-assoc) < atom.
  const sum = (): Expr => {
    let left = product();
    for (let op = takeBinOp("+", "-"); op !== null; op = takeBinOp("+", "-")) {
      left = { kind: "bin", op, left, right: product() };
    }
    return left;
  };
  const product = (): Expr => {
    let left = unary();
    for (let op = takeBinOp("*", "/"); op !== null; op = takeBinOp("*", "/")) {
      left = { kind: "bin", op, left, right: unary() };
    }
    return left;
  };
  const unary = (): Expr => {
    if (isOp("-")) {
      pos++;
      return { kind: "neg", arg: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): Expr => {
    const base = atom();
    if (isOp("^")) {
      pos++;
      return { kind: "bin", op: "^", left: base, right: unary() };
    }
    return base;
  };
  const atom = (): Expr => {
    const t = tokens[pos++];
    if (t === undefined) throw new Error("unexpected end of expression");
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "ident") {
      if (isOp("(")) {
        if (!isFn(t.name)) throw new Error(`unknown function '${t.name}'`);
        pos++;
        const arg = sum();
        if (!isOp(")")) throw new Error("expected ')'");
        pos++;
        return { kind: "call", fn: t.name, arg };
      }
      return { kind: "var", name: t.name };
    }
    if (t.op === "(") {
      const inner = sum();
      if (!isOp(")")) throw new Error("expected ')'");
      pos++;
      return inner;
    }
    throw new Error(`unexpected '${t.op}'`);
  };

  try {
    const expr = sum();
    if (pos !== tokens.length) return { ok: false, error: `unexpected token after position ${pos}` };
    return { ok: true, expr };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type Env = Readonly<Record<string, number>>;

export function evaluate(expr: Expr, env: Env): number {
  switch (expr.kind) {
    case "num":
      return expr.value;
    case "var": {
      const v = env[expr.name] ?? CONSTANTS[expr.name];
      if (v === undefined) throw new Error(`unbound variable '${expr.name}'`);
      return v;
    }
    case "neg":
      return -evaluate(expr.arg, env);
    case "call":
      return FUNCTIONS[expr.fn](evaluate(expr.arg, env));
    case "bin": {
      const a = evaluate(expr.left, env);
      const b = evaluate(expr.right, env);
      switch (expr.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return a ** b;
      }
    }
  }
}

export function freeVariables(expr: Expr): Set<string> {
  const out = new Set<string>();
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "num":
        return;
      case "var":
        if (CONSTANTS[e.name] === undefined) out.add(e.name);
        return;
      case "neg":
      case "call":
        walk(e.arg);
        return;
      case "bin":
        walk(e.left);
        walk(e.right);
        return;
    }
  };
  walk(expr);
  return out;
}

export const SUPPORTED_FUNCTIONS: readonly string[] = Object.keys(FUNCTIONS);
