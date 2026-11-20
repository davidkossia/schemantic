# M3: renderer, problem files and scoring (WP-08 to WP-12)

Read [README.md](README.md) first.

---

## WP-08: Schematic renderer

**Goal.** Draw a circuit as an SVG string from an explicit drawing. The eval images and the review screen both use it.

**Read.** CONTRACTS.md section 1. PROBLEMS.md ("Drawing each circuit").

**Files.**
- `src/core/schematic.ts` (replace the placeholder)
- `test/schematic.test.ts` (new)

**Spec.**

```ts
export type GridPoint = [number, number];          // whole grid units. x grows right, y grows down.
export type DrawnComponent = {
  id: string;
  type: ComponentType;
  label: string;
  a: GridPoint;                                    // terminal a
  b: GridPoint;                                    // terminal b: exactly 2 units from a, on one axis
};
export type Wire = { node: string; points: GridPoint[] };   // each segment horizontal or vertical
export type NodeLabel = { node: string; at: GridPoint };
export type Drawing = {
  cols: number; rows: number;                      // grid size in units
  components: DrawnComponent[];
  wires: Wire[];
  groundAt: GridPoint | null;                      // where the ground symbol hangs
  nodeLabels: NodeLabel[];
};
export type Style = { resistor: "zigzag" | "box"; unit: number };   // unit: pixels per grid unit
export const DEFAULT_STYLE: Style = { resistor: "zigzag", unit: 60 };

export function renderDrawing(d: Drawing, style: Style): string;
```

1. Output one complete `<svg>` element with `xmlns`, a `viewBox` of `0 0 (cols+2)×unit (rows+2)×unit` (one unit of margin on every side), and a white background `<rect>`. Strokes are black, 2 px, with round line caps.
2. Wrap each component in `<g data-id="…" data-type="…">`. Wrap each wire in `<g data-node="…">`.
3. Each component spans 2 units. The symbol's body takes the middle unit. Straight leads take half a unit at each end.
   - `resistor`, zigzag: 6 peaks, 0.15 units high. Box: a rectangle 1 unit long and 0.3 units wide.
   - `voltage_source`: a circle of radius 0.4 units, with `+` inside near terminal `a` and `−` inside near terminal `b`.
   - `current_source`: a circle of radius 0.4 units with an arrow inside that points at terminal `a`.
   - `unknown`: a dashed box with `?` inside.
4. Text: the id and the label. For a horizontal component, the id goes above and the label below. For a vertical one, both go to the right, id over label. Font: `Helvetica, Arial, sans-serif`, 0.26 units. Skip an empty label.
5. Draw a filled dot of radius 0.07 units at every grid point where three or more ends meet. An end is a wire segment end or a component terminal. A wire's interior vertex counts as two ends, whether the wire turns there or runs straight through. A drawing must therefore give a wire a vertex at every point where another wire or a terminal joins it.
6. The ground symbol is three horizontal lines of shrinking width under `groundAt`, joined to it by a short vertical line.
7. A node label prints the node's name in bold, 0.3 units up and left of its point.
8. Escape `&`, `<`, `>` and `"` in every id, label and node name. User edits reach this function.
9. The function is pure. The same input gives the same string. Round coordinates to 2 decimals.

