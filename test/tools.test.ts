import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_SPECS, createToolRunner } from "../src/core/tools";
import { CIRCUITS } from "./fixtures/circuits";

function circuitOf(id: string) {
  const c = CIRCUITS[id];
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

const noChanges = { changes: [] };

function volt(out: ReturnType<ReturnType<typeof createToolRunner>["run"]>, node: string): number {
  if (!out.ok) throw new Error(out.error);
  const v = z.record(z.string(), z.number()).parse(out["nodeVoltages"]);
  const x = v[node];
  if (x === undefined) throw new Error("no node");
  return x;
}

describe("solve_circuit", () => {
  it("solves c01 with no changes", () => {
    const r = createToolRunner(circuitOf("c01"));
    expect(volt(r.run("solve_circuit", noChanges), "B")).toBeCloseTo(8, 9);
  });

  it("applies changes per call without altering the approved circuit", () => {
    const r = createToolRunner(circuitOf("c14"));
    const change = { op: "set_value", id: "R3", type: null, value: 800, a: null, b: null };
    const out = r.run("solve_circuit", { changes: [change] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const comps = z.record(z.string(), z.object({ current: z.number() })).parse(out["components"]);
      expect(comps["R1"]?.current).toBeCloseTo(0.009, 9);
    }
    const again = r.run("solve_circuit", noChanges);
    if (again.ok) {
      const comps = z.record(z.string(), z.object({ current: z.number() })).parse(again["components"]);
      expect(comps["R1"]?.current).not.toBeCloseTo(0.009, 6);
    } else {
      expect(again.ok).toBe(true);
    }
  });

  it("fails on an unknown id", () => {
    const r = createToolRunner(circuitOf("c01"));
    const change = { op: "remove", id: "R9", type: null, value: null, a: null, b: null };
    expect(r.run("solve_circuit", { changes: [change] }).ok).toBe(false);
  });
});

describe("evaluate", () => {
  const r = createToolRunner(circuitOf("c01"));
  it("computes numbers", () => {
    const a = r.run("evaluate", { expression: "12 * 2000 / (1000 + 2000)" });
    const b = r.run("evaluate", { expression: "sqrt(16) + 2^3" });
    expect(a).toEqual({ ok: true, value: 8 });
    expect(b).toEqual({ ok: true, value: 12 });
  });
  it.each([
    "1/0",
    "[1,2,3]",
    "import({})",
    'createUnit("foo")',
    'evaluate("1+1")',
    "2 km",
    "1".repeat(201),
    "x + 1",
  ])("rejects %s", (expression) => {
    expect(r.run("evaluate", { expression }).ok).toBe(false);
  });

  // From the security review: each of these changed shared state, crashed the process, hung it,
  // or returned a number through units. Each must be rejected before it runs.
  it.each([
    'config({number:"BigNumber"})',
    "config({relTol:0.5,absTol:0.5})",
    "sum(ones(1e9))",
    "size(zeros(1e9,0))[1]",
    "det(random([2000,2000]))",
    "number(fraction(3)^1e9)",
    "f(x)=x>0?f(x-1)+f(x-1):1; f(40)",
    "number(5 km, m)",
    'unit("5 cm").toNumber("m")',
    "5 cm / 1 m",
    "random()",
    "cos.constructor",
    "x = 5",
    "1 > 0 ? 1 : 0",
    // From the final check: "%" parses exponentially and "x + y%" compiles a shared subtree.
    "1%(".repeat(49) + "1" + ")".repeat(49),
    "(".repeat(20) + "1" + "+1%)".repeat(20),
    "50%",
  ])("rejects %s before running it", (expression) => {
    const t0 = Date.now();
    expect(r.run("evaluate", { expression }).ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("still computes after an attempt to change the configuration", () => {
    const other = createToolRunner(circuitOf("c01"));
    other.run("evaluate", { expression: 'config({number:"BigNumber"})' });
    expect(r.run("evaluate", { expression: "12 * 2000 / (1000 + 2000)" })).toEqual({ ok: true, value: 8 });
  });

  it.each([
    ["2 pi", 2 * Math.PI],
    ["-2^0.5", -Math.SQRT2],
    ["10 mod 3", 1],
    ["max(1, 4, 2) + abs(-3)", 7],
    ["log(e)", 1],
    ["1 / (1/1000 + 1/2000)", 2000 / 3],
  ])("allows %s", (expression, expected) => {
    const out = r.run("evaluate", { expression });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toBeCloseTo(expected, 12);
  });
});

describe("submit_answer", () => {
  const setup = { remove: [], zero: [] };
  it("stores a valid claim", () => {
    const r = createToolRunner(circuitOf("c01"));
    const claim = { kind: "node_voltage", node: "B", setup, value: 8 };
    expect(r.run("submit_answer", { claim, explanation: "divider" })).toEqual({ ok: true });
    expect(r.claim()?.claim).toEqual(claim);
    expect(r.claim()?.explanation).toBe("divider");
  });
  it("rejects a missing node and keeps no claim", () => {
    const r = createToolRunner(circuitOf("c01"));
    const claim = { kind: "node_voltage", node: "Z", setup, value: 8 };
    expect(r.run("submit_answer", { claim, explanation: "x" }).ok).toBe(false);
    expect(r.claim()).toBeNull();
  });
  it("replaces an earlier claim", () => {
    const r = createToolRunner(circuitOf("c01"));
    r.run("submit_answer", { claim: { kind: "node_voltage", node: "B", setup, value: 1 }, explanation: "a" });
    r.run("submit_answer", { claim: { kind: "node_voltage", node: "A", setup, value: 12 }, explanation: "b" });
    expect(r.claim()?.explanation).toBe("b");
  });
});

describe("run", () => {
  it("never throws on bad calls", () => {
    const r = createToolRunner(circuitOf("c01"));
    expect(r.run("nope", {}).ok).toBe(false);
    expect(r.run("solve_circuit", { changes: "x" }).ok).toBe(false);
    expect(r.run("graph_query", { op: "value", series: "s1", x1: 1, x2: null, which: null }).ok).toBe(false);
  });
});

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
  } else if (node !== null && typeof node === "object") {
    const obj = z.record(z.string(), z.unknown()).parse(node);
    visit(obj);
    for (const v of Object.values(obj)) walk(v, visit);
  }
}

describe("TOOL_SPECS", () => {
  it("has four tools", () => {
    expect(TOOL_SPECS.map((s) => s.name)).toEqual(["solve_circuit", "evaluate", "graph_query", "submit_answer"]);
  });
  it.each(TOOL_SPECS.map((s) => [s.name, s] as const))("%s has a strict JSON schema", (_name, spec) => {
    const schema = z.toJSONSchema(spec.input);
    let objects = 0;
    walk(schema, (obj) => {
      const props = obj["properties"];
      if (obj["type"] === "object" && props !== undefined) {
        objects += 1;
        expect(obj["additionalProperties"]).toBe(false);
        expect([...z.array(z.string()).parse(obj["required"] ?? [])].sort()).toEqual(Object.keys(z.record(z.string(), z.unknown()).parse(props)).sort());
      }
    });
    expect(objects).toBeGreaterThan(0);
  });
});
