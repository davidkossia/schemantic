import { describe, expect, it } from "vitest";
import { applyChanges, applySetup, solveCircuit } from "../src/core/mna";
import type { Circuit, Solution } from "../src/core/schema";
import { circuit, isource, resistor, vsource } from "./helpers";
import { CIRCUITS } from "./fixtures/circuits";

function solved(c: Circuit): Solution {
  const r = solveCircuit(c);
  if (!r.ok) throw new Error(`solve failed: ${r.error.code}`);
  return r.value;
}

function fx(id: string): Circuit {
  const c = CIRCUITS[id];
  if (c === undefined) throw new Error(`no fixture ${id}`);
  return c;
}

function comp(s: Solution, id: string) {
  const v = s.components[id];
  if (v === undefined) throw new Error(`no component ${id}`);
  return v;
}

describe("worked example", () => {
  it("matches every number in CONTRACTS.md", () => {
    const s = solved(
      circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "B"), resistor("R2", 2000, "B", "gnd")]),
    );
    expect(s.nodeVoltages["gnd"]).toBe(0);
    expect(s.nodeVoltages["B"]).toBeCloseTo(8, 9);
    expect(comp(s, "R1").current).toBeCloseTo(0.004, 12);
    expect(comp(s, "R1").power).toBeCloseTo(0.016, 12);
    expect(comp(s, "V1").current).toBeCloseTo(-0.004, 12);
    expect(comp(s, "V1").power).toBeCloseTo(-0.048, 12);
    const total = Object.values(s.components).reduce((sum, x) => sum + x.power, 0);
    expect(Math.abs(total)).toBeLessThan(1e-12);
  });
});

describe("single-solve circuits", () => {
  it("c01 to c08 give the PROBLEMS.md answers", () => {
    expect(solved(fx("c01")).nodeVoltages["B"]).toBeCloseTo(8, 9);
    expect(comp(solved(fx("c02")), "R2").current).toBeCloseTo(0.02, 12);
    expect(comp(solved(fx("c03")), "R2").power).toBeCloseTo(0.25, 12);
    expect(solved(fx("c04")).nodeVoltages["A"]).toBeCloseTo(1.5, 9);
    expect(solved(fx("c05")).nodeVoltages["C"]).toBeCloseTo(4, 9);
    expect(comp(solved(fx("c06")), "R5").current).toBeCloseTo(1 / 700, 12);
    expect(solved(fx("c07")).nodeVoltages["B"]).toBeCloseTo(9, 9);
    expect(comp(solved(fx("c08")), "V1").power).toBeCloseTo(-4 / 75, 12);
  });

  it("powers sum to 0 for every fixture", () => {
    for (let n = 1; n <= 14; n++) {
      const id = `c${String(n).padStart(2, "0")}`;
      const s = solved(fx(id));
      const total = Object.values(s.components).reduce((sum, x) => sum + x.power, 0);
      expect(Math.abs(total)).toBeLessThan(1e-9);
    }
    expect(Object.keys(CIRCUITS)).toHaveLength(14);
  });
});

describe("solveCircuit errors", () => {
  const code = (c: Circuit): string | null => {
    const r = solveCircuit(c);
    return r.ok ? null : r.error.code;
  };

  it("reports empty", () => {
    expect(code(circuit([]))).toBe("empty");
  });
  it("reports duplicate_id", () => {
    expect(code(circuit([resistor("R1", 1, "A", "gnd"), resistor("R1", 2, "A", "gnd")]))).toBe("duplicate_id");
  });
  it("reports no_ground", () => {
    expect(code(circuit([vsource("V1", 5, "A", "B"), resistor("R1", 10, "A", "B")]))).toBe("no_ground");
  });
  it("reports singular for two sources across the same nodes", () => {
    expect(code(circuit([vsource("V1", 5, "A", "gnd"), vsource("V2", 10, "A", "gnd")]))).toBe("singular");
  });
  it("reports singular for a lone current source", () => {
    expect(code(circuit([isource("I1", 0.001, "A", "gnd")]))).toBe("singular");
  });
  it("reports singular for a floating resistor", () => {
    expect(
      code(circuit([vsource("V1", 5, "A", "gnd"), resistor("R1", 100, "A", "gnd"), resistor("R2", 100, "X", "Y")])),
    ).toBe("singular");
  });
  it("reports invalid_value for 0 ohms", () => {
    expect(code(circuit([vsource("V1", 5, "A", "gnd"), resistor("R1", 0, "A", "gnd")]))).toBe("invalid_value");
  });
  it("reports unknown_component", () => {
    const c = circuit([resistor("R1", 100, "A", "gnd")]);
    const first = c.components[0];
    if (first === undefined) throw new Error("no component");
    first.type = "unknown";
    expect(code(c)).toBe("unknown_component");
  });
});

describe("applySetup", () => {
  it("zeroing V1 or I1 on c12 gives 4 V and 12 V at B", () => {
    for (const [zero, expected] of [["V1", 4], ["I1", 12]] as const) {
      const r = applySetup(fx("c12"), { remove: [], zero: [zero] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(solved(r.value).nodeVoltages["B"]).toBeCloseTo(expected, 9);
    }
  });

  it("zero on a resistor gives unknown_id", () => {
    const r = applySetup(fx("c12"), { remove: [], zero: ["R1"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_id");
  });

  it("does not change the input", () => {
    const c = fx("c12");
    const copy = structuredClone(c);
    applySetup(c, { remove: ["R1"], zero: ["V1", "I1"] });
    applySetup(c, { remove: [], zero: ["R1"] });
    expect(c).toEqual(copy);
  });
});

describe("applyChanges", () => {
  const none = { type: null, value: null, a: null, b: null };

  it("set_value R3 800 on c14 gives R1.current 0.009", () => {
    const r = applyChanges(fx("c14"), [{ op: "set_value", id: "R3", ...none, value: 800 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(comp(solved(r.value), "R1").current).toBeCloseTo(0.009, 12);
  });

  it("add a 1 A source on c09 with RL removed and V1 zeroed gives 4000 V at C", () => {
    const r = applyChanges(fx("c09"), [
      { op: "remove", id: "RL", ...none },
      { op: "zero", id: "V1", ...none },
      { op: "add", id: "T", type: "current_source", value: 1, a: "C", b: "gnd" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(solved(r.value).nodeVoltages["C"]).toBeCloseTo(4000, 6);
  });

  it("reports unknown_id, duplicate_id and invalid_value", () => {
    const code = (ch: Parameters<typeof applyChanges>[1]): string | null => {
      const r = applyChanges(fx("c14"), ch);
      return r.ok ? null : r.error.code;
    };
    expect(code([{ op: "remove", id: "NOPE", ...none }])).toBe("unknown_id");
    expect(code([{ op: "add", id: "R1", type: "resistor", value: 5, a: "A", b: "B" }])).toBe("duplicate_id");
    expect(code([{ op: "set_value", id: "R1", ...none }])).toBe("invalid_value");
    expect(code([{ op: "add", id: "X", type: "resistor", value: 5, a: "A", b: null }])).toBe("invalid_value");
  });

  it("does not change the input", () => {
    const c = fx("c14");
    const copy = structuredClone(c);
    applyChanges(c, [{ op: "set_value", id: "R3", ...none, value: 800 }]);
    expect(c).toEqual(copy);
  });
});