**Tests.** Build a drawing of `c01` by hand in the test (source at the left, R1 on top, R2 on the right).
- The output starts with `<svg` and ends with `</svg>`.
- It contains one `data-id` group for each of `V1`, `R1`, `R2`, and the texts `R1` and `1 kΩ`.
- It contains no `NaN`, `undefined` or `Infinity`.
- With `resistor: "box"` the output differs from `zigzag` and contains a `<rect` inside the `R1` group.
- A drawing with a three-way junction produces exactly one junction dot (`data-junction` attribute on the dot's `<circle>`). The plain `c01` loop produces none.
- A label of `<b>&"` appears escaped, and the raw string `<b>` does not appear.
- Two calls with the same input return identical strings.

**Done when.** The tests pass and the file imports only `./schema`.

---

## WP-09: Circuit problem files

**Goal.** The 14 circuit problems as data, each with a drawing.

**Read.** PROBLEMS.md in full. CONTRACTS.md section 2. `src/core/schematic.ts` for the `Drawing` type.

**Files.**
- `eval/types.ts` (new)
- `eval/problems/c01.ts` to `eval/problems/c14.ts` (new)
- `eval/problems/index.ts` (new)
- `test/problems.test.ts` (new)
- Delete `eval/problems/.gitkeep`.

**Spec.**

```ts
// eval/types.ts
export type Problem = {
  id: string;
  title: string;                 // short: "Voltage divider"
  question: string;              // exact text from PROBLEMS.md
  truth: Structure;              // ground truth, with pa and pb filled from the drawing
  expected: Claim;               // exact claim from PROBLEMS.md
  multiStep: boolean;            // c09 to c14 are true
  drawing: Drawing | null;       // circuits only
  style: Style;
  formula: string;               // the closed form from PROBLEMS.md
};
```

1. One file per problem. Each exports `problem: Problem`. `index.ts` exports `PROBLEMS: Problem[]` in id order.
2. Copy components, questions and expected claims exactly from PROBLEMS.md. Labels follow the "Styles and label formats" table.
3. Author each drawing on the fixed grid `cols: 12`, `rows: 8`, following the layout named for it and the five drawing rules. Every drawing uses this grid size, even when it does not fill it, because WP-20 inverts the position mapping with these numbers. Centre the circuit on the grid.
4. Derive `pa` and `pb` from the drawing in code, in one shared helper in `eval/types.ts`: `pa.x = (a[0] + 1) / (cols + 2)`, `pa.y = (a[1] + 1) / (rows + 2)`, and the same for `pb`. This matches the renderer's one-unit margin.
5. `truth.asked.summary` is the question. `truth.asked.target` is the node or component the expected claim names.

**Tests.** For every problem in `PROBLEMS`:
- `Structure.parse(truth)` and `Claim.parse(expected)` succeed.
- `validate(truth)` returns no warnings. This also proves each label parses to its value.
- `checkClaim(truth, expected).verified` is true.
- Every component in `truth` appears once in `drawing.components` with the same id, and its two terminals are exactly 2 units apart on one axis.
- Every wire segment is horizontal or vertical.
- **Connectivity:** build the node of each terminal from the drawing alone. Two terminals are connected when a chain of wires joins their grid points. The groups this gives must equal the netlist's nodes exactly. This catches a drawing that does not match its netlist.
- No wire segment passes through a component's body, and no two wires of different nodes share a grid point.
- `renderDrawing(drawing, style)` contains no `NaN`.
- There are 14 problems, 8 with `multiStep: false` and 6 with `true`.

**Done when.** The tests pass, and you have rendered each drawing to SVG (a temporary script is fine, do not commit it), looked at all 14, and confirmed each one reads as the circuit in PROBLEMS.md with no overlapping text.

---

## WP-10: Image rendering

**Goal.** PNG files for the eval and the replay samples.

**Serial.** This package edits `package.json`.

**Files.**
- `eval/render.ts` (replace the placeholder)
- `eval/images/*.svg`, `eval/images/*.png` (generated, committed)
- `web/public/samples/c01.png`, `web/public/samples/c09.png` (copies)
- `package.json`: add `@resvg/resvg-js` to `devDependencies`, and the script `"render": "tsx eval/render.ts"`
- Delete `fixtures/.gitkeep` only if another file exists in `fixtures/`.

**Spec.**
1. For each problem with a drawing, write `eval/images/<id>.svg` from `renderDrawing`, then rasterize it to `eval/images/<id>.png` at 1200 px wide with a white background, using `@resvg/resvg-js` with system fonts loaded.
2. Copy the PNGs of `c01` and `c09` to `web/public/samples/`.
3. Running the script twice gives byte-identical SVG files.
4. Problems without a drawing are skipped. WP-27 adds charts.

**Done when.** `npm run render` writes 14 SVG and 14 PNG files. You have opened at least `c01.png`, `c06.png` and `c13.png` and confirmed that the Ω sign, the ± marks and all labels render as readable text, not empty boxes. The check chain passes.

---

## WP-11: Parse scoring

**Goal.** Score a reader's output against the ground truth, without depending on node names.

**Read.** CONTRACTS.md sections 1 and 2.

**Files.**
- `eval/score.ts` (replace the placeholder)
- `test/score.test.ts` (new)

**Spec.**

```ts
export type NetlistScore = {
  truthCount: number; readCount: number; matched: number;
  recall: number;        // matched / truthCount
  precision: number;     // matched / readCount, or 0 when readCount is 0
  exact: boolean;        // matched === truthCount && matched === readCount
  mapping: Record<string, string | null>;   // truth node -> read node
};
export function scoreNetlist(truth: Circuit, read: Circuit): NetlistScore;
```

1. Ground maps to ground.
2. Try every way to map the other truth nodes to distinct read nodes. A truth node may map to nothing. With more than 7 truth nodes besides ground, throw.
3. Under one mapping, a truth component matches a read component when:
   - the types are equal, and
   - for a resistor: `closeTo(read.value, truth.value)`, and the mapped node pair equals the read pair in either order;
   - for a source: the mapped pair equals the read pair in the same order and the values are `closeTo`, **or** the pair is reversed and the read value is `closeTo` the negated truth value.
4. Each read component matches at most one truth component. Match greedily in truth order.
5. Keep the mapping with the most matches. On a tie, keep the first found.
6. Component ids and labels do not count.

**Tests.**
- `c06` against itself: `exact` is true.
- `c06` with every node renamed (A to n1, B to n2, C to n3): `exact` is true.
- `c06` with the read components shuffled and ids changed: `exact` is true.
- `c06` with R5's value read as 10000: `matched` is 5, `recall` is 5/6, `exact` is false.
- `c01` with V1 reversed (`a` and `b` swapped) and value −12: `exact` is true. Reversed with value +12: V1 does not match.
- `c01` with one extra resistor in the read: `recall` is 1, `precision` is 3/4.
- `c01` against an empty read: `matched` 0, `precision` 0.
- `c05` with R3 connected to the wrong node (A instead of B): `matched` is 4.
- Two identical parallel resistors in truth and one in the read: `matched` counts one of them.

**Done when.** The tests pass. WP-27 adds `scoreGraph` to this file.

---

## WP-12: Core eval runner

**Goal.** The part of the eval that needs no API key.

**Files.**
- `eval/run.ts` (replace the placeholder)
- `eval/report.ts` (new)
- `test/eval-core.test.ts` (new)

**Spec.**
1. `eval/report.ts` exports pure functions:
   - `runCore(problems): CoreResult`. For each problem: `checkClaim(truth, expected)` must verify; then the mutations from WP-06 (×1.05, negated, ×1000, for each claimed number) must each fail. For the two design claims (`component_value_for_condition`), use ×1.25 in place of ×1.05: they are checked through their condition, and on `c11` a 5% change in R2 moves V(B) by only 0.96%. Return per-problem rows and totals: problems verified, mutations rejected, mutations total.
   - `coreTable(result): string`, a Markdown table with one row per problem (id, title, expected answer through `formatQuantity`, verified yes or no, mutations rejected as `n/n`) and a totals row.
2. `eval/run.ts` parses flags. `--core` runs `runCore` on `PROBLEMS`, prints the table, and exits with code 1 if any problem fails to verify or any mutation is accepted. Any other flag prints "Live modes arrive in WP-30." and exits with code 2.
3. Skip graph problems until WP-26 lands: a problem whose `truth.kind` is `graph` counts only once `measure` supports it.

**Tests.**
- `runCore(PROBLEMS)` verifies 14 of 14 and rejects every mutation.
- `coreTable` output has 14 problem rows and contains `8 V` for `c01`.

**Done when.** `npm run eval -- --core` prints the table and exits with code 0.
