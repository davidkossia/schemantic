import { describe, expect, it } from "vitest";
import { autoDrawing, busDrawing, positionedDrawing } from "../src/core/layout";
import type { Circuit } from "../src/core/schema";
import { DEFAULT_STYLE, renderDrawing, type Drawing } from "../src/core/schematic";
import { PROBLEMS } from "../eval/problems/index";
import { canonical, circuit, key, netlistGroups, resistor, terminalGroups, vsource, wirePoints } from "./helpers";

function truthOf(id: string): Circuit {
  const p = PROBLEMS.find((q) => q.id === id);
  if (!p || p.truth.kind !== "circuit") throw new Error(`no circuit ${id}`);
  return p.truth;
}

function withoutPositions(c: Circuit): Circuit {
  return { ...c, components: c.components.map((k) => ({ ...k, pa: null, pb: null })) };
}

/** Assert that a drawing is a faithful, readable picture of the circuit. */
function expectValid(c: Circuit, d: Drawing): void {
  // Every component once, 2 units long on one axis.
  expect(d.components.map((k) => k.id)).toEqual(c.components.map((k) => k.id));
  for (const k of d.components) {
    const dx = Math.abs(k.a[0] - k.b[0]);
    const dy = Math.abs(k.a[1] - k.b[1]);
    expect(dx + dy).toBe(2);
    expect(dx === 0 || dy === 0).toBe(true);
  }
  const mids = d.components.map((k) => key([(k.a[0] + k.b[0]) / 2, (k.a[1] + k.b[1]) / 2]));
  expect(new Set(mids).size).toBe(mids.length);

  // Straight segments only.
  for (const w of d.wires) {
    expect(w.points.length).toBeGreaterThanOrEqual(2);
    w.points.forEach((q, i) => {
      const prev = w.points[i - 1];
      if (prev) expect(prev[0] === q[0] || prev[1] === q[1]).toBe(true);
    });
  }

  // Same connectivity as the netlist.
  expect(canonical(terminalGroups(d))).toEqual(canonical(netlistGroups(c)));

  // No wire through a component body.
  for (const w of d.wires) {
    const pts = wirePoints(w.points).map(key);
    for (const m of mids) expect(pts).not.toContain(m);
  }

  // No grid point used by two nodes, counting terminals.
  const owner = new Map<string, string>();
  const own = (k: string, node: string): void => {
    const o = owner.get(k);
    if (o !== undefined) expect(o).toBe(node);
    owner.set(k, node);
  };
  c.components.forEach((k, i) => {
    const drawn = d.components[i];
    if (!drawn) throw new Error("missing");
    own(key(drawn.a), k.a);
    own(key(drawn.b), k.b);
  });
  for (const w of d.wires) for (const p of wirePoints(w.points)) own(key(p), w.node);

  // Every node but ground is labelled.
  const nodes = new Set(c.components.flatMap((k) => [k.a, k.b]));
  nodes.delete(c.ground);
  expect(d.nodeLabels.map((l) => l.node).sort()).toEqual([...nodes].sort());

  const svg = renderDrawing(d, DEFAULT_STYLE);
  expect(svg).not.toContain("NaN");
  expect(svg).not.toContain("undefined");
  expect(svg).not.toContain("Infinity");
}

