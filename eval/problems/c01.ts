import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// 12 × 2000 / (1000 + 2000)
const FORMULA = "12 × 2000 / (1000 + 2000)";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "12 V", a: [4, 3], b: [4, 5] },
    { id: "R1", type: "resistor", label: "1 kΩ", a: [5, 3], b: [7, 3] },
    { id: "R2", type: "resistor", label: "2 kΩ", a: [8, 3], b: [8, 5] },
  ],
  wires: [
    { node: "A", points: [[4, 3], [5, 3]] },
    { node: "gnd", points: [[4, 5], [8, 5]] },
    { node: "B", points: [[7, 3], [8, 3]] },
  ],
  groundAt: [6, 5],
  nodeLabels: [
    { node: "A", at: [5, 3] },
    { node: "B", at: [8, 3] },
  ],
};

const QUESTION = "What is the voltage at node B?";

export const problem: Problem = {
  id: "c01",
  title: "Voltage divider",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "12 V", 12, "A", "gnd"),
        part("R1", "resistor", "1 kΩ", 1000, "A", "B"),
        part("R2", "resistor", "2 kΩ", 2000, "B", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "B" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "node_voltage", node: "B", setup: { remove: [], zero: [] }, value: 8 },
  multiStep: false,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "zigzag" },
  formula: FORMULA,
};
