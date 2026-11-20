import { DEFAULT_STYLE } from "../../src/core/schematic";
import type { Problem } from "../types";

const QUESTION = "What is the position at t = 4 s?";

export const problem: Problem = {
  id: "g01",
  title: "Position at a time",
  question: QUESTION,
  truth: {
    kind: "graph",
    title: null,
    x: { label: "time", unit: "s", min: 0, max: 10 },
    y: { label: "position", unit: "m", min: 0, max: 20 },
    series: [{ id: "s1", name: "s1", kind: "line", points: [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: 10 }, { x: 8, y: 10 }, { x: 10, y: 16 }] }],
    asked: { summary: QUESTION, target: null },
    notes: null,
  },
  expected: { kind: "graph_value", series: "s1", x: 4, value: 8 },
  multiStep: false,
  drawing: null,
  style: DEFAULT_STYLE,
  formula: "4 + (10 − 4) × (4 − 2) / (5 − 2)",
};
