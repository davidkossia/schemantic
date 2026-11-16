# Contracts

This file is the source of truth for every type, signature and convention that more than one work package uses. If a work package and this file disagree, this file wins. To change a contract, change this file first, in its own commit.

## 1. Conventions

**Units.** Every number in code is in SI base units: volts, amps, watts, ohms. `4.7 kΩ` is `4700`. Prefixes exist only in `label` strings and in `formatQuantity` output.

**Nodes.** A node is a string name. The ground node's name is `circuit.ground`. Ground is 0 V.

**Component terminals.** Every component has two nodes, `a` and `b`.

| Quantity | Definition |
|---|---|
| `voltage` of a component | `V(a) − V(b)` |
| `current` of a component | Current flowing from `a` to `b` **through the component** |
| `power` of a component | `voltage × current`. This is absorbed power. A resistor's is positive. A source that delivers power has negative absorbed power. |
| Voltage source | `V(a) − V(b) = value`. `a` is the + terminal. |
| Current source | Pushes `value` amps into node `a`. Its `current` (a to b through it) is `−value`. |

Worked example: `V1` = 12 V (`a` = A, `b` = gnd), `R1` = 1 kΩ (A, B), `R2` = 2 kΩ (B, gnd). Then V(B) = 8, `R1.current` = 0.004, `R1.power` = 0.016, `V1.current` = −0.004, `V1.power` = −0.048, and the powers sum to 0.

**Tolerance.** Two numbers match when `|x − y| ≤ max(0.01 × |y|, 1e-9)`, where `y` is the reference. Use `closeTo(x, y)` from `src/core/units.ts`. Do not write another comparison.

**Results, not exceptions.** Functions in `src/core` return `Result<T, E>` for bad input. They throw only for programmer errors.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

**Purity.** `src/core`, `src/pipeline`, `src/shared` and `src/agents/scripted.ts` must not import Node built-ins (`fs`, `path`, `process`, `ws`). They run in the browser too. Only `src/server`, `src/agents/client.ts`, `src/agents/reader.ts`, `src/agents/solver.ts`, `src/agents/live.ts` and `eval/` may use Node APIs.

**Imports.** No file extensions in relative imports. No default exports. No `any`.

**Positions.** A `Point` is a fraction of the image: `x` from 0 (left) to 1 (right), `y` from 0 (top) to 1 (bottom).

## 2. Schemas (`src/core/schema.ts`)

Write these with zod 4. Export each schema and its inferred type under the same name (`export type Circuit = z.infer<typeof Circuit>`).

Schemas sent to the model must avoid recursion, `.min()`, `.max()`, `.optional()` and records. Use `.nullable()` for a missing value. The validator does range checks.

```ts
export const Point = z.object({ x: z.number(), y: z.number() });

export const ComponentType = z.enum(["resistor", "voltage_source", "current_source", "unknown"]);
export const Unit = z.enum(["ohm", "V", "A", "W", ""]);

export const Component = z.object({
  id: z.string(),                 // as printed: "R1", "V1". Unique in the circuit.
  type: ComponentType,
  label: z.string(),              // value text as printed: "4k7", "10 mA". "" if none.
  value: z.number(),              // SI base units
  a: z.string(),
  b: z.string(),
  pa: Point.nullable(),           // where terminal a is in the image
  pb: Point.nullable(),           // where terminal b is in the image
  uncertain: z.string().nullable(), // a short note when the reader is unsure
});

export const Asked = z.object({
  summary: z.string(),            // the question restated in one sentence
  target: z.string().nullable(),  // the node or component id the question is about
});

export const Circuit = z.object({
  kind: z.literal("circuit"),
  components: z.array(Component),
  ground: z.string(),
  asked: Asked,
  notes: z.string().nullable(),
});

export const Axis = z.object({
  label: z.string(),
  unit: z.string().nullable(),
  min: z.number(),
  max: z.number(),
});

export const Series = z.object({
  id: z.string(),                 // "s1", "s2"
  name: z.string(),
  kind: z.enum(["line", "bar"]),
  points: z.array(z.object({ x: z.number(), y: z.number() })), // sorted by x
});

export const Graph = z.object({
  kind: z.literal("graph"),
  title: z.string().nullable(),
  x: Axis,
  y: Axis,
  series: z.array(Series),
  asked: Asked,
  notes: z.string().nullable(),
});

export const Structure = z.discriminatedUnion("kind", [Circuit, Graph]);
```

