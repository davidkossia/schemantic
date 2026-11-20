import type { Graph } from "../../src/core/schema";

type Pt = [number, number];

function graph(
  xAxis: { label: string; unit: string | null; min: number; max: number },
  yAxis: { label: string; unit: string | null; min: number; max: number },
  kind: "line" | "bar",
  points: Pt[],
  question: string,
): Graph {
  return {
    kind: "graph",
    title: null,
    x: xAxis,
    y: yAxis,
    series: [{ id: "s1", name: "s1", kind, points: points.map(([x, y]) => ({ x, y })) }],
    asked: { summary: question, target: null },
    notes: null,
  };
}

export const GRAPHS: Record<string, Graph> = {
  g01: graph(
    { label: "time", unit: "s", min: 0, max: 10 },
    { label: "position", unit: "m", min: 0, max: 20 },
    "line",
    [[0, 0], [2, 4], [5, 10], [8, 10], [10, 16]],
    "What is the position at t = 4 s?",
  ),
  g02: graph(
    { label: "time", unit: "s", min: 0, max: 12 },
    { label: "velocity", unit: "m/s", min: 0, max: 16 },
    "line",
    [[0, 2], [4, 14], [8, 14], [12, 6]],
    "What is the acceleration between t = 8 s and t = 12 s?",
  ),
  g03: graph(
    { label: "time", unit: "s", min: 0, max: 8 },
    { label: "velocity", unit: "m/s", min: 0, max: 8 },
    "line",
    [[0, 0], [2, 6], [6, 6], [8, 0]],
    "How far does the object travel between t = 0 s and t = 8 s?",
  ),
  g04: graph(
    { label: "month", unit: null, min: 1, max: 6 },
    { label: "sales", unit: "units", min: 0, max: 35 },
    "bar",
    [[1, 12], [2, 18], [3, 25], [4, 31], [5, 22], [6, 15]],
    "Which month has the highest sales, and how many units?",
  ),
};
