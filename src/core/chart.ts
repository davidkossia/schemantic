/**
 * Draw a graph as an SVG chart: axes, ticks, gridlines, labels, line and bar series.
 *
 * Pure and deterministic. Runs in the browser too, so it uses no Node APIs.
 */
import type { Axis, Graph, Series } from "./schema";

export type ChartOptions = { width: number; height: number };

const FONT = "Helvetica, Arial, sans-serif";
const MAX_TICKS = 12;
const BAR_FRACTION = 0.6;
const SERIES_COLORS = ["#1f5fbf", "#c2410c", "#15803d", "#7c3aed"];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

function num(n: number): string {
  const r = Math.round(finite(n, 0) * 100) / 100;
  return String(r === 0 ? 0 : r);
}

function tickText(v: number): string {
  const r = Number(v.toFixed(10));
  return String(r === 0 ? 0 : r);
}

/**
 * The smallest step of 1, 2 or 5 times a power of ten that gives at most 12 ticks over the range.
 * A range of 5 or more never gets a fractional step, so a month axis from 1 to 6 does not tick at 1.5.
 */
export function tickStep(min: number, max: number): number {
  const range = max - min;
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const start = Math.floor(Math.log10(range)) - 2;
  for (let e = start; e < start + 10; e++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      if (step < 1 && range >= 5) continue;
      if (Math.floor(range / step + 1e-9) + 1 <= MAX_TICKS) return step;
    }
  }
  return range;
}

/** Tick values from the first multiple of `step` at or above `min`, up to `max`. */
export function ticks(min: number, max: number): number[] {
  const step = tickStep(min, max);
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  for (let i = first; i * step <= max + step * 1e-9; i++) out.push(Number((i * step).toFixed(10)));
  return out;
}

function axisTitle(a: Axis): string {
  return a.unit ? `${a.label} (${a.unit})` : a.label;
}

function safeAxis(a: Axis): { min: number; max: number } {
  const min = finite(a.min, 0);
  const max = finite(a.max, min + 1);
  return max > min ? { min, max } : { min, max: min + 1 };
}

export function renderChart(g: Graph, options: ChartOptions): string {
  const width = Math.max(1, Math.round(finite(options.width, 1200)));
  const height = Math.max(1, Math.round(finite(options.height, 800)));

  const tickFs = height / 34;
  const titleFs = height / 26;
  const axisFs = height / 30;

  const xa = safeAxis(g.x);
  const ya = safeAxis(g.y);
  const xStep = tickStep(xa.min, xa.max);
  const xTicks = ticks(xa.min, xa.max);
  const yTicks = ticks(ya.min, ya.max);

  // Bars sit centred on their x. Pad the x domain by half a step so the first and last bars stay in the plot.
  const hasBars = g.series.some((s) => s.kind === "bar");
  const pad = hasBars ? xStep * 0.5 : 0;
  const dMin = xa.min - pad;
  const dMax = xa.max + pad;

  const yLabelChars = Math.max(1, ...yTicks.map((t) => tickText(t).length));
  const left = Math.round(axisFs * 2.4 + yLabelChars * tickFs * 0.62 + tickFs);
  const right = Math.round(width * 0.03);
  const top = Math.round(g.title ? titleFs * 2 : tickFs * 1.5);
  const bottom = Math.round(tickFs * 2.2 + axisFs * 1.8);
  const pw = Math.max(1, width - left - right);
  const ph = Math.max(1, height - top - bottom);

  const px = (x: number): number => left + ((finite(x, dMin) - dMin) / (dMax - dMin)) * pw;
  const py = (y: number): number => top + ph - ((finite(y, ya.min) - ya.min) / (ya.max - ya.min)) * ph;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  const text = (x: number, y: number, s: string, size: number, anchor: string, extra = ""): string =>
    `<text x="${num(x)}" y="${num(y)}" font-family="${FONT}" font-size="${num(size)}" text-anchor="${anchor}" fill="#000000"${extra}>${esc(s)}</text>`;

  if (g.title) out.push(text(left + pw / 2, titleFs * 1.2, g.title, titleFs, "middle", ' font-weight="bold"'));

  // Gridlines and tick labels.
  for (const t of xTicks) {
    const x = px(t);
    out.push(`<line x1="${num(x)}" y1="${num(top)}" x2="${num(x)}" y2="${num(top + ph)}" stroke="#d9d9d9" stroke-width="1"/>`);
    out.push(text(x, top + ph + tickFs * 1.5, tickText(t), tickFs, "middle"));
  }
  for (const t of yTicks) {
    const y = py(t);
    out.push(`<line x1="${num(left)}" y1="${num(y)}" x2="${num(left + pw)}" y2="${num(y)}" stroke="#d9d9d9" stroke-width="1"/>`);
    out.push(text(left - tickFs * 0.6, y + tickFs * 0.35, tickText(t), tickFs, "end"));
  }

  // Series.
  const base = Math.min(Math.max(0, ya.min), ya.max);
  const barWidth = (BAR_FRACTION * xStep * pw) / (dMax - dMin);
  g.series.forEach((s: Series, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length] ?? "#1f5fbf";
    if (s.kind === "bar") {
      for (const p of s.points) {
        const y1 = py(p.y);
        const y0 = py(base);
        out.push(
          `<rect x="${num(px(p.x) - barWidth / 2)}" y="${num(Math.min(y0, y1))}" width="${num(barWidth)}" height="${num(Math.abs(y0 - y1))}" fill="${color}" stroke="#000000" stroke-width="1"/>`,
        );
      }
      return;
    }
    if (s.points.length > 1) {
      const pts = s.points.map((p) => `${num(px(p.x))},${num(py(p.y))}`).join(" ");
      out.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`);
    }
    for (const p of s.points) {
      out.push(`<circle cx="${num(px(p.x))}" cy="${num(py(p.y))}" r="${num(Math.max(3, height / 130))}" fill="${color}"/>`);
    }
  });

  // Axes on top of the data.
  out.push(`<line x1="${num(left)}" y1="${num(top)}" x2="${num(left)}" y2="${num(top + ph)}" stroke="#000000" stroke-width="2"/>`);
  out.push(`<line x1="${num(left)}" y1="${num(top + ph)}" x2="${num(left + pw)}" y2="${num(top + ph)}" stroke="#000000" stroke-width="2"/>`);

  // Axis titles.
  out.push(text(left + pw / 2, height - axisFs * 0.5, axisTitle(g.x), axisFs, "middle"));
  const yx = axisFs * 1.1;
  const yy = top + ph / 2;
  out.push(text(yx, yy, axisTitle(g.y), axisFs, "middle", ` transform="rotate(-90 ${num(yx)} ${num(yy)})"`));

  // A legend only when there is more than one series to tell apart.
  if (g.series.length > 1) {
    g.series.forEach((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length] ?? "#1f5fbf";
      const ly = top + tickFs * 1.4 + i * tickFs * 1.5;
      const lx = left + pw - tickFs * 8;
      out.push(`<line x1="${num(lx)}" y1="${num(ly - tickFs * 0.3)}" x2="${num(lx + tickFs * 1.6)}" y2="${num(ly - tickFs * 0.3)}" stroke="${color}" stroke-width="5"/>`);
      out.push(text(lx + tickFs * 2, ly, s.name, tickFs, "start"));
    });
  }

  out.push("</svg>");
  return out.join("\n");
}
