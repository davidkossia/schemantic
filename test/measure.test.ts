import { describe, expect, it } from "vitest";
import { certified, certify, measure } from "../src/core/measure";
import { solveCircuit } from "../src/core/mna";
import type { Circuit, Graph, Measurement, MeasureError, Query, Result, Solution } from "../src/core/schema";
import { closeTo } from "../src/core/units";
import { circuit, NO_SETUP, resistor, vsource } from "./helpers";
import { CIRCUITS } from "./fixtures/circuits";

function fx(id: string): Circuit {
  const c = CIRCUITS[id];
  if (c === undefined) throw new Error(`no fixture ${id}`);
  return c;
}

function solved(c: Circuit): Solution {
  const r = solveCircuit(c);
  if (!r.ok) throw new Error(`solve failed: ${r.error.code}`);
  return r.value;
}

function values(r: Result<Measurement, MeasureError>): Record<string, number> {
  if (!r.ok) throw new Error(`measure failed: ${r.error.code}`);
  return Object.fromEntries(r.value.values.map((v) => [v.name, v.value]));
}

function errorCode(r: Result<Measurement, MeasureError>): string {
  if (r.ok) throw new Error("expected an error");
  return r.error.code;
}

function expectClose(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(closeTo(actual ?? Number.NaN, expected)).toBe(true);
}

const worked = circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "B"), resistor("R2", 2000, "B", "gnd")]);

describe("certify", () => {
  it("gives residuals below 1e-12 on the worked example", () => {
    const s = solved(worked);
    const r = certify(worked, s);
    expect(r.kclMax).toBeLessThan(1e-12);
    expect(r.sourceMax).toBeLessThan(1e-12);
    expect(r.powerBalance).toBeLessThan(1e-12);
    expect(certified(r, s)).toBe(true);
  });

  describe("rejects corrupted solutions of c06", () => {
    const c = fx("c06");

    it("accepts the uncorrupted solution", () => {
      const s = solved(c);
      expect(certified(certify(c, s), s)).toBe(true);
    });

    it("rejects V(B) + 0.1", () => {
      const s = solved(c);
      const bad: Solution = { ...s, nodeVoltages: { ...s.nodeVoltages, B: (s.nodeVoltages["B"] ?? 0) + 0.1 } };
      expect(certified(certify(c, bad), bad)).toBe(false);
    });

    it("rejects a flipped V1 current", () => {
      const s = solved(c);
      const v1 = s.components["V1"];
      if (v1 === undefined) throw new Error("no V1");
      const bad: Solution = { ...s, components: { ...s.components, V1: { ...v1, current: -v1.current } } };
      expect(certified(certify(c, bad), bad)).toBe(false);
    });

    it("rejects V(A) = 9", () => {
      const s = solved(c);
      const bad: Solution = { ...s, nodeVoltages: { ...s.nodeVoltages, A: 9 } };
      expect(certified(certify(c, bad), bad)).toBe(false);
    });
  });
});

