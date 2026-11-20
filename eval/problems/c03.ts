import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// V_B = 10 × 50 / (50 + 50) with R2 ∥ R3 = 50; P = V_B² / 100
const FORMULA = "V_B = 10 × 50 / (50 + 50) with R2 ∥ R3 = 50; P = V_B² / 100";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "10 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "50 Ω", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "100 Ω", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "100 Ω", a: [10, 3], b: [10, 5] },
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

const QUESTION = "How much power does R2 dissipate?";

export const problem: Problem = {
  id: "c03",
  title: "Parallel resistors",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "10 V", 10, "A", "gnd"),
        part("R1", "resistor", "50 Ω", 50, "A", "B"),
        part("R2", "resistor", "100 Ω", 100, "B", "gnd"),
        part("R3", "resistor", "100 Ω", 100, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "R2" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "power", component: "R2", sense: "absorbed", setup: { remove: [], zero: [] }, value: 0.25 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
