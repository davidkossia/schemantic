import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Claim, Circuit, Query, Structure, claimedValues, queryOf } from "../src/core/schema";
import { NO_SETUP, circuit, resistor, vsource } from "./helpers";

const graph = {
  kind: "graph" as const,
  title: null,
  x: { label: "t", unit: "s", min: 0, max: 1 },
  y: { label: "v", unit: "V", min: 0, max: 5 },
  series: [{ id: "s1", name: "v(t)", kind: "line" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 5 }] }],
  asked: { summary: "", target: null },
  notes: null,
};

const CLAIMS: Claim[] = [
  { kind: "node_voltage", node: "B", setup: NO_SETUP, value: 8 },
  { kind: "branch_current", component: "R1", setup: NO_SETUP, value: 0.004 },
  { kind: "power", component: "R1", sense: "absorbed", setup: NO_SETUP, value: 0.016 },
  { kind: "equivalent_resistance", a: "A", b: "gnd", remove: [], value: 3000 },
  { kind: "thevenin", a: "B", b: "gnd", remove: [], vth: 8, rth: 1000 },
  { kind: "max_power_transfer", load: "RL", resistance: 1000, power: 0.004 },
  {
    kind: "component_value_for_condition",
    component: "R2",
    condition: { kind: "node_voltage", target: "B", value: 8 },
    value: 2000,
  },
  { kind: "graph_value", series: "s1", x: 0.5, value: 2.5 },
  { kind: "graph_slope", series: "s1", x1: 0, x2: 1, value: 5 },
  { kind: "graph_area", series: "s1", x1: 0, x2: 1, value: 2.5 },
  { kind: "graph_extremum", series: "s1", which: "max", x: 1, value: 5 },
];

describe("schemas", () => {
  it("Circuit.parse accepts a circuit built with the helpers", () => {
    const c = circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "B")]);
    expect(Circuit.parse(c).components).toHaveLength(2);
  });

  it("Circuit.safeParse rejects a capacitor and a component missing pa", () => {
    const capacitor: unknown = { ...circuit([resistor("C1", 1e-6, "A", "gnd")]), components: [{ ...resistor("C1", 1e-6, "A", "gnd"), type: "capacitor" }] };
    expect(Circuit.safeParse(capacitor).success).toBe(false);

    const { pa: _pa, ...noPa } = resistor("R1", 1000, "A", "B");
    const missingPa: unknown = { ...circuit([resistor("R1", 1000, "A", "B")]), components: [noPa] };
    expect(Circuit.safeParse(missingPa).success).toBe(false);
  });

  it("Structure.parse picks the right variant for a circuit and for a graph", () => {
    const c = Structure.parse(circuit([resistor("R1", 1000, "A", "gnd")]));
    expect(c.kind).toBe("circuit");
    const g = Structure.parse(graph);
    expect(g.kind).toBe("graph");
  });

  it("Claim.parse accepts one valid claim of each of the 11 kinds", () => {
    expect(CLAIMS).toHaveLength(11);
    for (const claim of CLAIMS) {
      expect(Claim.parse(claim).kind).toBe(claim.kind);
    }
  });

  it("Claim.safeParse rejects a thevenin claim without rth", () => {
    const { rth: _rth, ...noRth } = { kind: "thevenin" as const, a: "B", b: "gnd", remove: [], vth: 8, rth: 1000 };
    expect(Claim.safeParse(noRth).success).toBe(false);
  });

  it("queryOf on a thevenin claim drops vth and rth and Query.parse accepts it", () => {
    const q = queryOf(CLAIMS[4] as Claim);
    expect(q).not.toHaveProperty("vth");
    expect(q).not.toHaveProperty("rth");
    expect(Query.parse(q)).toEqual({ kind: "thevenin", a: "B", b: "gnd", remove: [] });
  });

  it("queryOf output parses as a Query for every claim kind", () => {
    for (const claim of CLAIMS) {
      expect(() => Query.parse(queryOf(claim))).not.toThrow();
    }
  });

  it("claimedValues lists thevenin and graph_extremum fields in table order", () => {
    expect(claimedValues(CLAIMS[4] as Claim)).toEqual([
      { name: "vth", value: 8 },
      { name: "rth", value: 1000 },
    ]);
    expect(claimedValues(CLAIMS[10] as Claim)).toEqual([
      { name: "x", value: 1 },
      { name: "value", value: 5 },
    ]);
  });

  it("z.toJSONSchema runs on Structure and Claim", () => {
    expect(() => z.toJSONSchema(Structure)).not.toThrow();
    expect(() => z.toJSONSchema(Claim)).not.toThrow();
  });
});
