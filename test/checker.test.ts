import { describe, expect, it } from "vitest";
import { checkClaim } from "../src/core/checker";
import { Claim } from "../src/core/schema";
import { CIRCUITS } from "./fixtures/circuits";
import { circuit, resistor, vsource } from "./helpers";

const NS = { remove: [], zero: [] };

const EXPECTED: Record<string, unknown> = {
  c01: { kind: "node_voltage", node: "B", setup: NS, value: 8 },
  c02: { kind: "branch_current", component: "R2", setup: NS, value: 0.02 },
  c03: { kind: "power", component: "R2", sense: "absorbed", setup: NS, value: 0.25 },
  c04: { kind: "node_voltage", node: "A", setup: NS, value: 1.5 },
  c05: { kind: "node_voltage", node: "C", setup: NS, value: 4 },
  c06: { kind: "branch_current", component: "R5", setup: NS, value: 1 / 700 },
  c07: { kind: "node_voltage", node: "B", setup: NS, value: 9 },
  c08: { kind: "power", component: "V1", sense: "delivered", setup: NS, value: 4 / 75 },
  c09: { kind: "thevenin", a: "C", b: "gnd", remove: ["RL"], vth: 9, rth: 4000 },
  c10: { kind: "max_power_transfer", load: "RL", resistance: 2000, power: 1 / 180 },
  c11: {
    kind: "component_value_for_condition",
    component: "R2",
    condition: { kind: "node_voltage", target: "B", value: 9 },
    value: 30000,
  },
  c12: { kind: "node_voltage", node: "B", setup: { remove: [], zero: ["V1"] }, value: 4 },
  c13: { kind: "equivalent_resistance", a: "A", b: "gnd", remove: ["V1"], value: 4000 },
  c14: {
    kind: "component_value_for_condition",
    component: "R3",
    condition: { kind: "branch_current", target: "R1", value: 0.009 },
    value: 800,
  },
};

const FIELDS: Record<string, string[]> = {
  thevenin: ["vth", "rth"],
  max_power_transfer: ["resistance", "power"],
};

function fieldsOf(kind: string): string[] {
  return FIELDS[kind] ?? ["value"];
}

function claimFor(id: string): Claim {
  return Claim.parse(EXPECTED[id]);
}

function circuitFor(id: string) {
  const c = CIRCUITS[id];
  if (!c) throw new Error(`no fixture ${id}`);
  return c;
}

function mutate(claim: Claim, field: string, f: (x: number) => number): Claim {
  const raw: Record<string, unknown> = { ...claim };
  const old = raw[field];
  if (typeof old !== "number") throw new Error(`no field ${field}`);
  raw[field] = f(old);
  return Claim.parse(raw);
}

describe("checkClaim", () => {
  it("verifies the 14 expected claims", () => {
    for (const id of Object.keys(EXPECTED)) {
      const report = checkClaim(circuitFor(id), claimFor(id));
      expect(report.verified, id).toBe(true);
      expect(report.items.length, id).toBeGreaterThan(0);
    }
  });

  it("rejects every mutation of every claimed number", () => {
    // The spec lists x1.05, negate and x1000. A fourth mutation (x0.5) makes up for the one case below.
    const mutations: ((x: number) => number)[] = [(x) => x * 1.05, (x) => -x, (x) => x * 1000, (x) => x * 0.5];
    let count = 0;
    for (const id of Object.keys(EXPECTED)) {
      const claim = claimFor(id);
      for (const field of fieldsOf(claim.kind)) {
        for (const f of mutations) {
          // c11 with R2 x1.05 gives 9.087 V, which is within the 1% tolerance of 9 V, so it verifies by contract.
          if (id === "c11" && f(100) === 105) continue;
          const report = checkClaim(circuitFor(id), mutate(claim, field, f));
          expect(report.verified, `${id} ${field}`).toBe(false);
          count += 1;
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(48);
  });

  it("accepts c11 with R2 5% high, because the condition moves under 1%", () => {
    const report = checkClaim(circuitFor("c11"), mutate(claimFor("c11"), "value", (x) => x * 1.05));
    expect(report.items[0]?.measured).toBeCloseTo(9.0865, 3);
    expect(report.verified).toBe(true);
  });

  it("accepts a claim 0.5% off", () => {
    const report = checkClaim(circuitFor("c01"), mutate(claimFor("c01"), "value", (x) => x * 1.005));
    expect(report.verified).toBe(true);
  });

  it("explains a wrong claim", () => {
    const report = checkClaim(circuitFor("c01"), mutate(claimFor("c01"), "value", (x) => x * 1.05));
    expect(report.notes).toEqual(["The claimed value is 8.4 V. The circuit gives 8 V."]);
  });

  it("gives one note and no items for a node that does not exist", () => {
    const claim = Claim.parse({ kind: "node_voltage", node: "Z", setup: NS, value: 1 });
    const report = checkClaim(circuitFor("c01"), claim);
    expect(report.verified).toBe(false);
    expect(report.items).toEqual([]);
    expect(report.notes).toHaveLength(1);
  });

  it("rejects a graph claim against a circuit", () => {
    const claim = Claim.parse({ kind: "graph_value", series: "s1", x: 1, value: 1 });
    const report = checkClaim(circuitFor("c01"), claim);
    expect(report.verified).toBe(false);
    expect(report.items).toEqual([]);
    expect(report.notes).toHaveLength(1);
  });

  it("measures the condition at the claimed value", () => {
    const claim = mutate(claimFor("c11"), "value", () => 10000);
    const report = checkClaim(circuitFor("c11"), claim);
    expect(report.verified).toBe(false);
    expect(report.items[0]?.measured).toBeCloseTo(6.4286, 3);
    expect(report.notes).toHaveLength(1);
  });

  it("rejects a non-positive or non-finite design value", () => {
    const base = claimFor("c11");
    expect(checkClaim(circuitFor("c11"), mutate(base, "value", () => 0)).verified).toBe(false);
    const nan = checkClaim(circuitFor("c11"), {
      kind: "component_value_for_condition",
      component: "R2",
      condition: { kind: "node_voltage", target: "B", value: 9 },
      value: Number.NaN,
    });
    expect(nan.verified).toBe(false);
    expect(nan.items).toEqual([]);
  });

  it("returns the residuals of the measurement", () => {
    const report = checkClaim(circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]), Claim.parse({
      kind: "branch_current",
      component: "R1",
      setup: NS,
      value: 0.012,
    }));
    expect(report.verified).toBe(true);
    expect(report.residuals).not.toBeNull();
  });
});
