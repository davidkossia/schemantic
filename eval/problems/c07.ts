import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// Nodal at B: (V_B − 12)/2000 + V_B/2000 = 0.003
const FORMULA = "Nodal at B: (V_B − 12)/2000 + V_B/2000 = 0.003";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "12 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "2 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "2 kΩ", a: [6, 3], b: [6, 5] },
    { id: "I1", type: "current_source", label: "3 mA", a: [10, 3], b: [10, 5] },
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

const QUESTION = "What is the voltage at node B?";

export const problem: Problem = {
  id: "c07",
  title: "Voltage and current source",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "12 V", 12, "A", "gnd"),
        part("R1", "resistor", "2 kΩ", 2000, "A", "B"),
        part("R2", "resistor", "2 kΩ", 2000, "B", "gnd"),
        part("I1", "current_source", "3 mA", 0.003, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "B" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "node_voltage", node: "B", setup: { remove: [], zero: [] }, value: 9 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
