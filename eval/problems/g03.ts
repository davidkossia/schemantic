import { DEFAULT_STYLE } from "../../src/core/schematic";
import type { Problem } from "../types";

const QUESTION = "How far does the object travel between t = 0 s and t = 8 s?";

export const problem: Problem = {
  id: "g03",
  title: "Distance from an area",
  question: QUESTION,
  truth: {
    kind: "graph",
    title: null,
    x: { label: "time", unit: "s", min: 0, max: 8 },
    y: { label: "velocity", unit: "m/s", min: 0, max: 8 },
    series: [{ id: "s1", name: "s1", kind: "line", points: [{ x: 0, y: 0 }, { x: 2, y: 6 }, { x: 6, y: 6 }, { x: 8, y: 0 }] }],
    asked: { summary: QUESTION, target: null },
    notes: null,
  },
  expected: { kind: "graph_area", series: "s1", x1: 0, x2: 8, value: 36 },
  multiStep: false,
  drawing: null,
  style: DEFAULT_STYLE,
  formula: "2 × 6 / 2 + 4 × 6 + 2 × 6 / 2",
};
