import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// R_B / (10000 + R_B) = 9/15 gives R_B = 15000; R2 ∥ 30000 = 15000 gives R2 = 30000
const FORMULA = "R_B / (10000 + R_B) = 9/15 gives R_B = 15000; R2 ∥ 30000 = 15000 gives R2 = 30000";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "15 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "10 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "10 kΩ", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "30 kΩ", a: [10, 3], b: [10, 5] },
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

const QUESTION = "R2 is adjustable. What value of R2 makes the voltage at node B equal 9 V?";

export const problem: Problem = {
  id: "c11",
  title: "Find a resistor for a voltage",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "15 V", 15, "A", "gnd"),
        part("R1", "resistor", "10 kΩ", 10000, "A", "B"),
        part("R2", "resistor", "10 kΩ", 10000, "B", "gnd"),
        part("R3", "resistor", "30 kΩ", 30000, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "R2" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "component_value_for_condition", component: "R2", condition: { kind: "node_voltage", target: "B", value: 9 }, value: 30000 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
