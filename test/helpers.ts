import type { Circuit, Component, Setup } from "../src/core/schema";
import type { Drawing, GridPoint } from "../src/core/schematic";

export function resistor(id: string, value: number, a: string, b: string): Component {
  return { id, type: "resistor", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function vsource(id: string, value: number, a: string, b: string): Component {
  return { id, type: "voltage_source", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function isource(id: string, value: number, a: string, b: string): Component {
  return { id, type: "current_source", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function circuit(components: Component[], ground = "gnd"): Circuit {
  return {
    kind: "circuit",
    components,
    ground,
    asked: { summary: "", target: null },
    notes: null,
  };
}

export const NO_SETUP: Setup = { remove: [], zero: [] };

export const key = (p: GridPoint): string => `${p[0]},${p[1]}`;

/** Every whole grid point a wire passes through, in order. */
export function wirePoints(points: GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (!prev) {
      out.push(p);
      return;
    }
    const steps = Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
    for (let s = 1; s <= steps; s++) {
      out.push([prev[0] + Math.sign(p[0] - prev[0]) * s, prev[1] + Math.sign(p[1] - prev[1]) * s]);
    }
  });
  return out;
}

/** Group the drawing's terminals by the wires that join them. Each group lists names such as "R1.a". */
export function terminalGroups(d: Drawing): string[][] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const next = parent.get(k);
    if (next === undefined || next === k) return k;
    const root = find(next);
    parent.set(k, root);
    return root;
  };
  for (const w of d.wires) {
    const pts = wirePoints(w.points);
    pts.forEach((p, i) => {
      const prev = pts[i - 1];
      if (prev) parent.set(find(key(prev)), find(key(p)));
    });
  }
  const groups = new Map<string, string[]>();
  for (const c of d.components) {
    for (const [end, p] of [["a", c.a], ["b", c.b]] as const) {
      const root = find(key(p));
      groups.set(root, [...(groups.get(root) ?? []), `${c.id}.${end}`]);
    }
  }
  return [...groups.values()];
}

export function canonical(groups: string[][]): string[] {
  return groups.map((g) => [...g].sort().join(" ")).sort();
}

/** Group the netlist's terminals by node. Each group lists names such as "R1.a". */
export function netlistGroups(c: Circuit): string[][] {
  const byNode = new Map<string, string[]>();
  for (const k of c.components) {
    byNode.set(k.a, [...(byNode.get(k.a) ?? []), `${k.id}.a`]);
    byNode.set(k.b, [...(byNode.get(k.b) ?? []), `${k.id}.b`]);
  }
  return [...byNode.values()];
}
