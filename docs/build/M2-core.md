# M2: circuit core (WP-01 to WP-07)

Everything here is pure TypeScript with no model calls. Read [README.md](README.md) first.

---

## WP-01: Schemas and test helpers

**Goal.** Put every schema and shared type from CONTRACTS.md into code.

**Read.** CONTRACTS.md sections 1 and 2.

**Files.**
- `src/core/schema.ts` (replace the placeholder)
- `test/helpers.ts` (new)
- `test/schema.test.ts` (new)

**Spec.**
1. Copy the schemas from CONTRACTS.md section 2 into `src/core/schema.ts`. Export each schema and its inferred type under the same name.
2. Define `Query` as written. Build `Claim` by extending each `Query` variant with the claimed fields from the claim table. Do not write the variants twice.
3. Export `queryOf(claim)` and `claimedValues(claim)`.
4. Export the plain types `Result`, `Solution`, `SolveError`, `Warning`, `Residuals`, `MeasuredValue`, `Measurement`, `MeasureError`, `CheckItem`, `CheckReport`. Add `"not_measurable"` to `MeasureError["code"]` if it is not already in CONTRACTS.md.
5. Export `ok(value)` and `err(error)` helpers that build a `Result`.
6. In `test/helpers.ts`, export:
   - `resistor(id, value, a, b)`, `vsource(id, value, a, b)`, `isource(id, value, a, b)`. Each returns a `Component` with `label: ""`, `pa: null`, `pb: null`, `uncertain: null`.
   - `circuit(components, ground = "gnd")`. Returns a `Circuit` with `asked: { summary: "", target: null }` and `notes: null`.
   - `NO_SETUP`, equal to `{ remove: [], zero: [] }`.

**Tests.**
- `Circuit.parse` accepts a circuit built with the helpers.
- `Circuit.safeParse` rejects a component with `type: "capacitor"`, and a component missing `pa`.
- `Structure.parse` picks the right variant for a circuit and for a graph.
- `Claim.parse` accepts one valid claim of each of the 11 kinds.
- `Claim.safeParse` rejects a `thevenin` claim without `rth`.
- `queryOf` on a `thevenin` claim returns an object without `vth` and `rth` that `Query.parse` accepts.
- `claimedValues` returns `[{ name: "vth", … }, { name: "rth", … }]` for `thevenin`, and `[{ name: "x", … }, { name: "value", … }]` for `graph_extremum`.

**Done when.** The tests pass, and `z.toJSONSchema(Structure)` and `z.toJSONSchema(Claim)` run without throwing (assert this in a test).

---

## WP-02: Unit parser and formatter

**Goal.** Convert printed labels to SI numbers and back.

**Read.** CONTRACTS.md sections 1 and 3.

**Files.**
- `src/core/units.ts` (replace the placeholder)
- `test/units.test.ts` (new)

**Spec.**

`parseQuantity(text)` trims the text, then tries two forms. It returns `null` when neither matches.

1. **RKM code:** digits, one of `R`, `k`, `K`, `M`, digits. The letter is the decimal point and the multiplier (`R` is 1, `k` and `K` are 1e3, `M` is 1e6). The unit is `"ohm"`.
2. **General:** a number (optional sign, digits, optional decimal part, optional exponent), optional spaces, an optional prefix, optional spaces, an optional unit.
   - Prefixes: `p` 1e-12, `n` 1e-9, `u` `µ` `μ` 1e-6, `m` 1e-3, `k` `K` 1e3, `M` 1e6, `G` 1e9. `m` and `M` differ.
   - Units: `Ω` (U+03A9), `Ω` (U+2126), `ohm`, `ohms`, `Ohm`, `Ohms` and `R` give `"ohm"`. `V`, `A`, `W` give themselves. No unit gives `null`.

`formatQuantity(value, unit)`:
- Pick the prefix from `p n µ m (none) k M G` that puts the mantissa in [1, 1000).
- Round the mantissa to 4 significant digits and drop trailing zeros.
- Output mantissa, a space, then prefix and symbol. `"ohm"` prints as `Ω`. The unit `""` prints the number alone with no prefix (`formatQuantity(-2, "")` is `"-2"`).
- `0` prints as `"0"` plus the symbol: `"0 V"`.
- A value outside the prefix range prints with `toExponential(3)`.

`unitFor(type)`: `resistor` gives `"ohm"`, `voltage_source` gives `"V"`, `current_source` gives `"A"`, `unknown` gives `""`.

`closeTo(x, reference)`: `Math.abs(x - reference) <= Math.max(0.01 * Math.abs(reference), 1e-9)`.

