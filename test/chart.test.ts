import { describe, expect, it } from "vitest";
import { renderChart, tickStep, ticks } from "../src/core/chart";
import type { Graph } from "../src/core/schema";
import { GRAPHS } from "./fixtures/graphs";

const SIZE = { width: 1200, height: 800 };

function graphOf(id: string): Graph {
  const g = GRAPHS[id];
  if (g === undefined) throw new Error(`missing fixture ${id}`);
  return g;
}

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

describe("renderChart", () => {
  for (const id of ["g01", "g02", "g03", "g04"]) {
    it(`draws ${id} as one svg with axis labels and no NaN`, () => {
      const g = graphOf(id);
      const svg = renderChart(g, SIZE);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(count(svg, "<svg")).toBe(1);
      expect(svg).toContain(`>${g.x.unit ? `${g.x.label} (${g.x.unit})` : g.x.label}</text>`);
      expect(svg).toContain(`>${g.y.label} (${g.y.unit})</text>`);
      for (const bad of ["NaN", "undefined", "Infinity"]) expect(svg).not.toContain(bad);
    });
  }

  it("draws 5 point markers for g01 and a polyline", () => {
    const svg = renderChart(graphOf("g01"), SIZE);
    expect(count(svg, "<circle")).toBe(5);
    expect(count(svg, "<polyline")).toBe(1);
    expect(count(svg, "<rect")).toBe(1); // the background
  });

  it("draws 6 bars for g04 besides the background, and no circles", () => {
    const svg = renderChart(graphOf("g04"), SIZE);
    expect(count(svg, "<rect")).toBe(7);
    expect(count(svg, "<circle")).toBe(0);
  });

  it("makes each bar 0.6 of the tick step wide", () => {
    const svg = renderChart(graphOf("g04"), SIZE);
    const widths = [...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="([^"]+)"/g)].map((m) => Number(m[1]));
    const [first, second] = widths;
    expect(widths).toHaveLength(6);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    // x step 1 over a padded domain of 6 units across the plot area: 0.6 of the pixels per unit.
    const xs = [...svg.matchAll(/<rect x="([^"]+)" y="[^"]+" width="[^"]+"/g)].map((m) => Number(m[1]) + (first ?? 0) / 2);
    const perUnit = ((xs[1] ?? 0) - (xs[0] ?? 0));
    expect(first).toBeCloseTo(0.6 * perUnit, 0);
  });

  it("prints the title when set, and escapes text", () => {
    const g: Graph = { ...graphOf("g01"), title: "Speed <fast> & \"slow\"", x: { ...graphOf("g01").x, label: "t & <u>" } };
    const svg = renderChart(g, SIZE);
    expect(svg).toContain("Speed &lt;fast&gt; &amp; &quot;slow&quot;");
    expect(svg).toContain("t &amp; &lt;u&gt; (s)");
    expect(svg).not.toContain("<fast>");
  });

  it("prints a tick value for every tick", () => {
    const svg = renderChart(graphOf("g01"), SIZE);
    for (const t of ticks(0, 10)) expect(svg).toContain(`>${t}</text>`);
    for (const t of ticks(0, 20)) expect(svg).toContain(`>${t}</text>`);
  });

  it("is deterministic and survives empty or degenerate graphs", () => {
    const g = graphOf("g02");
    expect(renderChart(g, SIZE)).toBe(renderChart(g, SIZE));
    const empty: Graph = { ...g, series: [], x: { ...g.x, min: 3, max: 3 }, y: { ...g.y, min: Number.NaN, max: 1 } };
    const svg = renderChart(empty, SIZE);
    for (const bad of ["NaN", "undefined", "Infinity"]) expect(svg).not.toContain(bad);
  });

  it("adds a legend only for more than one series", () => {
    const g = graphOf("g01");
    const first = g.series[0];
    if (!first) throw new Error("no series");
    const two: Graph = { ...g, series: [first, { ...first, id: "s2", name: "second" }] };
    expect(renderChart(two, SIZE)).toContain(">second</text>");
    expect(renderChart(g, SIZE)).not.toContain(">s1</text>");
  });
});

describe("ticks", () => {
  it("picks a step of 1, 2 or 5 times a power of ten with at most 12 ticks", () => {
    expect(tickStep(0, 10)).toBe(1);
    expect(tickStep(0, 20)).toBe(2);
    expect(tickStep(0, 35)).toBe(5);
    expect(tickStep(0, 12)).toBe(2);
    expect(tickStep(0, 0.5)).toBeCloseTo(0.05);
    expect(tickStep(0, 1000)).toBe(100);
    for (const [min, max] of [[0, 7], [0, 13], [-50, 50], [1, 6], [0, 0.003], [0, 99999]] as const) {
      const step = tickStep(min, max);
      expect(ticks(min, max).length).toBeLessThanOrEqual(12);
      expect(step).toBeGreaterThan(0);
    }
  });

  it("lists ticks from the first multiple inside the range", () => {
    expect(ticks(1, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ticks(0, 20)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(ticks(-3, 3)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });
});
