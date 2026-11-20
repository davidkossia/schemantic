import type { ComponentType } from "./schema";

/**
 * Draw a circuit as an SVG string from an explicit drawing. Used by the review screen and the eval images.
 * Pure: the same input gives the same string.
 */

export type GridPoint = [number, number]; // whole grid units. x grows right, y grows down.

export type DrawnComponent = {
  id: string;
  type: ComponentType;
  label: string;
  a: GridPoint; // terminal a
  b: GridPoint; // terminal b: exactly 2 units from a, on one axis
};

export type Wire = { node: string; points: GridPoint[] }; // each segment horizontal or vertical
export type NodeLabel = { node: string; at: GridPoint };

export type Drawing = {
  cols: number;
  rows: number; // grid size in units
  components: DrawnComponent[];
  wires: Wire[];
  groundAt: GridPoint | null; // where the ground symbol hangs
  nodeLabels: NodeLabel[];
};

export type Style = { resistor: "zigzag" | "box"; unit: number }; // unit: pixels per grid unit
export const DEFAULT_STYLE: Style = { resistor: "zigzag", unit: 60 };

const FONT = "Helvetica, Arial, sans-serif";

function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r === 0 ? 0 : r);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDrawing(d: Drawing, style: Style): string {
  const u = style.unit;
  // Grid to pixels, with a one-unit margin.
  const px = (x: number): number => (x + 1) * u;
  const py = (y: number): number => (y + 1) * u;
  const width = (d.cols + 2) * u;
  const height = (d.rows + 2) * u;
  const fontSize = 0.26 * u;

  const text = (x: number, y: number, s: string, anchor: string, bold = false): string =>
    `<text x="${num(x)}" y="${num(y)}" font-family="${FONT}" font-size="${num(fontSize)}" ` +
    `text-anchor="${anchor}" fill="#000" stroke="none"${bold ? ' font-weight="bold"' : ""}>${esc(s)}</text>`;

  const line = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;

  const parts: string[] = [];

  // Wires.
  for (const w of d.wires) {
    const pts = w.points;
    let path = "";
    pts.forEach((p, i) => {
      path += `${i === 0 ? "M" : "L"}${num(px(p[0]))} ${num(py(p[1]))} `;
    });
    parts.push(`<g data-node="${esc(w.node)}"><path d="${path.trim()}"/></g>`);
  }

  // Components.
  for (const c of d.components) {
    const dx = Math.sign(c.b[0] - c.a[0]);
    const dy = Math.sign(c.b[1] - c.a[1]);
    const nx = -dy;
    const ny = dx;
    // A point t grid units from terminal a along the axis, s units to the side.
    const at = (t: number, s = 0): [number, number] => [
      px(c.a[0]) + (dx * t + nx * s) * u,
      py(c.a[1]) + (dy * t + ny * s) * u,
    ];
    const seg = (t1: number, s1: number, t2: number, s2: number): string => {
      const p = at(t1, s1);
      const q = at(t2, s2);
      return line(p[0], p[1], q[0], q[1]);
    };
    const poly = (pts: [number, number][], closed: boolean): string =>
      `<${closed ? "polygon" : "polyline"} points="${pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"${
        closed ? ' fill="#000"' : ""
      }/>`;

    const body: string[] = [seg(0, 0, 0.5, 0), seg(1.5, 0, 2, 0)];

    if (c.type === "resistor") {
      if (style.resistor === "zigzag") {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 12; i++) {
          const s = i === 0 || i === 12 ? 0 : i % 2 === 1 ? 0.15 : -0.15;
          pts.push(at(0.5 + i / 12, s));
        }
        body.push(poly(pts, false));
      } else {
        const corners = [at(0.5, -0.15), at(1.5, -0.15), at(1.5, 0.15), at(0.5, 0.15)];
        const xs = corners.map((p) => p[0]);
        const ys = corners.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        body.push(
          `<rect x="${num(x0)}" y="${num(y0)}" width="${num(Math.max(...xs) - x0)}" height="${num(
            Math.max(...ys) - y0,
          )}"/>`,
        );
      }
    } else if (c.type === "voltage_source" || c.type === "current_source") {
      const m = at(1);
      body.push(`<circle cx="${num(m[0])}" cy="${num(m[1])}" r="${num(0.4 * u)}"/>`);
      if (c.type === "voltage_source") {
        const plus = at(0.7);
        const minus = at(1.3);
        body.push(text(plus[0], plus[1] + 0.09 * u, "+", "middle"));
        body.push(text(minus[0], minus[1] + 0.09 * u, "\u2212", "middle"));
      } else {
        // Arrow along the axis, head toward terminal a.
        body.push(seg(0.7, 0, 1.3, 0));
        body.push(poly([at(0.65, 0), at(0.9, 0.12), at(0.9, -0.12)], true));
      }
    } else {
      const corners = [at(0.5, -0.2), at(1.5, -0.2), at(1.5, 0.2), at(0.5, 0.2)];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      body.push(
        `<rect x="${num(x0)}" y="${num(y0)}" width="${num(Math.max(...xs) - x0)}" height="${num(
          Math.max(...ys) - y0,
        )}" stroke-dasharray="${num(0.1 * u)} ${num(0.08 * u)}"/>`,
      );
      const m = at(1);
      body.push(text(m[0], m[1] + 0.09 * u, "?", "middle"));
    }

    // Id and label text.
    const mid = at(1);
    if (dy === 0) {
      body.push(text(mid[0], mid[1] - 0.5 * u, c.id, "middle"));
      if (c.label !== "") body.push(text(mid[0], mid[1] + 0.5 * u + 0.2 * u, c.label, "middle"));
    } else {
      const tx = mid[0] + 0.55 * u;
      body.push(text(tx, mid[1] - 0.05 * u, c.id, "start"));
      if (c.label !== "") body.push(text(tx, mid[1] + 0.3 * u, c.label, "start"));
    }

    parts.push(`<g data-id="${esc(c.id)}" data-type="${esc(c.type)}">${body.join("")}</g>`);
  }

  // Junction dots: three or more ends at one grid point.
  const ends = new Map<string, { p: GridPoint; n: number }>();
  const addEnd = (p: GridPoint, n: number): void => {
    const key = `${p[0]},${p[1]}`;
    const e = ends.get(key);
    if (e) e.n += n;
    else ends.set(key, { p, n });
  };
  for (const w of d.wires) {
    w.points.forEach((p, i) => {
      const last = w.points.length - 1;
      addEnd(p, i === 0 || i === last ? 1 : 2);
    });
  }
  for (const c of d.components) {
    addEnd(c.a, 1);
    addEnd(c.b, 1);
  }
  for (const e of ends.values()) {
    if (e.n >= 3) {
      parts.push(
        `<circle data-junction="1" cx="${num(px(e.p[0]))}" cy="${num(py(e.p[1]))}" r="${num(0.07 * u)}" fill="#000" stroke="none"/>`,
      );
    }
  }

  // Ground symbol.
  if (d.groundAt) {
    const x = px(d.groundAt[0]);
    const y = py(d.groundAt[1]);
    const g = [line(x, y, x, y + 0.2 * u)];
    const widths = [0.5, 0.32, 0.14];
    widths.forEach((w, i) => {
      const yy = y + (0.2 + 0.12 * i) * u;
      g.push(line(x - (w / 2) * u, yy, x + (w / 2) * u, yy));
    });
    parts.push(`<g data-ground="1">${g.join("")}</g>`);
  }

  // Node labels.
  for (const n of d.nodeLabels) {
    parts.push(text(px(n.at[0]) - 0.3 * u, py(n.at[1]) - 0.3 * u, n.node, "end", true));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="0 0 ${num(width)} ${num(height)}">` +
    `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#fff"/>` +
    `<g fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    parts.join("") +
    `</g></svg>`
  );
}
