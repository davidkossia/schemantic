import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// Nodal at B: (V_B − 10) + V_B + (V_B − 4) = 0, V_B = 14/3; P = 10 × (10 − V_B) / 1000
const FORMULA = "Nodal at B: (V_B − 10) + V_B + (V_B − 4) = 0, V_B = 14/3; P = 10 × (10 − V_B) / 1000";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "10 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "1 kΩ", a: [3, 3], b: [5, 3] },
    { id: "R3", type: "resistor", label: "1 kΩ", a: [6, 3], b: [6, 5] },
    { id: "R2", type: "resistor", label: "1 kΩ", a: [7, 3], b: [9, 3] },
    { id: "V2", type: "voltage_source", label: "4 V", a: [10, 3], b: [10, 5] },
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

const QUESTION = "How much power does V1 deliver?";

export const problem: Problem = {
  id: "c08",
  title: "Two voltage sources",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "10 V", 10, "A", "gnd"),
        part("R1", "resistor", "1 kΩ", 1000, "A", "B"),
        part("R3", "resistor", "1 kΩ", 1000, "B", "gnd"),
        part("R2", "resistor", "1 kΩ", 1000, "B", "C"),
        part("V2", "voltage_source", "4 V", 4, "C", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "V1" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "power", component: "V1", sense: "delivered", setup: { remove: [], zero: [] }, value: 0.0533333 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
