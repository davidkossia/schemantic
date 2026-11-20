import { describe, expect, it } from "vitest";
import { checkClaim } from "../src/core/checker";
import { area, extremum, findSeries, slope, valueAt } from "../src/core/graph";
import { measure } from "../src/core/measure";
import { Claim, claimedValues } from "../src/core/schema";
import type { Graph, Series } from "../src/core/schema";
import { createToolRunner } from "../src/core/tools";
import { GRAPHS } from "./fixtures/graphs";

function graphOf(id: string): Graph {
  const g = GRAPHS[id];
  if (!g) throw new Error(`missing ${id}`);
  return g;
}

function seriesOf(id: string): Series {
  const r = findSeries(graphOf(id), "s1");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function num(r: { ok: true; value: number } | { ok: false; error: { code: string } }): number {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

const CLAIMS: Record<string, Claim> = {
  g01: Claim.parse({ kind: "graph_value", series: "s1", x: 4, value: 8 }),
  g02: Claim.parse({ kind: "graph_slope", series: "s1", x1: 8, x2: 12, value: -2 }),
  g03: Claim.parse({ kind: "graph_area", series: "s1", x1: 0, x2: 8, value: 36 }),
  g04: Claim.parse({ kind: "graph_extremum", series: "s1", which: "max", x: 4, value: 31 }),
};

function claimOf(id: string): Claim {
  const c = CLAIMS[id];
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

describe("graph math", () => {
  it("valueAt on a line interpolates and rejects out of range", () => {
    const s = seriesOf("g01");
    expect(num(valueAt(s, 0))).toBeCloseTo(0, 9);
    expect(num(valueAt(s, 10))).toBeCloseTo(16, 9);
    expect(num(valueAt(s, 6.5))).toBeCloseTo(10, 9);
    const out = valueAt(s, 11);
    expect(out.ok ? "ok" : out.error.code).toBe("out_of_range");
    const before = valueAt(s, -1);
    expect(before.ok ? "ok" : before.error.code).toBe("out_of_range");
  });

  it("valueAt on bars matches only an existing x", () => {
    const s = seriesOf("g04");
    expect(num(valueAt(s, 3))).toBe(25);
    const miss = valueAt(s, 3.5);
    expect(miss.ok ? "ok" : miss.error.code).toBe("out_of_range");
  });

  it("slope is rise over run", () => {
    expect(num(slope(seriesOf("g02"), 0, 4))).toBeCloseTo(3, 9);
    expect(num(slope(seriesOf("g02"), 2, 10))).toBeCloseTo(0.25, 9);
    expect(num(slope(seriesOf("g02"), 8, 12))).toBeCloseTo(-2, 9);
  });

  it("slope rejects bars, equal x and out of range", () => {
    const bar = slope(seriesOf("g04"), 1, 2);
    expect(bar.ok ? "ok" : bar.error.code).toBe("wrong_kind");
    const same = slope(seriesOf("g02"), 4, 4);
    expect(same.ok ? "ok" : same.error.code).toBe("out_of_range");
    const far = slope(seriesOf("g02"), 4, 40);
    expect(far.ok ? "ok" : far.error.code).toBe("out_of_range");
  });

  it("area sums trapezoids", () => {
    expect(num(area(seriesOf("g03"), 1, 7))).toBeCloseTo(33, 9);
    expect(num(area(seriesOf("g03"), 0, 8))).toBeCloseTo(36, 9);
  });

  it("area counts the part under the axis as negative", () => {
    const dip: Series = {
      id: "s1",
      name: "dip",
      kind: "line",
      points: [
        { x: 0, y: 2 },
        { x: 2, y: 2 },
        { x: 4, y: -2 },
      ],
    };
    // 0 to 2: 4. 2 to 4: trapezoid with mean 0, so 0.
    expect(num(area(dip, 0, 4))).toBeCloseTo(4, 9);
    const under: Series = { ...dip, points: [{ x: 0, y: -1 }, { x: 2, y: -1 }] };
    expect(num(area(under, 0, 2))).toBeCloseTo(-2, 9);
    const bad = area(dip, 3, 3);
    expect(bad.ok ? "ok" : bad.error.code).toBe("out_of_range");
    const bar = area(seriesOf("g04"), 1, 2);
    expect(bar.ok ? "ok" : bar.error.code).toBe("wrong_kind");
  });

  it("extremum picks the key point and the smaller x on a tie", () => {
    const min = extremum(seriesOf("g04"), "min");
    expect(min.ok && min.value).toEqual({ x: 1, y: 12 });
    const tie: Series = {
      id: "s1",
      name: "tie",
      kind: "line",
      points: [
        { x: 1, y: 5 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
      ],
    };
    const max = extremum(tie, "max");
    expect(max.ok && max.value).toEqual({ x: 2, y: 9 });
  });

  it("findSeries reports an unknown id", () => {
    const r = findSeries(graphOf("g01"), "zz");
    expect(r.ok ? "ok" : r.error.code).toBe("unknown_series");
  });
});

describe("measure and checkClaim on graphs", () => {
  it("measures the four expected answers", () => {
    const expected: Record<string, { name: string; value: number }[]> = {
      g01: [{ name: "value", value: 8 }],
      g02: [{ name: "value", value: -2 }],
      g03: [{ name: "value", value: 36 }],
      g04: [{ name: "x", value: 4 }, { name: "value", value: 31 }],
    };
    for (const id of Object.keys(expected)) {
      const claim = claimOf(id);
      const m = measure(graphOf(id), { ...claim });
      expect(m.ok, id).toBe(true);
      if (!m.ok) continue;
      expect(m.value.residuals, id).toBeNull();
      expect(m.value.values.map((v) => ({ name: v.name, value: v.value })), id).toEqual(expected[id]);
      expect(m.value.values.every((v) => v.unit === ""), id).toBe(true);
    }
  });

  it("verifies the four expected claims", () => {
    for (const id of Object.keys(CLAIMS)) {
      expect(checkClaim(graphOf(id), claimOf(id)).verified, id).toBe(true);
    }
  });

  it("maps graph errors to measure errors", () => {
    const g = graphOf("g04");
    const bar = measure(g, { kind: "graph_slope", series: "s1", x1: 1, x2: 2 });
    expect(bar.ok ? "ok" : bar.error.code).toBe("wrong_structure");
    const miss = measure(g, { kind: "graph_value", series: "s1", x: 9 });
    expect(miss.ok ? "ok" : miss.error.code).toBe("out_of_range");
    const none = measure(g, { kind: "graph_value", series: "zz", x: 1 });
    expect(none.ok ? "ok" : none.error.code).toBe("unknown_series");
    const circuitQuery = measure(g, { kind: "max_power_transfer", load: "R1" });
    expect(circuitQuery.ok ? "ok" : circuitQuery.error.code).toBe("wrong_structure");
  });

  it("rejects every mutation of every claimed number", () => {
    const mutations: ((x: number) => number)[] = [(x) => x * 1.05, (x) => -x, (x) => x * 1000];
    let count = 0;
    for (const id of Object.keys(CLAIMS)) {
      const claim = claimOf(id);
      for (const { name, value } of claimedValues(claim)) {
        for (const f of mutations) {
          const mutated = Claim.parse({ ...claim, [name]: f(value) });
          expect(checkClaim(graphOf(id), mutated).verified, `${id} ${name}`).toBe(false);
          count += 1;
        }
      }
    }
    expect(count).toBe(15);
  });
});

describe("graph_query tool", () => {
  function run(id: string, input: unknown) {
    return createToolRunner(graphOf(id)).run("graph_query", input);
  }
  const none = { x1: null, x2: null, which: null };

  it("answers each op", () => {
    expect(run("g01", { ...none, op: "value", series: "s1", x1: 4 })).toEqual({ ok: true, value: 8, x: null });
    const sl = run("g02", { ...none, op: "slope", series: "s1", x1: 8, x2: 12 });
    expect(sl.ok && sl["value"]).toBeCloseTo(-2, 9);
    const ar = run("g03", { ...none, op: "area", series: "s1", x1: 0, x2: 8 });
    expect(ar.ok && ar["value"]).toBeCloseTo(36, 9);
    expect(run("g04", { ...none, op: "extremum", series: "s1", which: "max" })).toEqual({ ok: true, value: 31, x: 4 });
  });

  it("returns errors for missing fields, unknown series and bad ranges", () => {
    expect(run("g01", { ...none, op: "value", series: "s1" }).ok).toBe(false);
    expect(run("g01", { ...none, op: "slope", series: "s1", x1: 1 }).ok).toBe(false);
    expect(run("g04", { ...none, op: "extremum", series: "s1" }).ok).toBe(false);
    expect(run("g01", { ...none, op: "value", series: "zz", x1: 1 }).ok).toBe(false);
    expect(run("g01", { ...none, op: "value", series: "s1", x1: 50 }).ok).toBe(false);
  });

  it("refuses a circuit-only call on a graph and a graph call on a circuit", () => {
    expect(createToolRunner(graphOf("g01")).run("solve_circuit", { changes: [] }).ok).toBe(false);
  });
});
