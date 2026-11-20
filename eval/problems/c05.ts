import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// R_B = 2000 ∥ (1000 + 1000) = 1000; V_B = 16 × 1000 / 2000 = 8; V_C = V_B / 2
const FORMULA = "R_B = 2000 ∥ (1000 + 1000) = 1000; V_B = 16 × 1000 / 2000 = 8; V_C = V_B / 2";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "16 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "1k0", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "2k0", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "1k0", a: [7, 3], b: [9, 3] },
    { id: "R4", type: "resistor", label: "1k0", a: [10, 3], b: [10, 5] },
  ],
  wires: [
    { node: "A", points: [[2, 3], [3, 3]] },
    { node: "gnd", points: [[2, 5], [6, 5]] },
    { node: "gnd", points: [[6, 5], [10, 5]] },
    { node: "B", points: [[5, 3], [6, 3]] },
    { node: "B", points: [[6, 3], [7, 3]] },
    { node: "C", points: [[9, 3], [10, 3]] },
  ],
  groundAt: [4, 5],
  nodeLabels: [
    { node: "A", at: [3, 3] },
    { node: "B", at: [7, 3] },
    { node: "C", at: [10, 3] },
  ],
};

const QUESTION = "What is the voltage at node C?";

export const problem: Problem = {
  id: "c05",
  title: "Two-stage divider",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "16 V", 16, "A", "gnd"),
        part("R1", "resistor", "1k0", 1000, "A", "B"),
        part("R2", "resistor", "2k0", 2000, "B", "gnd"),
        part("R3", "resistor", "1k0", 1000, "B", "C"),
        part("R4", "resistor", "1k0", 1000, "C", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "C" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "node_voltage", node: "C", setup: { remove: [], zero: [] }, value: 4 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
