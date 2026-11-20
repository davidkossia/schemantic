import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// 9 / (100 + 220 + 130)
const FORMULA = "9 / (100 + 220 + 130)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "9 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "100 Ω", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "220 Ω", a: [6, 3], b: [8, 3] },
    { id: "R3", type: "resistor", label: "130 Ω", a: [10, 3], b: [10, 5] },
  ],
  wires: [
    { node: "A", points: [[2, 3], [3, 3]] },
    { node: "gnd", points: [[2, 5], [10, 5]] },
    { node: "B", points: [[5, 3], [6, 3]] },
    { node: "C", points: [[8, 3], [10, 3]] },
  ],
  groundAt: [6, 5],
  nodeLabels: [
    { node: "A", at: [3, 3] },
    { node: "B", at: [6, 3] },
    { node: "C", at: [10, 3] },
  ],
};

const QUESTION = "What current flows through R2, from node B to node C?";

export const problem: Problem = {
  id: "c02",
  title: "Series loop",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "9 V", 9, "A", "gnd"),
        part("R1", "resistor", "100 Ω", 100, "A", "B"),
        part("R2", "resistor", "220 Ω", 220, "B", "C"),
        part("R3", "resistor", "130 Ω", 130, "C", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "R2" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "branch_current", component: "R2", setup: { remove: [], zero: [] }, value: 0.02 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
