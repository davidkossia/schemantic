import { ComponentType, type Circuit, type Component, type Graph, type Series } from "../../src/core/schema";
import { LIMITS } from "../../src/shared/limits";
import { formatQuantity, parseQuantity, unitFor } from "../../src/core/units";

export type EditableField = "type" | "value" | "a" | "b" | "label";

function mapComponent(circuit: Circuit, id: string, change: (k: Component) => Component): Circuit {
  if (!circuit.components.some((k) => k.id === id)) return circuit;
  return { ...circuit, components: circuit.components.map((k) => (k.id === id ? change(k) : k)) };
}

/** Return a new circuit with one field of one component changed. Invalid text leaves the circuit unchanged. */
export function setField(circuit: Circuit, id: string, field: EditableField, text: string): Circuit {
  switch (field) {
    case "value": {
      const q = parseQuantity(text);
      if (q === null) return circuit;
      return mapComponent(circuit, id, (k) => ({
        ...k,
        value: q.value,
        label: formatQuantity(q.value, unitFor(k.type)),
        uncertain: null,
      }));
    }
    case "a":
    case "b": {
      const node = text.trim();
      if (node === "") return circuit;
      return mapComponent(circuit, id, (k) => ({ ...k, [field]: node }));
    }
    case "type": {
      const parsed = ComponentType.safeParse(text);
      if (!parsed.success) return circuit;
      const type = parsed.data;
      return mapComponent(circuit, id, (k) => ({ ...k, type, label: formatQuantity(k.value, unitFor(type)) }));
    }
    case "label":
      return mapComponent(circuit, id, (k) => ({ ...k, label: text }));
  }
}

/** Add a 1 kΩ resistor between ground and ground, with the first unused id R1, R2, ... */
export function addComponent(circuit: Circuit): Circuit {
  const used = new Set(circuit.components.map((k) => k.id));
  let n = 1;
  while (used.has(`R${n}`)) n += 1;
  const added: Component = {
    id: `R${n}`,
    type: "resistor",
    label: formatQuantity(1000, "ohm"),
    value: 1000,
    a: circuit.ground,
    b: circuit.ground,
    pa: null,
    pb: null,
    uncertain: null,
  };
  return { ...circuit, components: [...circuit.components, added] };
}

export function removeComponent(circuit: Circuit, id: string): Circuit {
  return { ...circuit, components: circuit.components.filter((k) => k.id !== id) };
}

export function setGround(circuit: Circuit, node: string): Circuit {
  return { ...circuit, ground: node };
}

export type PointField = "x" | "y";
export type AxisName = "x" | "y";
export type AxisField = "label" | "unit" | "min" | "max";

/** Parse a number from text. Empty or non-finite text gives null. */
function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function sortPoints(points: Series["points"]): Series["points"] {
  return [...points].sort((p, q) => p.x - q.x);
}

function mapSeries(g: Graph, id: string, change: (s: Series) => Series): Graph {
  if (!g.series.some((s) => s.id === id)) return g;
  return { ...g, series: g.series.map((s) => (s.id === id ? change(s) : s)) };
}

/** Return a new graph with one coordinate of one point changed, then re-sorted by x. Invalid text leaves the graph unchanged. */
export function setPoint(g: Graph, seriesId: string, index: number, field: PointField, text: string): Graph {
  const n = parseNumber(text);
  if (n === null) return g;
  const series = g.series.find((s) => s.id === seriesId);
  const old = series?.points[index];
  if (old === undefined || old[field] === n) return g;
  return mapSeries(g, seriesId, (s) => ({
    ...s,
    points: sortPoints(s.points.map((p, i) => (i === index ? { ...p, [field]: n } : p))),
  }));
}

/** Add a point one x unit after the last one, at the last y (or at the axis minimums when the series is empty). A series at the point limit is unchanged. */
export function addPoint(g: Graph, seriesId: string): Graph {
  if ((g.series.find((s) => s.id === seriesId)?.points.length ?? 0) >= LIMITS.maxPoints) return g;
  return mapSeries(g, seriesId, (s) => {
    const last = s.points[s.points.length - 1];
    const added = last === undefined ? { x: g.x.min, y: g.y.min } : { x: last.x + 1, y: last.y };
    return { ...s, points: sortPoints([...s.points, added]) };
  });
}

export function removePoint(g: Graph, seriesId: string, index: number): Graph {
  return mapSeries(g, seriesId, (s) => ({ ...s, points: s.points.filter((_, i) => i !== index) }));
}

/** Change one field of an axis. Bad numbers and text longer than the limit leave the graph unchanged. An empty unit becomes null. */
export function setAxis(g: Graph, axis: AxisName, field: AxisField, text: string): Graph {
  const old = g[axis];
  let next: Graph["x"];
  switch (field) {
    case "label":
      if (text.length > LIMITS.maxFieldChars) return g;
      next = { ...old, label: text };
      break;
    case "unit": {
      const unit = text.trim();
      if (unit.length > LIMITS.maxFieldChars) return g;
      next = { ...old, unit: unit === "" ? null : unit };
      break;
    }
    case "min":
    case "max": {
      const n = parseNumber(text);
      if (n === null) return g;
      next = { ...old, [field]: n };
      break;
    }
  }
  return { ...g, [axis]: next };
}

/** Messages for limits the user can still fix in the review: points per series and axis text. Approve must stay blocked while any remain. */
export function graphLimitIssues(g: Graph): string[] {
  const out: string[] = [];
  // Series cannot be removed in the review, so a reading with too many can only be read again.
  if (g.series.length > LIMITS.maxSeries) {
    out.push(`The reading has ${g.series.length} series; at most ${LIMITS.maxSeries} can be solved. Read the image again.`);
  }
  for (const s of g.series) {
    if (s.points.length > LIMITS.maxPoints) {
      out.push(`Series ${s.id} has ${s.points.length} points. Remove ${s.points.length - LIMITS.maxPoints} to stay within ${LIMITS.maxPoints}.`);
    }
  }
  for (const [name, a] of [["x", g.x], ["y", g.y]] as const) {
    if (a.label.length > LIMITS.maxFieldChars || (a.unit ?? "").length > LIMITS.maxFieldChars) {
      out.push(`The ${name} axis label or unit is over ${LIMITS.maxFieldChars} characters.`);
    }
  }
  return out;
}
