import { DEFAULT_STYLE } from "../../src/core/schematic";
import type { Problem } from "../types";

const QUESTION = "Which month has the highest sales, and how many units?";

export const problem: Problem = {
  id: "g04",
  title: "Highest bar",
  question: QUESTION,
  truth: {
    kind: "graph",
    title: null,
    x: { label: "month", unit: null, min: 1, max: 6 },
    y: { label: "sales", unit: "units", min: 0, max: 35 },
    series: [{ id: "s1", name: "s1", kind: "bar", points: [{ x: 1, y: 12 }, { x: 2, y: 18 }, { x: 3, y: 25 }, { x: 4, y: 31 }, { x: 5, y: 22 }, { x: 6, y: 15 }] }],
    asked: { summary: QUESTION, target: null },
    notes: null,
  },
  expected: { kind: "graph_extremum", series: "s1", which: "max", x: 4, value: 31 },
  multiStep: false,
  drawing: null,
  style: DEFAULT_STYLE,
  formula: "max(12, 18, 25, 31, 22, 15) = 31, at month 4",
};
