import { describe, expect, it } from "vitest";
import { canSolve, validate } from "../src/core/validate";
import type { Graph, Warning } from "../src/core/schema";
import { circuit, isource, resistor, vsource } from "./helpers";
import { CIRCUITS } from "./fixtures/circuits";

const codes = (w: Warning[]): string[] => w.map((x) => x.code);
const base = [vsource("V1", 5, "A", "gnd"), resistor("R1", 1000, "A", "gnd")];

function graph(over: Partial<Graph> = {}): Graph {
  return {
    kind: "graph",
    title: null,
    x: { label: "t", unit: null, min: 0, max: 10 },
    y: { label: "v", unit: null, min: 0, max: 10 },
    series: [{ id: "s1", name: "a", kind: "line", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
    asked: { summary: "", target: null },
    notes: null,
    ...over,
  };
}

describe("validate circuits", () => {
  it("returns only empty for no components", () => {
    const w = validate(circuit([]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: "empty", severity: "error", componentId: null, node: null });
  });

  it("flags duplicate ids once per id", () => {
    const w = validate(circuit([...base, resistor("R1", 5, "A", "gnd"), resistor("R1", 6, "A", "gnd")]));
    const d = w.filter((x) => x.code === "duplicate_id");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: "error", componentId: "R1" });
  });

  it("flags unknown components", () => {
    const u = { ...resistor("X1", 1, "A", "gnd"), type: "unknown" as const };
    const w = validate(circuit([...base, u])).filter((x) => x.code === "unknown_component");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "error", componentId: "X1" });
  });

  it("flags invalid values", () => {
    const w1 = validate(circuit([...base, resistor("R2", 0, "A", "gnd")])).filter((x) => x.code === "invalid_value");
    expect(w1[0]).toMatchObject({ severity: "error", componentId: "R2" });
    const w2 = validate(circuit([...base, vsource("V2", Number.NaN, "A", "gnd")])).filter((x) => x.code === "invalid_value");
    expect(w2[0]).toMatchObject({ severity: "error", componentId: "V2" });
  });

  it("flags a shorted source", () => {
    const w = validate(circuit([...base, vsource("V2", 3, "A", "A")])).filter((x) => x.code === "shorted_source");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "error", componentId: "V2" });
  });

  it("flags no ground and skips disconnected", () => {
    const w = validate(circuit([resistor("R1", 1, "A", "B"), resistor("R2", 1, "B", "A")]));
    const g = w.filter((x) => x.code === "no_ground");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ severity: "error", node: "gnd" });
    expect(codes(w)).not.toContain("disconnected");
  });

  it("flags disconnected nodes once per node", () => {
    const w = validate(circuit([...base, resistor("R2", 1, "X", "Y"), resistor("R3", 1, "X", "Y")]));
    const d = w.filter((x) => x.code === "disconnected");
    expect(d.map((x) => x.node).sort()).toEqual(["X", "Y"]);
    expect(d[0]?.severity).toBe("error");
  });

  it("warns on a dangling node", () => {
    const w = validate(circuit([...base, resistor("R2", 1000, "A", "Z")])).filter((x) => x.code === "dangling_node");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "warning", node: "Z" });
  });

  it("warns on a non-source component with a equal to b", () => {
    const w = validate(circuit([...base, resistor("R2", 1000, "A", "A")])).filter((x) => x.code === "dangling_node");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "warning", componentId: "R2", node: null });
  });

  it("warns on label mismatch", () => {
    const r = { ...resistor("R2", 20000, "A", "gnd"), label: "2 kΩ" };
    const w = validate(circuit([...base, r]));
    const m = w.filter((x) => x.code === "label_mismatch");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ severity: "warning", componentId: "R2" });
  });

  it("gives no warning for a label that is not a number", () => {
    const r = { ...resistor("R2", 1000, "A", "gnd"), label: "RL" };
    expect(validate(circuit([...base, r]))).toEqual([]);
  });

  it("warns on a unit mismatch", () => {
    const r = { ...resistor("R2", 0.01, "A", "gnd"), label: "10 mA" };
    const w = validate(circuit([...base, r]));
    const m = w.filter((x) => x.code === "unit_mismatch");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ severity: "warning", componentId: "R2" });
  });

  it("passes on the reader's note", () => {
    const r = { ...resistor("R2", 1000, "A", "gnd"), uncertain: "digit is smudged" };
    const w = validate(circuit([...base, r])).filter((x) => x.code === "uncertain");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "warning", componentId: "R2", message: "digit is smudged" });
  });

  it("reports singular when the solver fails and no error came first", () => {
    const w = validate(circuit([vsource("V1", 5, "A", "gnd"), vsource("V2", 6, "A", "gnd")]));
    const s = w.filter((x) => x.code === "singular");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ severity: "error", componentId: null, node: null });
  });

  it("does not report singular after another error", () => {
    const w = validate(circuit([vsource("V1", 5, "A", "gnd"), vsource("V2", 6, "A", "gnd"), resistor("R1", 0, "A", "gnd")]));
    expect(codes(w)).not.toContain("singular");
  });

  it("gives no warnings for each fixture", () => {
    for (const [name, c] of Object.entries(CIRCUITS)) {
      expect(validate(c), name).toEqual([]);
    }
    expect(Object.keys(CIRCUITS)).toHaveLength(14);
  });

  it("accepts a current source circuit", () => {
    expect(validate(circuit([isource("I1", 0.001, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]))).toEqual([]);
  });
});