**Tests.** `parseQuantity`, comparing values with `toBeCloseTo`:

| Input | Value | Unit |
|---|---|---|
| `4.7k` | 4700 | null |
| `4.7 kΩ` | 4700 | ohm |
| `4k7` | 4700 | ohm |
| `1k0` | 1000 | ohm |
| `4R7` | 4.7 | ohm |
| `2M2` | 2200000 | ohm |
| `4700` | 4700 | null |
| `220 Ω` | 220 | ohm |
| `100R` | 100 | ohm |
| `10 mA` | 0.01 | A |
| `2mA` | 0.002 | A |
| `12 V` | 12 | V |
| `12V` | 12 | V |
| `500 mW` | 0.5 | W |
| `2.2 MΩ` | 2200000 | ohm |
| `1e3` | 1000 | null |
| `-5 V` | −5 | V |
| `3 µA` | 0.000003 | A |
| `  1 kΩ  ` | 1000 | ohm |

These return `null`: `""`, `RL`, `abc`, `4.7 kX`, `k`, `1 2`.

`formatQuantity`:

| Value | Unit | Output |
|---|---|---|
| 4700 | ohm | `4.7 kΩ` |
| 30000 | ohm | `30 kΩ` |
| 1000000 | ohm | `1 MΩ` |
| 0.002 | A | `2 mA` |
| 0.00142857 | A | `1.429 mA` |
| 0.0533333 | W | `53.33 mW` |
| 12 | V | `12 V` |
| 0 | V | `0 V` |
| −2 | (empty) | `-2` |
| 8 | (empty) | `8` |

`closeTo(8.05, 8)` is true. `closeTo(8.1, 8)` is false. `closeTo(0, 0)` is true. `closeTo(1e-10, 0)` is true.

**Done when.** Every row passes. For every `formatQuantity` row with a unit, `parseQuantity(output)` returns a value that is `closeTo` the input.

---

## WP-03: Linear solver and MNA

**Goal.** Solve a DC circuit of resistors, voltage sources and current sources.

**Read.** CONTRACTS.md sections 1, 2 ("Other shared types", "Applying a setup"), 3 and 4 (`Change`). PROBLEMS.md.

**Files.**
- `src/core/linear.ts` (new)
- `src/core/mna.ts` (replace the placeholder)
- `test/fixtures/circuits.ts` (new)
- `test/linear.test.ts`, `test/mna.test.ts` (new)

**Spec.**

`solveLinear(A, b)`: Gaussian elimination with partial pivoting. Copy the inputs. Let `scale` be the largest absolute entry of `A`, or 1 if that is 0. If the chosen pivot's absolute value is below `1e-12 × scale`, return `null`. An empty system returns `[]`.

`solveCircuit(c)`:
1. Return these errors, checked in this order: `empty` (no components), `duplicate_id`, `unknown_component` (a component of type `unknown`), `invalid_value` (a value that is not finite, or a resistor value ≤ 0), `no_ground` (no component touches `c.ground`).
2. Nodes are the distinct `a` and `b` names in order of first appearance, without ground. Unknowns are those node voltages, then one current per voltage source in component order.
3. Stamps, where `i` and `j` are the indices of `a` and `b`, and a ground terminal is skipped:
   - Resistor, `G = 1/value`: `A[i][i] += G`, `A[j][j] += G`, `A[i][j] -= G`, `A[j][i] -= G`.
   - Current source: `z[i] += value`, `z[j] -= value`.
   - Voltage source with row `k`: `A[i][k] += 1`, `A[k][i] += 1`, `A[j][k] -= 1`, `A[k][j] -= 1`, `z[k] = value`.
4. Solve. `null` gives the error `singular`.
5. Build the `Solution`. `nodeVoltages` includes ground at 0. For each component, `voltage = V(a) − V(b)`. `current` is `voltage / value` for a resistor, `−value` for a current source, and the solved unknown for a voltage source. `power = voltage × current`.

`applySetup(c, setup)`: returns a new circuit. Apply `remove` first, then `zero`. See "Applying a setup" in CONTRACTS.md. Never change the input.

`applyChanges(c, changes)`: returns a new circuit. Apply the changes in order.
- `set_value`: needs `value`. Unknown id gives `unknown_id`.
- `remove`: unknown id gives `unknown_id`.
- `zero`: as in a setup.
- `add`: needs `type` (not `unknown`), `value`, `a` and `b`. An id that already exists gives `duplicate_id`. The new component has `label: ""`, null positions and `uncertain: null`.
- A change that lacks a field it needs gives `invalid_value`.

