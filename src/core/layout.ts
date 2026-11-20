import type { Circuit, Component, Point } from "./schema";
import type { Drawing, DrawnComponent, GridPoint, NodeLabel, Wire } from "./schematic";

/**
 * Automatic layout: turn any circuit into a drawing for the review screen.
 * Pure: the same circuit gives the same drawing.
 */

// The grid every problem image is drawn on (eval/types.ts). A grid point x sits at (x + 1) / (COLS + 2) of the image.
const COLS = 12;
const ROWS = 8;

const key = (p: GridPoint): string => `${p[0]},${p[1]}`;
const edgeKey = (p: GridPoint, q: GridPoint): string => {
  const [s, t] = [key(p), key(q)].sort();
  return `${s}|${t}`;
};
const same = (p: GridPoint, q: GridPoint): boolean => p[0] === q[0] && p[1] === q[1];

/** Every whole grid point a polyline passes through, in order. */
function unitPoints(points: GridPoint[]): GridPoint[] {
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

/** The unit edges a polyline covers, as keys. */
function unitEdges(points: GridPoint[]): string[] {
  const pts = unitPoints(points);
  const out: string[] = [];
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (prev) out.push(edgeKey(prev, p));
  });
  return out;
}

/** Drop repeated consecutive points. */
function compact(points: GridPoint[]): GridPoint[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || !same(prev, p);
  });
}

