import { solveCircuit } from "./mna";
import type { Circuit, Graph, Structure, Warning } from "./schema";
import { closeTo, parseQuantity, unitFor } from "./units";

function warn(
  code: Warning["code"],
  severity: Warning["severity"],
  message: string,
  where: { componentId?: string; node?: string } = {},
): Warning {
  return { code, severity, message, componentId: where.componentId ?? null, node: where.node ?? null };
}

function validateCircuit(c: Circuit): Warning[] {
  if (c.components.length === 0) {
    return [warn("empty", "error", "The circuit has no components.")];
  }
  const out: Warning[] = [];
  const comps = c.components;

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of comps) {
    if (seen.has(k.id)) dupes.add(k.id);
    seen.add(k.id);
  }
  for (const id of dupes) {
    out.push(warn("duplicate_id", "error", `More than one component is named ${id}.`, { componentId: id }));
  }

  for (const k of comps) {
    if (k.type === "unknown") {
      out.push(warn("unknown_component", "error", `The type of ${k.id} is not known.`, { componentId: k.id }));
    }
  }

  for (const k of comps) {
    if (!Number.isFinite(k.value) || (k.type === "resistor" && k.value <= 0)) {
      out.push(warn("invalid_value", "error", `The value of ${k.id} is not valid.`, { componentId: k.id }));
    }
  }

  for (const k of comps) {
    if (k.type === "voltage_source" && k.a === k.b) {
      out.push(warn("shorted_source", "error", `The voltage source ${k.id} has both terminals on node ${k.a}.`, { componentId: k.id }));
    }
  }

  const noGround = !comps.some((k) => k.a === c.ground || k.b === c.ground);
  if (noGround) {
    out.push(warn("no_ground", "error", `No component touches the ground node ${c.ground}.`, { node: c.ground }));
  } else {
    const adj = new Map<string, Set<string>>();
    const link = (x: string, y: string): void => {
      if (!adj.has(x)) adj.set(x, new Set());
      adj.get(x)?.add(y);
    };
    for (const k of comps) {
      link(k.a, k.b);
      link(k.b, k.a);
    }
    const reached = new Set<string>([c.ground]);
    const stack = [c.ground];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === undefined) break;
      for (const m of adj.get(n) ?? []) {
        if (!reached.has(m)) {
          reached.add(m);
          stack.push(m);
        }
      }
    }
    for (const n of adj.keys()) {
      if (!reached.has(n)) {
        out.push(warn("disconnected", "error", `Node ${n} is not connected to ground.`, { node: n }));
      }
    }
  }

  const touches = new Map<string, number>();
  for (const k of comps) {
    touches.set(k.a, (touches.get(k.a) ?? 0) + 1);
    touches.set(k.b, (touches.get(k.b) ?? 0) + 1);
  }
  for (const [n, count] of touches) {
    if (n !== c.ground && count === 1) {
      out.push(warn("dangling_node", "warning", `Only one terminal touches node ${n}.`, { node: n }));
    }
  }
  for (const k of comps) {
    if (k.a === k.b && k.type !== "voltage_source") {
      out.push(warn("dangling_node", "warning", `Both terminals of ${k.id} are on node ${k.a}.`, { componentId: k.id }));
    }
  }

  for (const k of comps) {
    const q = parseQuantity(k.label);
    if (q !== null && !closeTo(Math.abs(q.value), Math.abs(k.value))) {
      out.push(warn("label_mismatch", "warning", `The label of ${k.id} does not match its value.`, { componentId: k.id }));
    }
  }
  for (const k of comps) {
    const q = parseQuantity(k.label);
    if (q !== null && q.unit !== null && q.unit !== unitFor(k.type)) {
      out.push(warn("unit_mismatch", "warning", `The unit in the label of ${k.id} does not fit its type.`, { componentId: k.id }));
    }
  }
  for (const k of comps) {
    if (k.uncertain !== null && k.uncertain !== "") {
      out.push(warn("uncertain", "warning", k.uncertain, { componentId: k.id }));
    }
  }

  if (!out.some((w) => w.severity === "error")) {
    const r = solveCircuit(c);
    if (!r.ok) {
      out.push(warn("singular", "error", "The circuit cannot be solved, because the equations have no unique answer."));
    }
  }
  return out;
}

function validateGraph(g: Graph): Warning[] {
  const out: Warning[] = [];

  for (const s of g.series) {
    const tooFew = s.kind === "line" ? s.points.length < 2 : s.points.length === 0;
    if (tooFew) out.push(warn("empty_series", "error", `Series ${s.id} does not have enough points.`));
  }
  if (g.series.length === 0) out.push(warn("empty_series", "error", "The graph has no series."));

  for (const s of g.series) {
    let sorted = true;
    for (let i = 1; i < s.points.length; i++) {
      const prev = s.points[i - 1];
      const cur = s.points[i];
      if (prev && cur && !(cur.x > prev.x)) sorted = false;
    }
    if (!sorted) out.push(warn("unsorted_points", "error", `The x values of series ${s.id} do not strictly increase.`));
  }

  for (const [name, axis] of [["x", g.x], ["y", g.y]] as const) {
    if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min >= axis.max) {
      out.push(warn("bad_axis", "error", `The ${name} axis range is not valid.`));
    }
  }

  for (const s of g.series) {
    const outside = s.points.some(
      (p) => p.x < g.x.min || p.x > g.x.max || p.y < g.y.min || p.y > g.y.max,
    );
    if (outside) out.push(warn("bad_axis", "warning", `Series ${s.id} has a point outside the axis ranges.`));
  }
  return out;
}

/** Return every warning that applies to the structure, in the order of the rule tables. */
export function validate(s: Structure): Warning[] {
  return s.kind === "circuit" ? validateCircuit(s) : validateGraph(s);
}

/** True when no warning has severity "error". */
export function canSolve(warnings: Warning[]): boolean {
  return !warnings.some((w) => w.severity === "error");
}