describe("autoDrawing", () => {
  for (const p of PROBLEMS) {
    describe(p.id, () => {
      const truth = truthOf(p.id);

      it("draws the netlist from the reader's positions", () => {
        const d = positionedDrawing(truth);
        expect(d).not.toBeNull();
        expect(autoDrawing(truth)).toEqual(d);
        expectValid(truth, autoDrawing(truth));
      });

      it("puts every component back where the problem drew it", () => {
        const d = positionedDrawing(truth);
        if (!d || !p.drawing) throw new Error("no drawing");
        for (const k of p.drawing.components) {
          const got = d.components.find((q) => q.id === k.id);
          expect(got?.a).toEqual(k.a);
          expect(got?.b).toEqual(k.b);
        }
      });

      it("falls back to a valid bus layout without positions", () => {
        const bare = withoutPositions(truth);
        expect(positionedDrawing(bare)).toBeNull();
        expect(autoDrawing(bare)).toEqual(busDrawing(bare));
        expectValid(bare, autoDrawing(bare));
      });
    });
  }

  it("draws 6 parallel resistors between two nodes as 6 distinct components", () => {
    const six = Array.from({ length: 6 }, (_, i) => resistor(`R${i + 1}`, 1000, "A", "B"));
    const c = circuit([vsource("V1", 5, "A", "gnd"), ...six, resistor("R7", 1000, "B", "gnd")]);
    const d = autoDrawing(c);
    expectValid(c, d);
    expect(d.components).toHaveLength(8);
  });

  it("draws 6 parallel resistors between a node and ground as 6 distinct components", () => {
    const six = Array.from({ length: 6 }, (_, i) => resistor(`R${i + 1}`, 1000, "A", "gnd"));
    const c = circuit([vsource("V1", 5, "A", "gnd"), ...six]);
    expectValid(c, autoDrawing(c));
  });

  it("falls back to the bus layout when two components sit on the same spot", () => {
    const c01 = truthOf("c01");
    const r1 = c01.components.find((k) => k.id === "R1");
    if (!r1) throw new Error("no R1");
    const clash: Circuit = {
      ...c01,
      components: c01.components.map((k) => (k.id === "R2" ? { ...k, pa: r1.pa, pb: r1.pb } : k)),
    };
    expect(positionedDrawing(clash)).toBeNull();
    expect(autoDrawing(clash)).toEqual(busDrawing(clash));
    expectValid(clash, autoDrawing(clash));
  });

  it("falls back when a component spans two nodes' terminals", () => {
    // R3 is placed exactly over V1, so its terminals land on nodes A and gnd while it joins B and gnd.
    const c01 = truthOf("c01");
    const v1 = c01.components.find((k) => k.id === "V1");
    if (!v1) throw new Error("no V1");
    const c: Circuit = { ...c01, components: [...c01.components, { ...resistor("R3", 1, "B", "gnd"), pa: v1.pa, pb: v1.pb }] };
    expect(positionedDrawing(c)).toBeNull();
    expectValid(c, autoDrawing(c));
  });

  it("draws a component with both ends on one node, on ground or elsewhere", () => {
    const c = circuit([
      vsource("V1", 5, "A", "gnd"),
      resistor("R1", 1000, "A", "A"),
      resistor("R2", 1000, "A", "gnd"),
      resistor("R3", 1000, "gnd", "gnd"),
    ]);
    expectValid(c, autoDrawing(c));
  });

  it("draws a disconnected netlist and one with no ground terminal", () => {
    const c = circuit([vsource("V1", 5, "A", "gnd"), resistor("R1", 1000, "A", "gnd"), resistor("R2", 1000, "X", "Y")]);
    expectValid(c, autoDrawing(c));
    const floating = circuit([resistor("R1", 1000, "A", "B"), resistor("R2", 1000, "B", "A")]);
    const d = autoDrawing(floating);
    expectValid(floating, d);
    expect(d.groundAt).toBeNull();
  });

  it("draws an empty circuit", () => {
    const d = autoDrawing(circuit([]));
    expect(d.components).toEqual([]);
    expect(renderDrawing(d, DEFAULT_STYLE)).not.toContain("NaN");
  });

  it("hangs the ground on the lowest ground terminal, then the leftmost", () => {
    const d = positionedDrawing(truthOf("c01"));
    expect(d?.groundAt).toEqual([4, 5]);
  });

  it("rejects positions that are not finite numbers", () => {
    const c01 = truthOf("c01");
    const bad: Circuit = {
      ...c01,
      components: c01.components.map((k, i) => (i === 0 ? { ...k, pa: { x: Number.NaN, y: 0.5 } } : k)),
    };
    expect(positionedDrawing(bad)).toBeNull();
    expectValid(bad, autoDrawing(bad));
  });
});
