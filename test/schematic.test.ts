import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, renderDrawing, type Drawing } from "../src/core/schematic";

// c01: source at the left, R1 on top, R2 on the right.
function c01(): Drawing {
  return {
    cols: 6,
    rows: 4,
    components: [
      { id: "V1", type: "voltage_source", label: "12 V", a: [1, 1], b: [1, 3] },
      { id: "R1", type: "resistor", label: "1 kΩ", a: [2, 1], b: [4, 1] },
      { id: "R2", type: "resistor", label: "2 kΩ", a: [5, 1], b: [5, 3] },
    ],
    wires: [
      { node: "A", points: [[1, 1], [2, 1]] },
      { node: "B", points: [[4, 1], [5, 1]] },
      { node: "gnd", points: [[1, 3], [5, 3]] },
    ],
    groundAt: [3, 3],
    nodeLabels: [{ node: "B", at: [5, 1] }],
  };
}

function group(svg: string, id: string): string {
  const start = svg.indexOf(`<g data-id="${id}"`);
  const end = svg.indexOf("</g>", start);
  return svg.slice(start, end);
}

describe("renderDrawing", () => {
  it("returns one complete svg element", () => {
    const svg = renderDrawing(c01(), DEFAULT_STYLE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 480 360"');
  });

  it("has one group per component and prints ids and labels", () => {
    const svg = renderDrawing(c01(), DEFAULT_STYLE);
    for (const id of ["V1", "R1", "R2"]) {
      expect(svg.split(`data-id="${id}"`).length - 1).toBe(1);
    }
    expect(svg).toContain(">R1</text>");
    expect(svg).toContain(">1 kΩ</text>");
  });

  it("has no NaN, undefined or Infinity", () => {
    const svg = renderDrawing(c01(), DEFAULT_STYLE);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("draws a rect in the R1 group only with the box style", () => {
    const zig = renderDrawing(c01(), { resistor: "zigzag", unit: 60 });
    const box = renderDrawing(c01(), { resistor: "box", unit: 60 });
    expect(box).not.toBe(zig);
    expect(group(box, "R1")).toContain("<rect");
    expect(group(zig, "R1")).not.toContain("<rect");
  });

  it("draws exactly one dot at a three-way junction and none on a plain loop", () => {
    expect(renderDrawing(c01(), DEFAULT_STYLE)).not.toContain("data-junction");
    const d: Drawing = {
      cols: 6,
      rows: 4,
      components: [{ id: "R3", type: "resistor", label: "", a: [3, 1], b: [3, 3] }],
      wires: [{ node: "gnd", points: [[1, 3], [3, 3], [5, 3]] }],
      groundAt: null,
      nodeLabels: [],
    };
    const svg = renderDrawing(d, DEFAULT_STYLE);
    expect(svg.split("data-junction").length - 1).toBe(1);
  });

  it("escapes labels", () => {
    const d = c01();
    const r1 = d.components[1];
    if (r1) r1.label = '<b>&"';
    const svg = renderDrawing(d, DEFAULT_STYLE);
    expect(svg).toContain("&lt;b&gt;&amp;&quot;");
    expect(svg).not.toContain("<b>");
  });

  it("draws the source minus sign as a character, not an escaped entity", () => {
    const svg = renderDrawing(c01(), DEFAULT_STYLE);
    expect(svg).toContain("−");
    expect(svg).not.toContain("&amp;#");
  });

  it("is deterministic", () => {
    expect(renderDrawing(c01(), DEFAULT_STYLE)).toBe(renderDrawing(c01(), DEFAULT_STYLE));
  });
});
