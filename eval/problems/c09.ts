import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// vth = 12 × 12000 / 16000; rth = 1000 + (4000 ∥ 12000)
const FORMULA = "vth = 12 × 12000 / 16000; rth = 1000 + (4000 ∥ 12000)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "12 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "4 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "12 kΩ", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "1 kΩ", a: [7, 3], b: [9, 3] },
    { id: "RL", type: "resistor", label: "2 kΩ", a: [10, 3], b: [10, 5] },
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

const QUESTION = "What is the Thevenin equivalent that RL sees?";

export const problem: Problem = {
  id: "c09",
  title: "Thevenin equivalent",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "12 V", 12, "A", "gnd"),
        part("R1", "resistor", "4 kΩ", 4000, "A", "B"),
        part("R2", "resistor", "12 kΩ", 12000, "B", "gnd"),
        part("R3", "resistor", "1 kΩ", 1000, "B", "C"),
        part("RL", "resistor", "2 kΩ", 2000, "C", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "C" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "thevenin", a: "C", b: "gnd", remove: ["RL"], vth: 9, rth: 4000 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
