import { describe, expect, it } from "vitest";
import {
  addComponent,
  addPoint,
  graphLimitIssues,
  removeComponent,
  removePoint,
  setAxis,
  setField,
  setGround,
  setPoint,
} from "../web/src/edit";
import { GRAPHS } from "./fixtures/graphs";
import { LIMITS } from "../src/shared/limits";
import { validate } from "../src/core/validate";
import { circuit, resistor, vsource } from "./helpers";
import type { Circuit, Graph } from "../src/core/schema";

// The c01 replay reading: R2 printed as "2 kΩ" but read as 200.
function c01Reading(): Circuit {
  return circuit([
    { ...vsource("V1", 12, "A", "gnd"), label: "12 V" },
    { ...resistor("R1", 1000, "A", "B"), label: "1 kΩ" },
    { ...resistor("R2", 200, "B", "gnd"), label: "2 kΩ", uncertain: "digit unclear" },
  ]);
}

const copy = <T,>(x: T): T => structuredClone(x);

describe("setField", () => {
  it("fixes R2 with 2k and clears the warning", () => {
    const c = c01Reading();
    expect(validate(c).some((w) => w.componentId === "R2")).toBe(true);
    const next = setField(c, "R2", "value", "2k");
    const r2 = next.components.find((k) => k.id === "R2");
    expect(r2?.value).toBe(2000);
    expect(r2?.label).toBe("2 kΩ");
    expect(r2?.uncertain).toBeNull();
    expect(validate(next)).toEqual([]);
  });

  it("returns the circuit unchanged for unparsable text", () => {
    const c = c01Reading();
    expect(setField(c, "R2", "value", "abc")).toBe(c);
  });

  it("re-formats the label when the type changes", () => {
    const c = circuit([resistor("R1", 12, "A", "gnd")]);
    const next = setField(c, "R1", "type", "voltage_source");
    expect(next.components[0]).toMatchObject({ type: "voltage_source", label: "12 V" });
  });

  it("trims node names and ignores empty ones", () => {
    const c = c01Reading();
    expect(setField(c, "R1", "b", "  N2 ").components[1]?.b).toBe("N2");
    expect(setField(c, "R1", "a", "   ")).toBe(c);
  });

  it("sets the label text", () => {
    expect(setField(c01Reading(), "R1", "label", "1k").components[1]?.label).toBe("1k");
  });
});

describe("structure edits", () => {
  it("addComponent twice gives unused, distinct ids", () => {
    const c = circuit([resistor("R1", 1, "A", "gnd"), resistor("R3", 1, "A", "gnd")]);
    const next = addComponent(addComponent(c));
    const ids = next.components.map((k) => k.id);
    expect(ids).toEqual(["R1", "R3", "R2", "R4"]);
    expect(next.components[2]).toMatchObject({ value: 1000, a: "gnd", b: "gnd", pa: null, pb: null });
  });

  it("removeComponent removes exactly one", () => {
    const next = removeComponent(c01Reading(), "R1");
    expect(next.components.map((k) => k.id)).toEqual(["V1", "R2"]);
  });

  it("setGround changes ground", () => {
    expect(setGround(c01Reading(), "B").ground).toBe("B");
  });

  it("no function mutates its input", () => {
    const c = c01Reading();
    const before = copy(c);
    setField(c, "R2", "value", "2k");
    setField(c, "R2", "type", "current_source");
    setField(c, "R2", "a", "X");
    addComponent(c);
    removeComponent(c, "R1");
    setGround(c, "B");
    expect(c).toEqual(before);
  });
});

describe("graph edits", () => {
  const g01 = (): Graph => structuredClone(GRAPHS["g01"] as Graph);
  const xs = (g: Graph): number[] => (g.series[0]?.points ?? []).map((p) => p.x);

  it("setPoint changes a value and re-sorts by x", () => {
    const g = g01();
    expect(setPoint(g, "s1", 1, "y", "5").series[0]?.points[1]).toEqual({ x: 2, y: 5 });
    const moved = setPoint(g, "s1", 1, "x", "9");
    expect(xs(moved)).toEqual([0, 5, 8, 9, 10]);
    expect(moved.series[0]?.points[3]).toEqual({ x: 9, y: 4 });
  });

  it("setPoint ignores bad text, unknown series, bad index and unchanged values", () => {
    const g = g01();
    expect(setPoint(g, "s1", 1, "y", "abc")).toBe(g);
    expect(setPoint(g, "s1", 1, "y", " ")).toBe(g);
    expect(setPoint(g, "nope", 1, "y", "3")).toBe(g);
    expect(setPoint(g, "s1", 9, "y", "3")).toBe(g);
    expect(setPoint(g, "s1", 1, "y", "4")).toBe(g);
  });

  it("addPoint appends after the last x, and stops at the point limit", () => {
    const added = addPoint(g01(), "s1");
    expect(added.series[0]?.points).toHaveLength(6);
    expect(added.series[0]?.points[5]).toEqual({ x: 11, y: 16 });
    const full = g01();
    const s = full.series[0];
    if (s) s.points = Array.from({ length: LIMITS.maxPoints }, (_, i) => ({ x: i, y: 0 }));
    expect(addPoint(full, "s1")).toBe(full);
    expect(graphLimitIssues(full)).toEqual([]);
    if (s) s.points.push({ x: LIMITS.maxPoints, y: 0 });
    expect(graphLimitIssues(full)).toHaveLength(1);
  });

  it("graphLimitIssues blocks a reading with more series than the server accepts", () => {
    const g = g01();
    const first = g.series[0];
    if (first) g.series = Array.from({ length: LIMITS.maxSeries + 1 }, (_, i) => ({ ...first, id: `s${i + 1}` }));
    expect(graphLimitIssues(g).some((m) => m.includes(`${LIMITS.maxSeries + 1} series`))).toBe(true);
  });

  it("removePoint removes exactly one point", () => {
    expect(xs(removePoint(g01(), "s1", 2))).toEqual([0, 2, 8, 10]);
  });

  it("setAxis sets label, unit, min and max", () => {
    const g = g01();
    expect(setAxis(g, "x", "label", "elapsed").x.label).toBe("elapsed");
    expect(setAxis(g, "y", "unit", " km ").y.unit).toBe("km");
    expect(setAxis(g, "y", "unit", "  ").y.unit).toBeNull();
    expect(setAxis(g, "y", "max", "25").y.max).toBe(25);
    expect(setAxis(g, "x", "min", "-1").x.min).toBe(-1);
  });

  it("setAxis rejects bad numbers and text over the field limit", () => {
    const g = g01();
    expect(setAxis(g, "x", "max", "abc")).toBe(g);
    expect(setAxis(g, "x", "min", "")).toBe(g);
    expect(setAxis(g, "x", "label", "a".repeat(LIMITS.maxFieldChars + 1))).toBe(g);
    expect(setAxis(g, "x", "label", "a".repeat(LIMITS.maxFieldChars)).x.label).toHaveLength(LIMITS.maxFieldChars);
  });

  it("no graph function mutates its input", () => {
    const g = g01();
    const before = copy(g);
    setPoint(g, "s1", 1, "x", "9");
    addPoint(g, "s1");
    removePoint(g, "s1", 0);
    setAxis(g, "x", "label", "z");
    setAxis(g, "y", "max", "99");
    expect(g).toEqual(before);
  });
});