### Queries and claims

A **query** names a quantity. A **claim** is a query plus the claimed number or numbers. The solver submits a claim. The checker measures the claim's query and compares.

```ts
export const Setup = z.object({
  remove: z.array(z.string()),    // component ids taken out (open circuit)
  zero: z.array(z.string()),      // source ids set to zero
});

const Condition = z.object({
  kind: z.enum(["node_voltage", "branch_current", "power"]),
  target: z.string(),             // node id, or component id
  value: z.number(),
});

export const Query = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node_voltage"), node: z.string(), setup: Setup }),
  z.object({ kind: z.literal("branch_current"), component: z.string(), setup: Setup }),
  z.object({ kind: z.literal("power"), component: z.string(), sense: z.enum(["absorbed", "delivered"]), setup: Setup }),
  z.object({ kind: z.literal("equivalent_resistance"), a: z.string(), b: z.string(), remove: z.array(z.string()) }),
  z.object({ kind: z.literal("thevenin"), a: z.string(), b: z.string(), remove: z.array(z.string()) }),
  z.object({ kind: z.literal("max_power_transfer"), load: z.string() }),
  z.object({ kind: z.literal("component_value_for_condition"), component: z.string(), condition: Condition }),
  z.object({ kind: z.literal("graph_value"), series: z.string(), x: z.number() }),
  z.object({ kind: z.literal("graph_slope"), series: z.string(), x1: z.number(), x2: z.number() }),
  z.object({ kind: z.literal("graph_area"), series: z.string(), x1: z.number(), x2: z.number() }),
  z.object({ kind: z.literal("graph_extremum"), series: z.string(), which: z.enum(["max", "min"]) }),
]);
```

`Claim` is the same union with these extra number fields per kind:

| Kind | Claimed fields | Units |
|---|---|---|
| `node_voltage` | `value` | V |
| `branch_current` | `value` (signed, a to b) | A |
| `power` | `value` | W |
| `equivalent_resistance` | `value` | ohm |
| `thevenin` | `vth`, `rth` | V, ohm |
| `max_power_transfer` | `resistance`, `power` | ohm, W |
| `component_value_for_condition` | `value` | the component's unit |
| `graph_value`, `graph_slope`, `graph_area` | `value` | none |
| `graph_extremum` | `x`, `value` | none |

Build `Claim` by extending each query variant, so the two unions cannot drift. Export `queryOf(claim: Claim): Query`, which drops the claimed fields, and `claimedValues(claim: Claim): { name: string; value: number }[]`, which lists them in the table's order.

### What each query means

| Kind | Measurement |
|---|---|
| `node_voltage` | Apply `setup`. Solve. `V(node)`. |
| `branch_current` | Apply `setup`. Solve. The component's `current`. |
| `power` | Apply `setup`. Solve. The component's `power`, negated when `sense` is `delivered`. |
| `equivalent_resistance` | Remove `remove`. Zero every remaining source. Add a 1 A current source into `a` from `b`. Solve. `V(a) − V(b)`. |
| `thevenin` | `vth`: remove `remove`, solve, `V(a) − V(b)`. `rth`: the `equivalent_resistance` of the same `a`, `b`, `remove`. |
| `max_power_transfer` | Let `a`, `b` be the load's nodes. Take the `thevenin` with `remove: [load]`. `resistance = rth`. `power = vth² / (4 × rth)`. |
| `component_value_for_condition` | Not measurable without the claimed value: `measure` returns `not_measurable`. `checkClaim` sets the component to the claimed `value`, measures the condition with an empty setup (`power` is absorbed power), and compares it with `condition.value`. |
| `graph_value` | `valueAt(series, x)`. |
| `graph_slope` | `(valueAt(x2) − valueAt(x1)) / (x2 − x1)`. |
| `graph_area` | The integral of the piecewise-linear series from `x1` to `x2`. |
| `graph_extremum` | The key point with the largest or smallest `y`. On a tie, the smallest `x`. |

**Applying a setup.** `remove` deletes the component. `zero` on a voltage source sets its value to 0, which makes it a short. `zero` on a current source deletes it, which makes it an open circuit. An id that does not exist, or `zero` on a resistor, is the error `unknown_id`.

### Other shared types

