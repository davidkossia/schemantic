import { DEFAULT_STYLE } from "../../src/core/schematic";
import type { Problem } from "../types";

const QUESTION = "What is the acceleration between t = 8 s and t = 12 s?";

export const problem: Problem = {
  id: "g02",
  title: "Acceleration from a slope",
  question: QUESTION,
  truth: {
    kind: "graph",
    title: null,
    x: { label: "time", unit: "s", min: 0, max: 12 },
    y: { label: "velocity", unit: "m/s", min: 0, max: 16 },
    series: [{ id: "s1", name: "s1", kind: "line", points: [{ x: 0, y: 2 }, { x: 4, y: 14 }, { x: 8, y: 14 }, { x: 12, y: 6 }] }],
    asked: { summary: QUESTION, target: null },
    notes: null,
  },
  expected: { kind: "graph_slope", series: "s1", x1: 8, x2: 12, value: -2 },
  multiStep: false,
  drawing: null,
  style: DEFAULT_STYLE,
  formula: "(6 − 14) / (12 − 8)",
};
