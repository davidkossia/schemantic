import { DEFAULT_STYLE, type Drawing } from "../../src/core/schematic";
import { GRID_COLS, GRID_ROWS, part, positioned, type Problem } from "../types";

// 1000 + (6000 ∥ (2000 + 4000))
const FORMULA = "1000 + (6000 ∥ (2000 + 4000))";

const drawing: Drawing = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  components: [
    { id: "V1", type: "voltage_source", label: "8 V", a: [2, 3], b: [2, 5] },
    { id: "R1", type: "resistor", label: "1k0", a: [3, 3], b: [5, 3] },
    { id: "R2", type: "resistor", label: "6k0", a: [6, 3], b: [6, 5] },
    { id: "R3", type: "resistor", label: "2k0", a: [7, 3], b: [9, 3] },
    { id: "R4", type: "resistor", label: "4k0", a: [10, 3], b: [10, 5] },
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

const QUESTION = "What equivalent resistance does the source V1 see?";

export const problem: Problem = {
  id: "c13",
  title: "Equivalent resistance",
  question: QUESTION,
  truth: positioned(
    {
      kind: "circuit",
      components: [
        part("V1", "voltage_source", "8 V", 8, "A", "gnd"),
        part("R1", "resistor", "1k0", 1000, "A", "B"),
        part("R2", "resistor", "6k0", 6000, "B", "gnd"),
        part("R3", "resistor", "2k0", 2000, "B", "C"),
        part("R4", "resistor", "4k0", 4000, "C", "gnd"),
      ],
      ground: "gnd",
      asked: { summary: QUESTION, target: "A" },
      notes: null,
    },
    drawing,
  ),
  expected: { kind: "equivalent_resistance", a: "A", b: "gnd", remove: ["V1"], value: 4000 },
  multiStep: true,
  drawing,
  style: { ...DEFAULT_STYLE, resistor: "box" },
  formula: FORMULA,
};