```ts
export type Solution = {
  nodeVoltages: Record<string, number>;                       // includes ground: 0
  components: Record<string, { voltage: number; current: number; power: number }>;
};

export type SolveError = {
  code: "empty" | "no_ground" | "duplicate_id" | "unknown_component" | "invalid_value" | "singular" | "unknown_id";
  message: string;
};

export type Warning = {
  code: "empty" | "no_ground" | "duplicate_id" | "unknown_component" | "invalid_value" | "shorted_source"
      | "disconnected" | "singular" | "dangling_node" | "label_mismatch" | "unit_mismatch" | "uncertain"
      | "empty_series" | "unsorted_points" | "bad_axis";
  severity: "error" | "warning";
  message: string;                 // one plain sentence for the user
  componentId: string | null;
  node: string | null;
};

export type Residuals = { kclMax: number; sourceMax: number; powerBalance: number };

export type MeasuredValue = { name: string; value: number; unit: "V" | "A" | "W" | "ohm" | "" };
export type Measurement = { values: MeasuredValue[]; residuals: Residuals | null };
export type MeasureError = { code: SolveError["code"] | "certificate_failed" | "wrong_structure" | "not_measurable" | "out_of_range" | "unknown_series"; message: string };

export type CheckItem = { name: string; claimed: number; measured: number; unit: string; ok: boolean };
export type CheckReport = {
  verified: boolean;               // true only when every item is ok and no measurement failed
  items: CheckItem[];
  residuals: Residuals | null;
  notes: string[];                 // plain sentences: why a check failed or could not run
};
```

`MeasuredValue.name` matches the claimed field name from the claim table (`value`, `vth`, `rth`, `resistance`, `power`, `x`).

## 3. Core function signatures

| File | Exports |
|---|---|
| `src/core/units.ts` | `parseQuantity(text: string): { value: number; unit: "ohm" \| "V" \| "A" \| "W" \| null } \| null`, `formatQuantity(value: number, unit: Unit): string`, `unitFor(type: ComponentType): Unit`, `closeTo(x: number, reference: number): boolean` |
| `src/core/linear.ts` | `solveLinear(A: number[][], b: number[]): number[] \| null` |
| `src/core/mna.ts` | `solveCircuit(c: Circuit): Result<Solution, SolveError>`, `applySetup(c: Circuit, setup: Setup): Result<Circuit, SolveError>`, `applyChanges(c: Circuit, changes: Change[]): Result<Circuit, SolveError>` |
| `src/core/validate.ts` | `validate(s: Structure): Warning[]`, `canSolve(w: Warning[]): boolean` |
| `src/core/measure.ts` | `certify(c: Circuit, s: Solution): Residuals`, `certified(r: Residuals, s: Solution): boolean`, `measure(s: Structure, q: Query): Result<Measurement, MeasureError>` |
| `src/core/checker.ts` | `checkClaim(s: Structure, claim: Claim): CheckReport` |
| `src/core/graph.ts` | `valueAt`, `slope`, `area`, `extremum` (see WP-26) |
| `src/core/tools.ts` | `TOOL_SPECS`, `createToolRunner(s: Structure): ToolRunner` |
| `src/core/schematic.ts` | `Drawing`, `Style`, `renderDrawing(d: Drawing, style: Style): string` |
| `src/core/layout.ts` | `autoDrawing(c: Circuit): Drawing` |

## 4. Solver tools (`src/core/tools.ts`)

```ts
export const Change = z.object({
  op: z.enum(["set_value", "remove", "zero", "add"]),
  id: z.string(),
  type: ComponentType.nullable(),   // for "add"
  value: z.number().nullable(),     // for "set_value" and "add"
  a: z.string().nullable(),         // for "add"
  b: z.string().nullable(),         // for "add"
});

export type ToolOutput = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export type ToolRunner = {
  run(name: string, input: unknown): ToolOutput;   // validates input with zod; never throws
  claim(): { claim: Claim; explanation: string } | null;  // the last accepted submit_answer
};
```

