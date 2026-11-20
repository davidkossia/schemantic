/**
 * Graph tools: value at x, slope, area, extrema.
 *
 * Source of truth: docs/build/CONTRACTS.md, sections 2 and 4, and docs/build/M7-graphs.md (WP-26).
 */
import { err, ok } from "./schema";
import type { Graph, Result, Series } from "./schema";
import { closeTo } from "./units";

export type GraphError = { code: "out_of_range" | "unknown_series" | "wrong_kind"; message: string };

type XY = { x: number; y: number };

function fail(code: GraphError["code"], message: string): Result<never, GraphError> {
  return err({ code, message });
}

export function findSeries(g: Graph, id: string): Result<Series, GraphError> {
  const s = g.series.find((candidate) => candidate.id === id);
  return s ? ok(s) : fail("unknown_series", `There is no series with the id ${id}.`);
}

function outOfRange(s: Series, x: number): Result<never, GraphError> {
  return fail("out_of_range", `x = ${x} is outside the data of series ${s.id}.`);
}

function lineValue(s: Series, x: number): Result<number, GraphError> {
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  if (!first || !last || !(x >= first.x) || !(x <= last.x)) return outOfRange(s, x);
  for (let i = 0; i < s.points.length; i++) {
    const p = s.points[i];
    if (!p) continue;
    if (p.x === x) return ok(p.y);
    const q = s.points[i + 1];
    if (q && p.x < x && x < q.x) return ok(p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x));
  }
  return outOfRange(s, x);
}

export function valueAt(s: Series, x: number): Result<number, GraphError> {
  if (s.kind === "bar") {
    const hit = s.points.find((p) => closeTo(x, p.x));
    return hit ? ok(hit.y) : outOfRange(s, x);
  }
  return lineValue(s, x);
}

export function slope(s: Series, x1: number, x2: number): Result<number, GraphError> {
  if (s.kind !== "line") return fail("wrong_kind", `Series ${s.id} is a bar series, which has no slope.`);
  if (x1 === x2) return fail("out_of_range", "A slope needs two different x values.");
  const y1 = valueAt(s, x1);
  if (!y1.ok) return y1;
  const y2 = valueAt(s, x2);
  if (!y2.ok) return y2;
  return ok((y2.value - y1.value) / (x2 - x1));
}

export function area(s: Series, x1: number, x2: number): Result<number, GraphError> {
  if (s.kind !== "line") return fail("wrong_kind", `Series ${s.id} is a bar series, which has no area.`);
  if (!(x1 < x2)) return fail("out_of_range", "An area needs x1 to be less than x2.");
  const y1 = valueAt(s, x1);
  if (!y1.ok) return y1;
  const y2 = valueAt(s, x2);
  if (!y2.ok) return y2;
  const pts: XY[] = [{ x: x1, y: y1.value }];
  for (const p of s.points) if (p.x > x1 && p.x < x2) pts.push({ x: p.x, y: p.y });
  pts.push({ x: x2, y: y2.value });
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) total += ((a.y + b.y) / 2) * (b.x - a.x);
  }
  return ok(total);
}

export function extremum(s: Series, which: "max" | "min"): Result<XY, GraphError> {
  let best: XY | null = null;
  for (const p of s.points) {
    if (best === null || (which === "max" ? p.y > best.y : p.y < best.y) || (p.y === best.y && p.x < best.x)) {
      best = { x: p.x, y: p.y };
    }
  }
  return best ? ok(best) : fail("out_of_range", `Series ${s.id} has no points.`);
}