describe("measure on the problem set", () => {
  const cases: { id: string; query: Query; expected: Record<string, number> }[] = [
    { id: "c01", query: { kind: "node_voltage", node: "B", setup: NO_SETUP }, expected: { value: 8 } },
    { id: "c02", query: { kind: "branch_current", component: "R2", setup: NO_SETUP }, expected: { value: 0.02 } },
    {
      id: "c03",
      query: { kind: "power", component: "R2", sense: "absorbed", setup: NO_SETUP },
      expected: { value: 0.25 },
    },
    { id: "c04", query: { kind: "node_voltage", node: "A", setup: NO_SETUP }, expected: { value: 1.5 } },
    { id: "c05", query: { kind: "node_voltage", node: "C", setup: NO_SETUP }, expected: { value: 4 } },
    { id: "c06", query: { kind: "branch_current", component: "R5", setup: NO_SETUP }, expected: { value: 1 / 700 } },
    { id: "c07", query: { kind: "node_voltage", node: "B", setup: NO_SETUP }, expected: { value: 9 } },
    {
      id: "c08",
      query: { kind: "power", component: "V1", sense: "delivered", setup: NO_SETUP },
      expected: { value: 4 / 75 },
    },
    {
      id: "c09",
      query: { kind: "thevenin", a: "C", b: "gnd", remove: ["RL"] },
      expected: { vth: 9, rth: 4000 },
    },
    { id: "c10", query: { kind: "max_power_transfer", load: "RL" }, expected: { resistance: 2000, power: 1 / 180 } },
    {
      id: "c12",
      query: { kind: "node_voltage", node: "B", setup: { remove: [], zero: ["V1"] } },
      expected: { value: 4 },
    },
    {
      id: "c13",
      query: { kind: "equivalent_resistance", a: "A", b: "gnd", remove: ["V1"] },
      expected: { value: 4000 },
    },
  ];

  for (const { id, query, expected } of cases) {
    it(`${id} ${query.kind}`, () => {
      const r = measure(fx(id), query);
      const got = values(r);
      expect(Object.keys(got)).toEqual(Object.keys(expected));
      for (const [name, value] of Object.entries(expected)) expectClose(got[name], value);
      if (!r.ok) throw new Error("unreachable");
      const res = r.value.residuals;
      expect(res).not.toBeNull();
      expect(res?.kclMax ?? 1).toBeLessThan(1e-9);
    });
  }

  it("gives units from the claim table", () => {
    const r = measure(fx("c10"), { kind: "max_power_transfer", load: "RL" });
    if (!r.ok) throw new Error(r.error.code);
    expect(r.value.values.map((v) => v.unit)).toEqual(["ohm", "W"]);
    const t = measure(fx("c09"), { kind: "thevenin", a: "C", b: "gnd", remove: ["RL"] });
    if (!t.ok) throw new Error(t.error.code);
    expect(t.value.values.map((v) => v.unit)).toEqual(["V", "ohm"]);
  });

  it("c08 absorbed power of V1 is -4/75", () => {
    const got = values(measure(fx("c08"), { kind: "power", component: "V1", sense: "absorbed", setup: NO_SETUP }));
    expectClose(got["value"], -4 / 75);
  });

  it("c12 extra reference values: 12 V from V1 alone, 16 V in total", () => {
    const alone = values(measure(fx("c12"), { kind: "node_voltage", node: "B", setup: { remove: ["I1"], zero: [] } }));
    expectClose(alone["value"], 12);
    const total = values(measure(fx("c12"), { kind: "node_voltage", node: "B", setup: NO_SETUP }));
    expectClose(total["value"], 16);
  });
});

describe("measure errors", () => {
  it("c11 design query is not_measurable", () => {
    const r = measure(fx("c11"), {
      kind: "component_value_for_condition",
      component: "R2",
      condition: { kind: "node_voltage", target: "B", value: 9 },
    });
    expect(errorCode(r)).toBe("not_measurable");
  });

  it("an unknown node is unknown_id", () => {
    expect(errorCode(measure(fx("c01"), { kind: "node_voltage", node: "Z", setup: NO_SETUP }))).toBe("unknown_id");
  });

  it("an unknown component, or one removed by the setup, is unknown_id", () => {
    expect(errorCode(measure(fx("c01"), { kind: "branch_current", component: "R9", setup: NO_SETUP }))).toBe(
      "unknown_id",
    );
    expect(
      errorCode(measure(fx("c07"), { kind: "branch_current", component: "I1", setup: { remove: ["I1"], zero: [] } })),
    ).toBe("unknown_id");
  });

  it("equivalent_resistance with a === b is unknown_id", () => {
    expect(errorCode(measure(fx("c13"), { kind: "equivalent_resistance", a: "A", b: "A", remove: [] }))).toBe(
      "unknown_id",
    );
  });

  it("max_power_transfer with zero rth is singular", () => {
    const c = circuit([vsource("V1", 5, "A", "gnd"), resistor("RL", 100, "A", "gnd")]);
    expect(errorCode(measure(c, { kind: "max_power_transfer", load: "RL" }))).toBe("singular");
  });

  it("a graph query on a circuit is wrong_structure", () => {
    expect(errorCode(measure(fx("c01"), { kind: "graph_value", series: "s1", x: 1 }))).toBe("wrong_structure");
  });

  it("a circuit query on a graph is wrong_structure", () => {
    const g: Graph = {
      kind: "graph",
      title: null,
      x: { label: "t", unit: null, min: 0, max: 1 },
      y: { label: "v", unit: null, min: 0, max: 1 },
      series: [],
      asked: { summary: "", target: null },
      notes: null,
    };
    expect(errorCode(measure(g, { kind: "node_voltage", node: "A", setup: NO_SETUP }))).toBe("wrong_structure");
  });
});