| Tool | Input | Output on success |
|---|---|---|
| `solve_circuit` | `{ changes: Change[] }` | `{ ok: true, nodeVoltages, components }`, a `Solution` of the approved circuit with the changes applied. The approved circuit itself never changes. |
| `evaluate` | `{ expression: string }` | `{ ok: true, value: number }` |
| `graph_query` | `{ op: "value" \| "slope" \| "area" \| "extremum", series: string, x1: number \| null, x2: number \| null, which: "max" \| "min" \| null }` | `{ ok: true, value: number, x: number \| null }` |
| `submit_answer` | `{ claim: Claim, explanation: string }` | `{ ok: true }` |

`TOOL_SPECS` is an array of `{ name, description, input: z.ZodType }`. The live solver turns it into API tool definitions. The scripted solver calls `run` directly.

## 5. Model client (`src/pipeline/model.ts`)

The session never talks to the Anthropic SDK. It talks to this interface. There are two implementations: scripted (`src/agents/scripted.ts`) and live (`src/agents/live.ts`).

```ts
export type Usage = { inputTokens: number; outputTokens: number };
export type ImageInput = { mediaType: "image/png" | "image/jpeg" | "image/webp"; base64: string };

export type ReadInput = { image: ImageInput | null; sampleId: string | null; question: string; signal: AbortSignal };
export type ReadOutput = { structure: Structure; usage: Usage };

export type SolveEvent =
  | { type: "token"; text: string }
  | { type: "step"; tool: string; input: unknown; output: ToolOutput };

export type SolveInput = {
  structure: Structure;
  question: string;
  sampleId: string | null;
  tools: ToolRunner;
  feedback: CheckReport | null;      // set on the retry after a failed check
  onEvent: (e: SolveEvent) => void;
  signal: AbortSignal;
};
export type SolveOutput = { claim: Claim | null; text: string; usage: Usage };

export interface ModelClient {
  readonly mode: "live" | "replay";
  read(input: ReadInput): Promise<ReadOutput>;
  solve(input: SolveInput): Promise<SolveOutput>;
}

export class ModelError extends Error {
  constructor(public code: "refused" | "read_failed" | "solve_failed" | "limit_reached" | "cancelled", message: string) { super(message); }
}
```

## 6. Message protocol (`src/shared/protocol.ts`)

One zod discriminated union per direction, keyed on `type`. Every message is one JSON text frame.

**Client to server**

| `type` | Fields | Valid in state |
|---|---|---|
| `start` | `image: ImageInput \| null`, `sampleId: string \| null`, `question: string` | `idle`, `done` |
| `approve` | `structure: Structure` | `awaiting_review` |
| `reopen` | none | `done` |
| `cancel` | none | any |

Exactly one of `image` and `sampleId` is set.

**Server to client**

| `type` | Fields | Sent when |
|---|---|---|
| `hello` | `mode: "live" \| "replay"`, `samples: Sample[]` | On connect |
| `reading` | none | The reader starts |
| `parsed` | `structure: Structure`, `warnings: Warning[]` | The reader returns |
| `awaiting_review` | none | Right after `parsed`, and after `reopen` |
| `solving` | `attempt: 1 \| 2` | The solver starts |
| `token` | `text: string` | The solver emits text |
| `step` | `index: number`, `tool: string`, `input: unknown`, `output: ToolOutput` | A tool call returns |
| `checking` | none | The checker starts |
| `check` | `report: CheckReport`, `attempt: 1 \| 2` | The checker returns |
| `done` | `claim: Claim \| null`, `text: string`, `verified: boolean`, `usage: Usage` | The session ends |
| `error` | `code: ErrorCode`, `message: string` | Something failed |

```ts
export type Sample = { id: string; title: string; question: string; imageUrl: string };
export type ErrorCode = "bad_message" | "bad_state" | "image_too_large" | "unsupported_image"
  | "cannot_solve" | "read_failed" | "refused" | "solve_failed" | "limit_reached" | "cancelled" | "internal";
export type SessionState = "idle" | "reading" | "awaiting_review" | "solving" | "checking" | "done";
```

Also export `parseClientMessage(raw: string): Result<ClientMessage, string>` and `parseServerMessage(raw: string): Result<ServerMessage, string>`.

## 7. Limits (`src/shared/limits.ts`)

```ts
export const LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,     // decoded size
  maxFrameBytes: 8 * 1024 * 1024,
  maxQuestionChars: 1000,
  maxComponents: 40,
  maxSolveTurns: 12,
  maxSessionTokens: 200_000,
  readTimeoutMs: 120_000,
  solveTimeoutMs: 300_000,
} as const;
```
