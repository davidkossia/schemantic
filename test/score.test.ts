import { describe, expect, it } from "vitest";
import { scoreNetlist } from "../eval/score";
import type { Circuit } from "../src/core/schema";
import { CIRCUITS } from "./fixtures/circuits";
import { circuit, resistor, vsource } from "./helpers";

function get(id: string): Circuit {
  const c = CIRCUITS[id];
  if (c === undefined) throw new Error(`missing fixture ${id}`);
  return c;
}

function rename(c: Circuit, names: Record<string, string>): Circuit {
  return {
    ...c,
    components: c.components.map((x) => ({ ...x, a: names[x.a] ?? x.a, b: names[x.b] ?? x.b })),
  };
}

describe("scoreNetlist", () => {
  it("scores c06 against itself as exact", () => {
    const s = scoreNetlist(get("c06"), get("c06"));
    expect(s.exact).toBe(true);
    expect(s.matched).toBe(6);
  });

  it("ignores node names", () => {
    const read = rename(get("c06"), { A: "n1", B: "n2", C: "n3" });
    const s = scoreNetlist(get("c06"), read);
    expect(s.exact).toBe(true);
    expect(s.mapping["B"]).toBe("n2");
  });

  it("ignores component order and ids", () => {
    const c = get("c06");
    const read: Circuit = {
      ...c,
      components: [...c.components].reverse().map((x, i) => ({ ...x, id: `X${i}` })),
    };
    expect(scoreNetlist(c, read).exact).toBe(true);
  });

  it("counts a misread value as a miss", () => {
    const c = get("c06");
    const read: Circuit = {
      ...c,
      components: c.components.map((x) => (x.id === "R5" ? { ...x, value: 10000 } : x)),
    };
    const s = scoreNetlist(c, read);
    expect(s.matched).toBe(5);
    expect(s.recall).toBeCloseTo(5 / 6);
    expect(s.exact).toBe(false);
  });

  it("accepts a reversed source with a negated value, and rejects the same value", () => {
    const c = get("c01");
    const flip = (value: number): Circuit => ({
      ...c,
      components: c.components.map((x) => (x.id === "V1" ? { ...x, a: x.b, b: x.a, value } : x)),
    });
    expect(scoreNetlist(c, flip(-12)).exact).toBe(true);
    const bad = scoreNetlist(c, flip(12));
    expect(bad.matched).toBe(2);
    expect(bad.exact).toBe(false);
  });

  it("lowers precision for an extra component", () => {
    const c = get("c01");
    const read: Circuit = { ...c, components: [...c.components, resistor("R9", 470, "A", "B")] };
    const s = scoreNetlist(c, read);
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(3 / 4);
  });

  it("scores an empty read as zero", () => {
    const s = scoreNetlist(get("c01"), circuit([]));
    expect(s.matched).toBe(0);
    expect(s.precision).toBe(0);
    expect(s.exact).toBe(false);
  });

  it("loses the miswired component in c05", () => {
    const c = get("c05");
    const read: Circuit = {
      ...c,
      components: c.components.map((x) => (x.id === "R3" ? { ...x, a: "A" } : x)),
    };
    expect(scoreNetlist(c, read).matched).toBe(4);
  });

  it("matches one of two identical parallel resistors against one", () => {
    const truth = circuit([vsource("V1", 5, "A", "gnd"), resistor("R1", 1000, "A", "gnd"), resistor("R2", 1000, "A", "gnd")]);
    const read = circuit([vsource("V1", 5, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]);
    const s = scoreNetlist(truth, read);
    expect(s.matched).toBe(2);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.precision).toBe(1);
  });

  it("throws with more than 7 truth nodes besides ground", () => {
    const parts = Array.from({ length: 8 }, (_, i) => resistor(`R${i}`, 100, `n${i}`, "gnd"));
    expect(() => scoreNetlist(circuit(parts), circuit([]))).toThrow();
  });
});
