import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// V_B = 24 − 0.009 × 2000 = 6; I_R3 = 0.009 − 6/4000 = 0.0075; R3 = 6 / 0.0075
const FORMULA = "V_B = 24 − 0.009 × 2000 = 6; I_R3 = 0.009 − 6/4000 = 0.0075; R3 = 6 / 0.0075";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "24 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "2 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "4 kΩ", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "1 kΩ", a: [10, 3], b: [10, 5] },
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

const QUESTION = "R3 is adjustable. What value of R3 makes the current through R1 equal 9 mA?";

export const problem: Problem = {
  id: "c14",
  title: "Find a resistor for a current",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "24 V", 24, "A", "gnd"),
        part("R1", "resistor", "2 kΩ", 2000, "A", "B"),
        part("R2", "resistor", "4 kΩ", 4000, "B", "gnd"),
        part("R3", "resistor", "1 kΩ", 1000, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "R3" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "component_value_for_condition", component: "R3", condition: { kind: "branch_current", target: "R1", value: 0.009 }, value: 800 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