describe("validate graphs", () => {
  it("accepts a good graph", () => {
    expect(validate(graph())).toEqual([]);
  });

  it("flags no series", () => {
    expect(validate(graph({ series: [] }))[0]).toMatchObject({ code: "empty_series", severity: "error" });
  });

  it("flags a line with one point and a bar with none", () => {
    const line = graph({ series: [{ id: "s1", name: "a", kind: "line", points: [{ x: 1, y: 1 }] }] });
    const bar = graph({ series: [{ id: "s1", name: "a", kind: "bar", points: [] }] });
    expect(codes(validate(line))).toEqual(["empty_series"]);
    expect(codes(validate(bar))).toEqual(["empty_series"]);
    const ok = graph({ series: [{ id: "s1", name: "a", kind: "bar", points: [{ x: 1, y: 1 }] }] });
    expect(validate(ok)).toEqual([]);
  });

  it("flags unsorted points", () => {
    const g = graph({ series: [{ id: "s1", name: "a", kind: "line", points: [{ x: 2, y: 1 }, { x: 2, y: 2 }] }] });
    expect(validate(g)[0]).toMatchObject({ code: "unsorted_points", severity: "error" });
  });

  it("flags a bad axis as an error", () => {
    const g = graph({ x: { label: "t", unit: null, min: 5, max: 5 } });
    expect(validate(g)[0]).toMatchObject({ code: "bad_axis", severity: "error" });
    const h = graph({ y: { label: "v", unit: null, min: 0, max: Number.POSITIVE_INFINITY } });
    expect(validate(h)[0]).toMatchObject({ code: "bad_axis", severity: "error" });
  });

  it("warns once per series with a point outside the axes", () => {
    const g = graph({
      series: [
        { id: "s1", name: "a", kind: "line", points: [{ x: 1, y: 1 }, { x: 20, y: 2 }, { x: 30, y: 2 }] },
        { id: "s2", name: "b", kind: "line", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      ],
    });
    const w = validate(g);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: "bad_axis", severity: "warning" });
  });
});

describe("canSolve", () => {
  it("is false with an error and true with only warnings", () => {
    const err: Warning = { code: "empty", severity: "error", message: "", componentId: null, node: null };
    const wrn: Warning = { code: "uncertain", severity: "warning", message: "", componentId: "R1", node: null };
    expect(canSolve([wrn, err])).toBe(false);
    expect(canSolve([wrn])).toBe(true);
  });
});
