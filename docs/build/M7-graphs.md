# M7: graphs (WP-26 to WP-29)

Read [README.md](README.md) first. The graph schemas, queries and claims already exist from WP-01. These packages add the behaviour.

---

## WP-26: Graph core

**Goal.** Graph math, and graph support in the measurement, checker and tool code.

**Read.** CONTRACTS.md sections 2 ("What each query means") and 4. PROBLEMS.md ("Graphs").

**Files.**
- `src/core/graph.ts` (replace the placeholder)
- `src/core/measure.ts` (the graph branch only)
- `src/core/tools.ts` (`graph_query` only)
- `test/graph.test.ts` (new)
- `test/fixtures/graphs.ts` (new)

**Spec.**

```ts
export type GraphError = { code: "out_of_range" | "unknown_series" | "wrong_kind"; message: string };
export function findSeries(g: Graph, id: string): Result<Series, GraphError>;
export function valueAt(s: Series, x: number): Result<number, GraphError>;
export function slope(s: Series, x1: number, x2: number): Result<number, GraphError>;
export function area(s: Series, x1: number, x2: number): Result<number, GraphError>;
export function extremum(s: Series, which: "max" | "min"): Result<{ x: number; y: number }, GraphError>;
```

- `valueAt`, line: linear interpolation between the neighbouring points. An `x` before the first point or after the last gives `out_of_range`. Bar: the `y` of the point whose `x` is `closeTo` the query. No such point gives `out_of_range`.
- `slope`: line only, otherwise `wrong_kind`. `x1 === x2` gives `out_of_range`. The result is `(valueAt(x2) − valueAt(x1)) / (x2 − x1)`.
- `area`: line only. Needs `x1 < x2`, both in range. Sum the trapezoids between `x1`, every key point strictly between, and `x2`. Area under the axis counts as negative.
- `extremum`: over the key points. On a tie, the smallest `x`.
- `measure` for the four graph kinds returns values with the names from the claim table (`value`, and `x` then `value` for `graph_extremum`), unit `""`, and `residuals: null`. Map `GraphError` codes to `MeasureError` codes, with `wrong_kind` as `wrong_structure`.
- `graph_query` returns `{ ok: true, value, x }`, where `x` is null except for `extremum`. For `value`, `x1` is the query point. A missing field the op needs is an error.
- `checkClaim` needs no change: it already goes through `measure`.

`test/fixtures/graphs.ts` exports `GRAPHS`, a record from `g01` to `g04` to a `Graph` copied from PROBLEMS.md.

**Tests.**
- The four expected answers from PROBLEMS.md through `measure`, and the four expected claims through `checkClaim` (verified).
- `valueAt` on `g01`: at 0 gives 0; at 10 gives 16; at 6.5 gives 10; at 11 gives `out_of_range`.
- `slope` on `g02` from 0 to 4 gives 3. Across two corners, from 2 to 10, it gives 0.25 (the values are 8 and 10).
- `area` on `g03` from 1 to 7 gives 33 (the trapezoids: 1 to 2 is 4.5, 2 to 6 is 24, 6 to 7 is 4.5).
- `area` of a series that dips under zero counts the dip as negative.
- `extremum` min on `g04` gives x 1, value 12. A tie returns the smaller x.
- `valueAt` on the bar series at 3 gives 25, and at 3.5 gives `out_of_range`.
- `slope` on a bar series gives `wrong_kind`.
- `graph_query` through the tool runner for each op.
- The mutations from WP-06 (×1.05, negated, ×1000) applied to each claimed number of the four graph claims: every one is rejected.

**Done when.** The tests pass.

---

## WP-27: Chart renderer and graph problems

**Goal.** Draw graphs, add the four graph problems, and score graph readings.

**Files.**
- `src/core/chart.ts` (new)
- `eval/problems/g01.ts` to `g04.ts` (new), `eval/problems/index.ts` (add them)
- `eval/render.ts` (render charts too)
- `eval/score.ts` (add `scoreGraph`)
- `eval/images/g0*.svg`, `eval/images/g0*.png`, `web/public/samples/g01.png` (generated)
- `test/chart.test.ts` (new), `test/score.test.ts` and `test/problems.test.ts` (add graph cases)

**Spec.**