`test/fixtures/circuits.ts`: export `CIRCUITS`, a record from `c01` to `c14` to the `Circuit` built with the helpers from `test/helpers.ts`, copied from the tables in PROBLEMS.md.

**Tests.**
- `solveLinear`: a 2×2 system with a known answer; a system that needs a row swap (zero in the first pivot position); a singular matrix returns `null`; `[]` for the empty system.
- The worked example in CONTRACTS.md section 1: every number listed there.
- From PROBLEMS.md, the single-solve circuits: `c01` V(B) = 8; `c02` `R2.current` = 0.02; `c03` `R2.power` = 0.25; `c04` V(A) = 1.5; `c05` V(C) = 4; `c06` `R5.current` = 1/700; `c07` V(B) = 9; `c08` `V1.power` = −4/75.
- For every one of the 14 fixtures, the component powers sum to 0 within 1e-9.
- Errors: no components gives `empty`; ground not used gives `no_ground`; two voltage sources of 5 V and 10 V across the same two nodes give `singular`; a lone current source into a node with nothing else gives `singular`; a resistor between two nodes not connected to the rest gives `singular`; a resistor of 0 Ω gives `invalid_value`; an `unknown` component gives `unknown_component`.
- `applySetup` on `c12` with `zero: ["V1"]` then `solveCircuit` gives V(B) = 4. With `zero: ["I1"]` it gives 12.
- `applySetup` with `zero: ["R1"]` gives `unknown_id`. The input circuit is unchanged after every call (deep-equal to a copy taken before).
- `applyChanges` on `c14` with `set_value R3 800` gives `R1.current` = 0.009.
- `applyChanges` with an `add` of a 1 A current source into C from gnd on `c09` with `RL` removed and `V1` zeroed gives V(C) = 4000.

**Done when.** The tests pass and `src/core/mna.ts` imports nothing but `./schema` and `./linear`.

---

## WP-04: Validator

**Goal.** Tell the user what is wrong with a structure before it is solved.

**Read.** CONTRACTS.md sections 1, 2 (`Warning`) and 3.

**Files.**
- `src/core/validate.ts` (replace the placeholder)
- `test/validate.test.ts` (new)

**Spec.** `validate(structure)` returns every warning that applies, in the order of this table. Messages are one plain sentence that names the component or node.

Circuit rules:

| Code | Severity | Condition | Sets |
|---|---|---|---|
| `empty` | error | No components. Return only this. | |
| `duplicate_id` | error | Two components share an id. One warning per duplicated id. | `componentId` |
| `unknown_component` | error | `type` is `unknown`. | `componentId` |
| `invalid_value` | error | Value not finite, or a resistor value ≤ 0. | `componentId` |
| `shorted_source` | error | A voltage source with `a === b`. | `componentId` |
| `no_ground` | error | No component touches `ground`. | `node` |
| `disconnected` | error | A node that cannot be reached from ground through components. One warning per node. Skip when `no_ground` fired. | `node` |
| `dangling_node` | warning | A node other than ground that exactly one terminal touches, or a component other than a voltage source with `a === b`. | `node` or `componentId` |
| `label_mismatch` | warning | `parseQuantity(label)` is not null and its absolute value is not `closeTo` the absolute `value`. | `componentId` |
| `unit_mismatch` | warning | `parseQuantity(label)` has a unit and it differs from `unitFor(type)`. | `componentId` |
| `uncertain` | warning | `uncertain` is a non-empty string. The message is the reader's note. | `componentId` |
| `singular` | error | No error so far, and `solveCircuit` fails. | |

Graph rules:

| Code | Severity | Condition |
|---|---|---|
| `empty_series` | error | No series, a line series with fewer than 2 points, or a bar series with no points. |
| `unsorted_points` | error | A series whose `x` values do not strictly increase. |
| `bad_axis` | error | An axis with `min >= max` or a value that is not finite. |
| `bad_axis` | warning | A point outside the axis ranges. One warning per series. |

`canSolve(warnings)` is true when no warning has severity `error`.

**Tests.** One test per row of both tables that builds the smallest structure that triggers it and checks the `code`, the `severity`, and `componentId` or `node`. Also:
- Each of the 14 fixtures from `test/fixtures/circuits.ts` gives no warnings.
- A component with `label: "2 kΩ"` and `value: 20000` gives exactly one `label_mismatch`.
- A resistor with `label: "RL"` gives no warning.
- A resistor with `label: "10 mA"` gives `unit_mismatch`.
- `canSolve` is false for a list with one error and true for a list with only warnings.

