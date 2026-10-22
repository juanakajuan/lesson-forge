import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, freeVariables, parseExpr, type Expr } from "../src/expr.ts";

// Oracle for mixed trees: JavaScript operators on a tree this file generated.
// The string under test is fully parenthesized, then parsed by parseExpr.
// Precedence is checked separately, on unparenthesized strings, against JavaScript.

const SEED = 20261021;
const ENV = { x: 3 };

type Op = "+" | "-" | "*" | "/" | "^";
type Tree =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; arg: Tree }
  | { kind: "bin"; op: Op; left: Tree; right: Tree }
  | { kind: "call"; fn: "abs" | "floor" | "sqrt"; arg: Tree };

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function source(tree: Tree): string {
  switch (tree.kind) {
    case "num":
      return String(tree.value);
    case "var":
      return tree.name;
    case "neg":
      return `(-(${source(tree.arg)}))`;
    case "bin":
      return `(${source(tree.left)}${tree.op}${source(tree.right)})`;
    case "call":
      return `${tree.fn}(${source(tree.arg)})`;
  }
}

function fold(tree: Tree, env: Record<string, number>): number {
  switch (tree.kind) {
    case "num":
      return tree.value;
    case "var":
      if (Object.hasOwn(env, tree.name)) return env[tree.name] ?? Number.NaN;
      if (tree.name === "pi") return Math.PI;
      if (tree.name === "e") return Math.E;
      throw new Error(`unbound ${tree.name}`);
    case "neg":
      return -fold(tree.arg, env);
    case "call": {
      const arg = fold(tree.arg, env);
      if (tree.fn === "abs") return Math.abs(arg);
      if (tree.fn === "floor") return Math.floor(arg);
      return Math.sqrt(arg);
    }
    case "bin": {
      const left = fold(tree.left, env);
      const right = fold(tree.right, env);
      if (tree.op === "+") return left + right;
      if (tree.op === "-") return left - right;
      if (tree.op === "*") return left * right;
      if (tree.op === "/") return left / right;
      return left ** right;
    }
  }
}

function value(src: string, env: Record<string, number> = {}): number {
  const parsed = parseExpr(src);
  assert.equal(parsed.ok, true, `parses: ${src}${parsed.ok ? "" : ` (${parsed.error})`}`);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluate(parsed.expr, env);
}

function parsedExpr(src: string): Expr {
  const parsed = parseExpr(src);
  assert.equal(parsed.ok, true, src);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.expr;
}

function integer(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function num(value: number): Tree {
  return { kind: "num", value };
}

function gen(rng: () => number, depth: number): Tree {
  if (depth === 0 || rng() < 0.4) {
    const roll = rng();
    if (roll < 0.15) return { kind: "var", name: "x" };
    if (roll < 0.25) return { kind: "var", name: "pi" };
    return num(integer(rng, -8, 8));
  }
  const roll = rng();
  if (roll < 0.15) return { kind: "neg", arg: gen(rng, depth - 1) };
  if (roll < 0.3) {
    if (rng() < 0.34) return { kind: "call", fn: "sqrt", arg: num(integer(rng, 0, 9)) };
    return { kind: "call", fn: rng() < 0.5 ? "abs" : "floor", arg: gen(rng, depth - 1) };
  }
  const op = (["+", "-", "*", "/", "^"] as const)[integer(rng, 0, 4)] ?? "+";
  if (op === "/") return { kind: "bin", op, left: gen(rng, depth - 1), right: num(integer(rng, 1, 8)) };
  if (op === "^") return { kind: "bin", op, left: gen(rng, depth - 1), right: num(integer(rng, 0, 3)) };
  return { kind: "bin", op, left: gen(rng, depth - 1), right: gen(rng, depth - 1) };
}

test("power is right-associative and a leading minus binds tighter than power", () => {
  for (let a = 0; a <= 4; a++) {
    for (let b = 0; b <= 4; b++) {
      for (let c = 0; c <= 4; c++) {
        const src = `${a}^${b}^${c}`;
        assert.equal(value(src), a ** b ** c, src);
      }
    }
  }
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 4; b++) {
      const src = `-${a}^${b}`;
      const want = -(a ** b);
      const asPowerOfNegative = (-a) ** b;
      assert.equal(value(src), want, src);
      if (want != asPowerOfNegative) assert.notEqual(value(src), asPowerOfNegative, src);
    }
  }
  assert.equal(value("2^3^2"), 512);
  assert.equal(value("-2^2"), -4);
  assert.equal(value("(-2)^2"), 4);
});