/** Nodes in order of first appearance, a before b. */
function nodeOrder(c: Circuit): string[] {
  const out: string[] = [];
  for (const k of c.components) {
    for (const n of [k.a, k.b]) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Give every wire a vertex wherever a terminal or another wire of the same node touches it, so the renderer
 * draws a junction dot there. Keeps the wire's own corners and ends.
 */
function addTouchVertices(wires: Wire[], terminals: GridPoint[]): Wire[] {
  const terminalKeys = new Set(terminals.map(key));
  const pointSets = wires.map((w) => new Set(unitPoints(w.points).map(key)));
  return wires.map((w, i) => {
    const own = new Set(w.points.map(key));
    const touch = new Set<string>();
    wires.forEach((other, j) => {
      if (j === i || other.node !== w.node) return;
      for (const k of pointSets[j] ?? []) touch.add(k);
    });
    const pts = unitPoints(w.points);
    const last = pts.length - 1;
    const kept = pts.filter((p, n) => {
      const k = key(p);
      return n === 0 || n === last || own.has(k) || terminalKeys.has(k) || touch.has(k);
    });
    return { node: w.node, points: kept };
  });
}

/** The end of a wire with the smaller x; on a tie, the higher one. */
function leftEnd(w: Wire): GridPoint | null {
  const first = w.points[0];
  const last = w.points[w.points.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0]) return first[0] < last[0] ? first : last;
  return first[1] <= last[1] ? first : last;
}

/** A label for every node other than ground, at the left end of its first wire, or at its first terminal. */
function labelNodes(c: Circuit, wires: Wire[], components: DrawnComponent[]): NodeLabel[] {
  const labels: NodeLabel[] = [];
  for (const node of nodeOrder(c)) {
    if (node === c.ground) continue;
    const wire = wires.find((w) => w.node === node);
    let at: GridPoint | null = wire ? leftEnd(wire) : null;
    for (let i = 0; at === null && i < components.length; i++) {
      const d = components[i];
      const k = c.components[i];
      if (!d || !k) continue;
      if (k.a === node) at = d.a;
      else if (k.b === node) at = d.b;
    }
    if (at) labels.push({ node, at });
  }
  return labels;
}

function drawn(k: Component, a: GridPoint, b: GridPoint): DrawnComponent {
  return { id: k.id, type: k.type, label: k.label, a, b };
}

/** The ground terminal lowest on the grid; on a tie, the leftmost. */
function lowestGround(c: Circuit, components: DrawnComponent[]): GridPoint | null {
  let best: GridPoint | null = null;
  for (const [i, d] of components.entries()) {
    const k = c.components[i];
    if (!k) continue;
    const ends: GridPoint[] = [];
    if (k.a === c.ground) ends.push(d.a);
    if (k.b === c.ground) ends.push(d.b);
    for (const p of ends) {
      if (!best || p[1] > best[1] || (p[1] === best[1] && p[0] < best[0])) best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Positioned layout

function snap(p: Point): GridPoint | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const gx = Math.min(COLS, Math.max(0, Math.round(p.x * (COLS + 2) - 1)));
  const gy = Math.min(ROWS, Math.max(0, Math.round(p.y * (ROWS + 2) - 1)));
  return [gx + 0, gy + 0]; // + 0 turns -0 into 0
}

const onGrid = (p: GridPoint): boolean => p[0] >= 0 && p[0] <= COLS && p[1] >= 0 && p[1] <= ROWS;
const manhattan = (p: GridPoint, q: GridPoint): number => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
const midpoint = (d: DrawnComponent): GridPoint => [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];

/**
 * The drawing from the reader's terminal positions, snapped to the 12 by 8 grid.
 * Returns null when a position is missing or the result would be unreadable.
 */
export function positionedDrawing(c: Circuit): Drawing | null {
  const components: DrawnComponent[] = [];
  for (const k of c.components) {
    if (k.pa === null || k.pb === null) return null;
    const ga = snap(k.pa);
    const gb = snap(k.pb);
    if (!ga || !gb) return null;
    const dx = gb[0] - ga[0];
    const dy = gb[1] - ga[1];
    const mx = Math.round((ga[0] + gb[0]) / 2);
    const my = Math.round((ga[1] + gb[1]) / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
      const s = dx > 0 ? 1 : -1;
      components.push(drawn(k, [mx - s, my], [mx + s, my]));
    } else {
      const s = dy >= 0 ? 1 : -1;
      components.push(drawn(k, [mx, my - s], [mx, my + s]));
    }
  }

  // Terminals must stay on the grid.
  if (components.some((d) => !onGrid(d.a) || !onGrid(d.b))) return null;

  // Components must not overlap: no body on another component's body or terminal.
  const bodies = new Set<string>();
  for (const [i, d] of components.entries()) {
    const m = key(midpoint(d));
    for (const e of components.slice(i + 1)) {
      const others = [key(e.a), key(midpoint(e)), key(e.b)];
      if (others.includes(m) || [key(d.a), key(d.b)].includes(key(midpoint(e)))) return null;
    }
    bodies.add(m);
  }

  // Each grid point belongs to at most one node.
  const owner = new Map<string, string>();
  const claim = (p: GridPoint, node: string): boolean => {
    const o = owner.get(key(p));
    if (o !== undefined && o !== node) return false;
    owner.set(key(p), node);
    return true;
  };
  const terminalsOf = new Map<string, GridPoint[]>();
  const allTerminals: GridPoint[] = [];
  for (const [i, d] of components.entries()) {
    const k = c.components[i];
    if (!k) continue;
    for (const [node, p] of [[k.a, d.a], [k.b, d.b]] as const) {
      if (!claim(p, node)) return null;
      allTerminals.push(p);
      const list = terminalsOf.get(node) ?? [];
      if (!list.some((q) => same(q, p))) list.push(p);
      terminalsOf.set(node, list);
    }
  }

  // Wire each node with a minimum spanning tree of L-shaped wires.
  const wires: Wire[] = [];
  for (const node of nodeOrder(c)) {
    const pts = terminalsOf.get(node) ?? [];
    const edges = new Set<string>();
    const fits = (path: GridPoint[]): boolean => {
      for (const p of unitPoints(path)) {
        if (bodies.has(key(p))) return false;
        const o = owner.get(key(p));
        if (o !== undefined && o !== node) return false;
      }
      return unitEdges(path).every((e) => !edges.has(e));
    };

    const tree = pts.slice(0, 1);
    const rest = pts.slice(1);
    while (rest.length > 0) {
      let best: { u: GridPoint; j: number; d: number } | null = null;
      for (const u of tree) {
        for (const [j, v] of rest.entries()) {
          const d = manhattan(u, v);
          if (!best || d < best.d) best = { u, j, d };
        }
      }
      if (!best) break;
      const { u, j } = best;
      const v = rest[j];
      if (!v) break;
      rest.splice(j, 1);
      tree.push(v);

      // Horizontal first, then vertical, from whichever end keeps clear of bodies and other nodes.
      const fromU = compact([u, [v[0], u[1]], v]);
      const fromV = compact([v, [u[0], v[1]], u]);
      const path = fits(fromU) ? fromU : fits(fromV) ? fromV : null;
      if (!path) return null;
      for (const p of unitPoints(path)) claim(p, node);
      for (const e of unitEdges(path)) edges.add(e);
      wires.push({ node, points: path });
    }
  }

  const finalWires = addTouchVertices(wires, allTerminals);
  return {
    cols: COLS,
    rows: ROWS,
    components,
    wires: finalWires,
    groundAt: lowestGround(c, components),
    nodeLabels: labelNodes(c, finalWires, components),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bus layout

type Arc = { k: Component; index: number; left: number; right: number; xl: number; xr: number };

/**
 * A plain drawing that works for any netlist: each node is a bus on one row, components between a node and ground
 * hang under it, and components between two nodes lie on their own rows above.
 *
 * When two components join four buses in the order A, B, A, B, their wires must cross. The crossing has no vertex, so
 * the renderer draws it without a junction dot.
 */
export function busDrawing(c: Circuit): Drawing {
  const g = c.ground;
  const nodes = nodeOrder(c).filter((n) => n !== g);
  const busOf = new Map(nodes.map((n, i) => [n, i]));

  const arcs: Arc[] = [];
  const hanging = new Map<number, { k: Component; index: number }[]>();
  const groundLoops: { k: Component; index: number }[] = [];
  c.components.forEach((k, index) => {
    const ia = busOf.get(k.a);
    const ib = busOf.get(k.b);
    if (ia !== undefined && ib !== undefined && ia !== ib) {
      arcs.push({ k, index, left: Math.min(ia, ib), right: Math.max(ia, ib), xl: 0, xr: 0 });
      return;
    }
    const bus = ia ?? ib;
    if (bus === undefined) {
      groundLoops.push({ k, index });
      return;
    }
    hanging.set(bus, [...(hanging.get(bus) ?? []), { k, index }]);
  });

  // Columns. In each bus: arcs from the left (inner first), hanging components, arcs to the right (outer first).
  // That order keeps arcs nested, so their wires do not cross.
  type Hung = { k: Component; index: number; x: number };
  const hung: Hung[] = [];
  const attach = new Map<number, number[]>();
  const groundAttach: number[] = [];
  let x = 1;
  nodes.forEach((_, i) => {
    const cols: number[] = [];
    const fromLeft = arcs.filter((a) => a.right === i).sort((p, q) => q.left - p.left || q.index - p.index);
    const toRight = arcs.filter((a) => a.left === i).sort((p, q) => q.right - p.right || p.index - q.index);
    for (const a of fromLeft) {
      a.xr = x;
      cols.push(x);
      x += 1;
    }
    for (const h of hanging.get(i) ?? []) {
      if (h.k.a === h.k.b) {
        // A loop: the return wire on the left, the component one column right of it.
        cols.push(x, x + 1);
        hung.push({ ...h, x: x + 1 });
        x += 3;
      } else {
        cols.push(x);
        groundAttach.push(x);
        hung.push({ ...h, x });
        x += 2;
      }
    }
    for (const a of toRight) {
      a.xl = x;
      cols.push(x);
      x += 1;
    }
    attach.set(i, cols);
    const last = cols[cols.length - 1] ?? x;
    x = Math.max(x, last + 1) + 1; // one empty column between buses
  });
  for (const h of groundLoops) {
    groundAttach.push(x, x + 1);
    hung.push({ ...h, x: x + 1 });
    x += 3;
  }

  // Rows. Wider arcs sit higher, so an arc's wires drop past the arcs nested inside it.
  const byWidth = [...arcs].sort((p, q) => q.xr - q.xl - (p.xr - p.xl) || p.index - q.index);
  const rowOf = new Map(byWidth.map((a, t) => [a.index, 2 * t]));
  const Y = 2 * arcs.length; // the bus row
  const G = Y + 4; // the ground row

  const placed = new Map<number, DrawnComponent>();
  const wires: Wire[] = [];

  // Buses first, so each node's first wire is its bus.
  nodes.forEach((node, i) => {
    const cols = attach.get(i) ?? [];
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    if (cols.length > 0 && hi > lo) wires.push({ node, points: [[lo, Y], [hi, Y]] });
  });

  for (const a of arcs) {
    const r = rowOf.get(a.index) ?? 0;
    const leftNode = nodes[a.left] ?? "";
    const rightNode = nodes[a.right] ?? "";
    const pl: GridPoint = [a.xl, r];
    const pr: GridPoint = [a.xl + 2, r];
    placed.set(a.index, a.k.a === leftNode ? drawn(a.k, pl, pr) : drawn(a.k, pr, pl));
    wires.push({ node: leftNode, points: [pl, [a.xl, Y]] });
    wires.push({ node: rightNode, points: compact([pr, [a.xr, r], [a.xr, Y]]) });
  }

  for (const h of hung) {
    const index = h.index;
    const top: GridPoint = [h.x, Y + 1];
    const bottom: GridPoint = [h.x, Y + 3];
    if (h.k.a === h.k.b) {
      const node = h.k.a;
      placed.set(index, drawn(h.k, top, bottom));
      if (node === g) {
        wires.push({ node, points: [bottom, [h.x, G]] });
        wires.push({ node, points: [top, [h.x - 1, Y + 1], [h.x - 1, G]] });
      } else {
        wires.push({ node, points: [[h.x, Y], top] });
        wires.push({ node, points: [bottom, [h.x - 1, Y + 3], [h.x - 1, Y]] });
      }
      continue;
    }
    const node = h.k.a === g ? h.k.b : h.k.a;
    placed.set(index, h.k.a === node ? drawn(h.k, top, bottom) : drawn(h.k, bottom, top));
    wires.push({ node, points: [[h.x, Y], top] });
    wires.push({ node: g, points: [bottom, [h.x, G]] });
  }

  let groundAt: GridPoint | null = null;
  if (groundAttach.length > 0) {
    const lo = Math.min(...groundAttach);
    const hi = Math.max(...groundAttach);
    if (hi > lo) wires.push({ node: g, points: [[lo, G], [hi, G]] });
    groundAt = [Math.round((lo + hi) / 2), G];
  }

  const components = c.components.map((k, i) => placed.get(i) ?? drawn(k, [0, 0], [0, 2]));
  const terminals = components.flatMap((d) => [d.a, d.b]);
  const finalWires = addTouchVertices(wires, terminals);
  const all = [...terminals, ...finalWires.flatMap((w) => w.points)];
  const maxX = Math.max(1, ...all.map((p) => p[0]));
  const maxY = Math.max(1, ...all.map((p) => p[1]));
  return {
    cols: maxX + 1, // one spare column for the labels of a component on the right edge
    rows: maxY,
    components,
    wires: finalWires,
    groundAt,
    nodeLabels: labelNodes(c, finalWires, components),
  };
}

/** The positioned layout when the reader's positions give a clean drawing; otherwise the bus layout. */
export function autoDrawing(c: Circuit): Drawing {
  return positionedDrawing(c) ?? busDrawing(c);
}