**Done when.** The tests pass. Tests assert codes, never message text.

---

## WP-05: Measurement and certificate

**Goal.** Measure any circuit query, and prove each solution is right with element laws.

**Read.** CONTRACTS.md sections 1, 2 ("What each query means", "Other shared types") and 3.

**Files.**
- `src/core/measure.ts` (new)
- `test/measure.test.ts` (new)

**Spec.**

`certify(c, s)` checks a solution without solving anything. It must not import `./mna` or `./linear`.
1. Recompute each component's current: a resistor's is `(V(a) − V(b)) / value` from `s.nodeVoltages`; a current source's is `−value`; a voltage source's is `s.components[id].current`.
2. `kclMax`: for every node including ground, sum the recomputed currents of components with `a` at the node, minus those with `b` at the node. Take the largest absolute sum.
3. `sourceMax`: the largest `|V(a) − V(b) − value|` over voltage sources. 0 if there are none.
4. `powerBalance`: the absolute value of the sum of `(V(a) − V(b)) × current` over all components.

`certified(r, s)` is true when all three hold, where `Imax` is the largest absolute recomputed current and `Vmax` the largest absolute node voltage:
- `r.kclMax <= 1e-9 × max(1, Imax)`
- `r.sourceMax <= 1e-9 × max(1, Vmax)`
- `r.powerBalance <= 1e-9 × max(1, sum of |power|)`

An internal helper `solveCertified(c)` calls `solveCircuit`, then `certify`. If `certified` is false it returns the error `certificate_failed`. Every solve inside `measure` goes through it.

`measure(structure, query)`:
- A graph query on a circuit, or a circuit query on a graph, gives `wrong_structure`.
- Graph queries give `wrong_structure` for now. WP-26 adds them.
- Circuit queries follow "What each query means" in CONTRACTS.md. A node or component that does not exist after the setup gives `unknown_id`.
- `equivalent_resistance`: the test source's id is `__test`. If `a === b`, give `unknown_id`.
- `max_power_transfer`: if `rth` is 0, give `singular`.
- `component_value_for_condition` gives `not_measurable`. The checker handles it.
- `values` uses the names from the claim table (`value`, `vth`, `rth`, `resistance`, `power`) with units `V`, `A`, `W` or `ohm`.
- `residuals` is the worst (largest) of each residual over all the solves the query needed.

**Tests.**
- `certify` on the solved worked example gives residuals below 1e-12.
- Corrupted solutions fail `certified`: take `c06` solved, then (a) add 0.1 to V(B), (b) flip the sign of `V1.current`, (c) set V(A) to 9. Each one gives `certified === false`.
- `measure` on each fixture with the query from PROBLEMS.md gives the expected values: `c01` 8; `c02` 0.02; `c03` 0.25; `c04` 1.5; `c05` 4; `c06` 1/700; `c07` 9; `c08` 4/75 (delivered); `c09` vth 9 and rth 4000; `c10` resistance 2000 and power 1/180; `c12` 4; `c13` 4000.
- `c08` with `sense: "absorbed"` gives −4/75.
- `measure` on `c11` with its design query gives `not_measurable`.
- `measure` with `node: "Z"` gives `unknown_id`. A `graph_value` query on a circuit gives `wrong_structure`.
- A test that reads `src/core/measure.ts` as text is not needed. Instead, assert independence by structure: export `certify` and `certified` from a section of the file that uses no imported solver function, and have a reviewer confirm it.

**Done when.** The tests pass.

---

## WP-06: Checker

**Goal.** Decide whether a claim is right.

**Read.** CONTRACTS.md sections 1, 2 and 3. PROBLEMS.md.

**Files.**
- `src/core/checker.ts` (replace the placeholder)
- `test/checker.test.ts` (new)

**Spec.** `checkClaim(structure, claim)`:
1. For every kind except `component_value_for_condition`: call `measure(structure, queryOf(claim))`.
   - On an error: `verified: false`, no items, and one note that states the error in a plain sentence.
   - Otherwise build one `CheckItem` per entry of `claimedValues(claim)`, matched to the measured value of the same name. `ok` is `closeTo(claimed, measured)`.
2. For `component_value_for_condition`:
   - Use `applyChanges` to set the component to the claimed `value`. A value that is not finite, or ≤ 0 for a resistor, gives `verified: false` with a note.
   - Measure the condition as a query with an empty setup: `node_voltage` on `target`, `branch_current` on `target`, or `power` (absorbed) on `target`.
   - Build one item: `name: "condition"`, `claimed: condition.value`, `measured`: the measured condition, `ok: closeTo(measured, condition.value)`.
