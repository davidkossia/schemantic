import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// 0.002 × (1000 × 3000) / (1000 + 3000)
const FORMULA = "0.002 × (1000 × 3000) / (1000 + 3000)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "I1", type: "current_source", label: "2mA", a: [3, 3], b: [3, 5] },
    { id: "R1", type: "resistor", label: "1k", a: [6, 3], b: [6, 5] },
    { id: "R2", type: "resistor", label: "3k", a: [9, 3], b: [9, 5] },
  ],
  wires: [
    { node: "A", points: [[3, 3], [6, 3]] },
    { node: "A", points: [[6, 3], [9, 3]] },
    { node: "gnd", points: [[3, 5], [6, 5]] },
    { node: "gnd", points: [[6, 5], [9, 5]] },
  ],
  groundAt: [4, 5],
  nodeLabels: [
    { node: "A", at: [9, 3] },
  ],
};

const QUESTION = "What is the voltage at node A?";

export const problem: Problem = {
  id: "c04",
  title: "Current source with two resistors",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("I1", "current_source", "2mA", 0.002, "A", "gnd"),
        part("R1", "resistor", "1k", 1000, "A", "gnd"),
        part("R2", "resistor", "3k", 3000, "A", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "A" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "node_voltage", node: "A", setup: { remove: [], zero: [] }, value: 1.5 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
