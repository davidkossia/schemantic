import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// With V1 shorted: 0.002 × (3000 ∥ 6000)
const FORMULA = "With V1 shorted: 0.002 × (3000 ∥ 6000)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "18V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "3k", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "6k", a: [6, 3], b: [6, 5] },
    { id: "I1", type: "current_source", label: "2mA", a: [10, 3], b: [10, 5] },
  ],
  wires: [
    { node: "A", points: [[2, 3], [3, 3]] },
    { node: "gnd", points: [[2, 5], [6, 5]] },
    { node: "gnd", points: [[6, 5], [10, 5]] },
    { node: "B", points: [[5, 3], [6, 3]] },
    { node: "B", points: [[6, 3], [10, 3]] },
  ],
  groundAt: [4, 5],
  nodeLabels: [
    { node: "A", at: [3, 3] },
    { node: "B", at: [10, 3] },
  ],
};

const QUESTION = "How much of the voltage at node B is due to the current source I1 alone?";

export const problem: Problem = {
  id: "c12",
  title: "Superposition",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "18V", 18, "A", "gnd"),
        part("R1", "resistor", "3k", 3000, "A", "B"),
        part("R2", "resistor", "6k", 6000, "B", "gnd"),
        part("I1", "current_source", "2mA", 0.002, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "B" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "node_voltage", node: "B", setup: { remove: [], zero: ["V1"] }, value: 4 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