3. `verified` is true when there is at least one item and every item is `ok`.
4. `residuals` comes from the measurement.
5. For each item that is not `ok`, add a note such as "The claimed value is 8.4 V. The circuit gives 8 V." Use `formatQuantity`.

**Tests.**
- The 14 expected claims from PROBLEMS.md, checked against their fixtures, all give `verified: true`.
- Mutations, for each of the 14 claims and for each claimed number in it: multiply by 1.05; negate; multiply by 1000. Each gives `verified: false`. For the two design claims, mutate `value` only. One exception: `c11` × 1.05 gives R2 = 31500 Ω and V(B) = 9.0865 V, which is within 1% of the 9 V condition, so it verifies. That is correct: a design claim is checked by its condition, not its value. Assert that case verifies, and add a × 0.5 mutation for every claim.
- A claim that is 0.5% off gives `verified: true`.
- A claim that names a node that does not exist gives `verified: false` with one note and no items.
- A `graph_value` claim against a circuit gives `verified: false`.
- The `c11` claim with `value: 10000` gives `verified: false`, and its item's `measured` is 6.4286 (15 × 7500 / 17500) within tolerance.

**Done when.** The tests pass. The mutation test prints nothing and asserts every case: 14 claims, at least 48 mutations.

---

## WP-07: Solver tools

**Goal.** The four tools the solver agent calls, as plain functions.

**Read.** CONTRACTS.md sections 3 and 4.

**Files.**
- `src/core/tools.ts` (new)
- `test/tools.test.ts` (new)

**Spec.**

`TOOL_SPECS`: four entries, `solve_circuit`, `evaluate`, `graph_query`, `submit_answer`, with the input schemas from CONTRACTS.md section 4. Each description is two or three sentences that tell the model when to use the tool and what units it takes and returns. State in `solve_circuit`'s description that the approved circuit never changes between calls, and the sign conventions for `current` and `power`.

`createToolRunner(structure)` returns a `ToolRunner`.
- `run` looks the tool up by name. An unknown name gives `{ ok: false, error }`. It validates the input with the tool's schema and returns `{ ok: false, error }` on a failure. It never throws.
- `solve_circuit`: on a graph, an error. Otherwise `applyChanges`, then `solveCircuit`. Errors become `{ ok: false, error: message }`.
- `evaluate`:
  - Reject an expression longer than 200 characters.
  - Use one `mathjs` instance made with `create(all)`. After taking a reference to its `evaluate`, disable `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative` and `resolve` by overriding each with a function that throws, as the mathjs security guidance describes.
  - Evaluate with an empty scope. The result must be a finite JavaScript `number`. Anything else (a matrix, a unit, a complex number, a function, `Infinity`) is an error.
- `graph_query`: on a circuit, an error. On a graph, return `{ ok: false, error: "not implemented" }` for now. WP-26 completes it.
- `submit_answer`: validate the claim. Then check that every node, component and series the claim names exists in the approved structure. On success store `{ claim, explanation }` and return `{ ok: true }`. A later accepted call replaces the stored claim.
- `claim()` returns the stored value or `null`.

**Tests.**
- `solve_circuit` with no changes on `c01` returns V(B) = 8.
- `solve_circuit` with `set_value R3 800` on `c14` returns `R1.current` = 0.009, and a second call with no changes still returns the original circuit's solution.
- `solve_circuit` with a `remove` of an id that does not exist returns `ok: false`.
- `evaluate`: `"12 * 2000 / (1000 + 2000)"` gives 8; `"sqrt(16) + 2^3"` gives 12; `"1/0"`, `"[1,2,3]"`, `"import({})"`, `"createUnit(\"foo\")"`, `"evaluate(\"1+1\")"`, `"2 km"`, an expression of 201 characters, and `"x + 1"` each give `ok: false`.
- `submit_answer` with a valid `c01` claim returns `ok: true`, and `claim()` returns it. With `node: "Z"` it returns `ok: false` and `claim()` stays `null`.
- `run("nope", {})` and `run("solve_circuit", { changes: "x" })` return `ok: false` and do not throw.
- For every entry in `TOOL_SPECS`, `z.toJSONSchema(spec.input)` runs, and every object schema in the result has `additionalProperties: false` and lists all its properties in `required`. Walk the schema recursively to assert this.

**Done when.** The tests pass.
