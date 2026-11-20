import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// vth = 20 × 3000 / 9000; rth = 6000 ∥ 3000; P = vth² / (4 × rth)
const FORMULA = "vth = 20 × 3000 / 9000; rth = 6000 ∥ 3000; P = vth² / (4 × rth)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "20 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "6 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "3 kΩ", a: [6, 3], b: [6, 5] },
    { id: "RL", type: "resistor", label: "1 kΩ", a: [10, 3], b: [10, 5] },
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

const QUESTION = "RL is adjustable. What value of RL receives the most power, and how much power is that?";

export const problem: Problem = {
  id: "c10",
  title: "Maximum power transfer",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "20 V", 20, "A", "gnd"),
        part("R1", "resistor", "6 kΩ", 6000, "A", "B"),
        part("R2", "resistor", "3 kΩ", 3000, "B", "gnd"),
        part("RL", "resistor", "1 kΩ", 1000, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "RL" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "max_power_transfer", load: "RL", resistance: 2000, power: 0.00555556 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
