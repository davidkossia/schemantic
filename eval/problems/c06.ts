import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// Nodal: 5 V_B − 2 V_C = 20, 5 V_C − 2 V_B = 10; V_B = 40/7, V_C = 30/7; I = (V_B − V_C) / 1000
const FORMULA = "Nodal: 5 V_B − 2 V_C = 20, 5 V_C − 2 V_B = 10; V_B = 40/7, V_C = 30/7; I = (V_B − V_C) / 1000";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "10 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "1 kΩ", a: [6, 2], b: [6, 4] },
    { id: "R2", type: "resistor", label: "2 kΩ", a: [6, 4], b: [6, 6] },
    { id: "R3", type: "resistor", label: "2 kΩ", a: [10, 2], b: [10, 4] },
    { id: "R4", type: "resistor", label: "1 kΩ", a: [10, 4], b: [10, 6] },
    { id: "R5", type: "resistor", label: "1 kΩ", a: [7, 4], b: [9, 4] },
  ],
  wires: [
    { node: "A", points: [[2, 3], [2, 2], [6, 2]] },
    { node: "A", points: [[6, 2], [10, 2]] },
    { node: "B", points: [[6, 4], [7, 4]] },
    { node: "C", points: [[9, 4], [10, 4]] },
    { node: "gnd", points: [[2, 5], [2, 6], [6, 6]] },
    { node: "gnd", points: [[6, 6], [10, 6]] },
  ],
  groundAt: [4, 6],
  nodeLabels: [
    { node: "A", at: [2, 2] },
    { node: "B", at: [6, 4] },
    { node: "C", at: [10, 4] },
  ],
};

const QUESTION = "What current flows through R5, from node B to node C?";

export const problem: Problem = {
  id: "c06",
  title: "Bridge",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "10 V", 10, "A", "gnd"),
        part("R1", "resistor", "1 kΩ", 1000, "A", "B"),
        part("R2", "resistor", "2 kΩ", 2000, "B", "gnd"),
        part("R3", "resistor", "2 kΩ", 2000, "A", "C"),
        part("R4", "resistor", "1 kΩ", 1000, "C", "gnd"),
        part("R5", "resistor", "1 kΩ", 1000, "B", "C"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "R5" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "branch_current", component: "R5", setup: { remove: [], zero: [] }, value: 0.00142857 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