`renderChart(g: Graph, options: { width: number; height: number }): string`:
- One `<svg>` with a white background, a plot area with margins for labels, and black axes.
- Ticks: choose a step from 1, 2 or 5 times a power of ten that gives at most 12 ticks per axis. Light gridlines at each tick, with the tick value printed.
- Axis titles: the label, with the unit in parentheses when there is one. The graph title on top when set.
- A line series is a polyline with a small filled circle at each key point. A bar series is one rectangle per point, 0.6 of the tick step wide.
- Escape all text. No `NaN` in the output. Pure and deterministic.

Graph problems follow the `Problem` type with `drawing: null`. `truth` is the graph from PROBLEMS.md, and `expected` its claim. `eval/render.ts` renders them with `renderChart` at 1200 by 800.

```ts
export type GraphScore = { truthCount: number; readCount: number; matched: number; recall: number; precision: number; exact: boolean };
export function scoreGraph(truth: Graph, read: Graph): GraphScore;
```

- Pair series by order. A truth series with no partner counts all its points as unmatched.
- A truth point matches a read point of the paired series when `|dx|` is at most 2% of the truth x-axis range and `|dy|` is at most 2% of the truth y-axis range. Each read point matches at most once.
- Counts are over all points of all series.

**Tests.**
- `renderChart` for each of the four graphs: starts with `<svg`, holds the axis labels, has no `NaN`, has 5 point markers for `g01` and 6 `<rect` bars for `g04` (besides the background).
- `scoreGraph` of each graph against itself is exact.
- `g01` with one point moved by 1% of the range still matches. Moved by 5%, it does not.
- `g01` with one point missing in the read: recall 4/5, precision 1.
- `PROBLEMS` has 18 entries and `runCore` verifies all 18.

**Done when.** The tests pass, `npm run render` writes the four chart images, and you have looked at all four PNGs and confirmed the axes, ticks, labels and data are readable.

---

## WP-28: Graph review UI

**Goal.** The human check for a graph.

**Files.**
- `web/src/components/GraphReview.tsx`, `web/src/components/PointsTable.tsx` (new)
- `web/src/components/ReviewPanel.tsx` (replace the graph placeholder)
- `web/src/edit.ts` (add graph edit functions), `test/web-edit.test.ts` (add cases)

**Spec.**
1. The uploaded image and the replot (`renderChart` of the current structure) show side by side. On a phone they stack.
2. `PointsTable`: one section per series with its name, its kind, and an editable row per point (`x`, `y`). Buttons add and remove a point. Points re-sort by `x` after each edit.
3. Axis fields: label, unit, min and max for each axis.
4. Each edit calls `onEdit` with a new structure, so the replot and the warnings update at once.
5. Pure edit functions in `web/src/edit.ts`: `setPoint`, `addPoint`, `removePoint`, `setAxis`. Each returns a new `Graph`.
6. The Approve button behaves as it does for circuits.

**Tests.** The four edit functions: a correct result, re-sorting after `setPoint`, and no mutation of the input.

**Done when.** The tests pass. In the browser, with the `g01` replay sample from WP-29 (or a hand-made fixture until then): editing a point moves it on the replot, and an unsorted or empty series blocks Approve.

---

## WP-29: Graph reading and replay sample

**Goal.** Graphs work end to end, in replay and live.

**Needs the API key** for the live step.

**Files.**
- `fixtures/replay/g01.ts`, `fixtures/replay/index.ts`
- `src/agents/scripted.ts` (graph procedures)
- `src/agents/prompts.ts` (only if the live step shows a gap)
- `test/scripted.test.ts` (add graph cases)

**Spec.**
1. The `g01` fixture: the truth graph with one misread, the point (5, 10) read as (5, 12). No validator warning fires. The user finds it by comparing the replot with the image.
2. Scripted procedures for the four graph query kinds: one `graph_query` call, then `submit_answer`.
3. Run `npm run smoke g01` and `npm run smoke g03`. Extend `eval/smoke.ts` to print `scoreGraph` for a graph problem.
4. If the reader misreads the graph in a way the prompt could prevent, adjust the graph section of `READER_SYSTEM` and run the smoke again. Change the prompt at most twice. Report what changed and why.

**Tests.** The scripted client solves `g01` on the corrected structure with the claim value 8. On the uncorrected reading it gives 9.33 (4 + 2/3 of the way from 4 to 12), and the checker verifies that against the uncorrected structure.

**Done when.** The tests pass, the `g01` replay session works in the browser, and you report the two smoke runs: parse score, claim, verified or not, tokens and cost.