test("product binds tighter than sum, and subtraction groups to the left", () => {
  for (let a = -6; a <= 6; a++) {
    for (let b = -6; b <= 6; b++) {
      for (let c = -6; c <= 6; c++) {
        const src = `${a}+${b}*${c}`;
        assert.equal(value(src), a + b * c, src);
        const left = (a - b) - c;
        const right = a - (b - c);
        const got = value(`${a}-${b}-${c}`);
        assert.equal(got, left, `${a}-${b}-${c}`);
        if (left != right) assert.notEqual(got, right, `${a}-${b}-${c}`);
      }
    }
  }
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let c = 1; c <= 6; c++) {
        const src = `${a}/${b}/${c}`;
        assert.equal(value(src), a / b / c, src);
      }
    }
  }
  assert.equal(value("2+3*4"), 14);
  assert.equal(value("(2+3)*4"), 20);
  assert.equal(value("m*x + b", { m: 2, x: 3, b: -1 }), 5);
});

test("parenthesized expressions match JavaScript operators", () => {
  const rng = mulberry32(SEED);
  for (let i = 0; i < 40; i++) {
    const tree = gen(rng, 3);
    const src = source(tree);
    const got = value(src, ENV);
    const want = fold(tree, ENV);
    assert.ok(Number.isFinite(got), src);
    assert.ok(Object.is(got, want), `${src} => ${got}, operators give ${want}`);
  }
});

test("freeVariables skips pi and e", () => {
  assert.deepEqual([...freeVariables(parsedExpr("pi + e"))].sort(), []);
  assert.deepEqual([...freeVariables(parsedExpr("pi + x + e"))].sort(), ["x"]);
  const rng = mulberry32(SEED + 1);
  for (let i = 0; i < 40; i++) {
    const tree = gen(rng, 3);
    const names = new Set<string>();
    const walk = (node: Tree): void => {
      switch (node.kind) {
        case "num":
          return;
        case "var":
          if (node.name !== "pi" && node.name !== "e") names.add(node.name);
          return;
        case "neg":
        case "call":
          walk(node.arg);
          return;
        case "bin":
          walk(node.left);
          walk(node.right);
          return;
      }
    };
    walk(tree);
    assert.deepEqual([...freeVariables(parsedExpr(source(tree)))].sort(), [...names].sort(), source(tree));
  }
});

test("parseExpr returns a result instead of throwing", () => {
  const samples = ["", "2 +", "foo(1)", "1 & 2", "((", "^", "sin(", "1+"];
  for (const src of samples) {
    const parsed = parseExpr(src);
    assert.equal(parsed.ok, false, src);
    if (!parsed.ok) assert.equal(typeof parsed.error, "string");
  }
  const rng = mulberry32(SEED + 2);
  const alphabet = "0123456789.+-*/^() abcxyz&";
  for (let i = 0; i < 30; i++) {
    const length = integer(rng, 0, 12);
    let src = "";
    for (let j = 0; j < length; j++) src += alphabet[integer(rng, 0, alphabet.length - 1)];
    assert.doesNotThrow(() => parseExpr(src), src);
  }
});

test("each supported function matches the JavaScript Math function of the same name", () => {
  const cases = [
    ["sin(0)", Math.sin(0)],
    ["sin(1)", Math.sin(1)],
    ["cos(0)", Math.cos(0)],
    ["cos(1)", Math.cos(1)],
    ["tan(0)", Math.tan(0)],
    ["tan(0.5)", Math.tan(0.5)],
    ["sqrt(0)", Math.sqrt(0)],
    ["sqrt(4)", Math.sqrt(4)],
    ["abs(-3)", Math.abs(-3)],
    ["abs(3)", Math.abs(3)],
    ["exp(0)", Math.exp(0)],
    ["exp(1)", Math.exp(1)],
    ["ln(1)", Math.log(1)],
    ["ln(e)", Math.log(Math.E)],
    ["log10(1)", Math.log10(1)],
    ["log10(10)", Math.log10(10)],
    ["floor(1.9)", Math.floor(1.9)],
    ["round(1.2)", Math.round(1.2)],
    ["round(1.5)", Math.round(1.5)],
  ];
  for (const [src, want] of cases) {
    assert.ok(Object.is(value(src), want), src);
  }
});

test("division by zero is not a finite answer", () => {
  assert.equal(Number.isFinite(value("1/0")), false);
  assert.equal(Number.isFinite(value("0/0")), false);
});

test("evaluate throws when a variable is unbound", () => {
  assert.throws(() => evaluate(parsedExpr("y"), {}));
});
