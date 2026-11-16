/**
 * Zod schemas and shared types. Source of truth: docs/build/CONTRACTS.md, sections 1 and 2.
 */
import { z } from "zod";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<E, T = never>(error: E): Result<T, E> {
  return { ok: false, error };
}

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const ComponentType = z.enum(["resistor", "voltage_source", "current_source", "unknown"]);
export type ComponentType = z.infer<typeof ComponentType>;

export const Unit = z.enum(["ohm", "V", "A", "W", ""]);
export type Unit = z.infer<typeof Unit>;

export const Component = z.object({
  id: z.string(), // as printed: "R1", "V1". Unique in the circuit.
  type: ComponentType,
  label: z.string(), // value text as printed: "4k7", "10 mA". "" if none.
  value: z.number(), // SI base units
  a: z.string(),
  b: z.string(),
  pa: Point.nullable(), // where terminal a is in the image
  pb: Point.nullable(), // where terminal b is in the image
  uncertain: z.string().nullable(), // a short note when the reader is unsure
});
export type Component = z.infer<typeof Component>;

export const Asked = z.object({
  summary: z.string(), // the question restated in one sentence
  target: z.string().nullable(), // the node or component id the question is about
});
export type Asked = z.infer<typeof Asked>;

export const Circuit = z.object({
  kind: z.literal("circuit"),
  components: z.array(Component),
  ground: z.string(),
  asked: Asked,
  notes: z.string().nullable(),
});
export type Circuit = z.infer<typeof Circuit>;

export const Axis = z.object({
  label: z.string(),
  unit: z.string().nullable(),
  min: z.number(),
  max: z.number(),
});
export type Axis = z.infer<typeof Axis>;

export const Series = z.object({
  id: z.string(), // "s1", "s2"
  name: z.string(),
  kind: z.enum(["line", "bar"]),
  points: z.array(z.object({ x: z.number(), y: z.number() })), // sorted by x
});
export type Series = z.infer<typeof Series>;

export const Graph = z.object({
  kind: z.literal("graph"),
  title: z.string().nullable(),
  x: Axis,
  y: Axis,
  series: z.array(Series),
  asked: Asked,
  notes: z.string().nullable(),
});
export type Graph = z.infer<typeof Graph>;

export const Structure = z.discriminatedUnion("kind", [Circuit, Graph]);
export type Structure = z.infer<typeof Structure>;

// ---- Queries and claims ----

export const Setup = z.object({
  remove: z.array(z.string()), // component ids taken out (open circuit)
  zero: z.array(z.string()), // source ids set to zero
});
export type Setup = z.infer<typeof Setup>;

const Condition = z.object({
  kind: z.enum(["node_voltage", "branch_current", "power"]),
  target: z.string(), // node id, or component id
  value: z.number(),
});

const NodeVoltageQuery = z.object({ kind: z.literal("node_voltage"), node: z.string(), setup: Setup });
const BranchCurrentQuery = z.object({ kind: z.literal("branch_current"), component: z.string(), setup: Setup });
const PowerQuery = z.object({
  kind: z.literal("power"),
  component: z.string(),
  sense: z.enum(["absorbed", "delivered"]),
  setup: Setup,
});
const EquivalentResistanceQuery = z.object({
  kind: z.literal("equivalent_resistance"),
  a: z.string(),
  b: z.string(),
  remove: z.array(z.string()),
});
const TheveninQuery = z.object({
  kind: z.literal("thevenin"),
  a: z.string(),
  b: z.string(),
  remove: z.array(z.string()),
});
const MaxPowerTransferQuery = z.object({ kind: z.literal("max_power_transfer"), load: z.string() });
const ComponentValueQuery = z.object({
  kind: z.literal("component_value_for_condition"),
  component: z.string(),
  condition: Condition,
});
const GraphValueQuery = z.object({ kind: z.literal("graph_value"), series: z.string(), x: z.number() });
const GraphSlopeQuery = z.object({
  kind: z.literal("graph_slope"),
  series: z.string(),
  x1: z.number(),
  x2: z.number(),
});
const GraphAreaQuery = z.object({
  kind: z.literal("graph_area"),
  series: z.string(),
  x1: z.number(),
  x2: z.number(),
});
const GraphExtremumQuery = z.object({
  kind: z.literal("graph_extremum"),
  series: z.string(),
  which: z.enum(["max", "min"]),
});

export const Query = z.discriminatedUnion("kind", [
  NodeVoltageQuery,
  BranchCurrentQuery,
  PowerQuery,
  EquivalentResistanceQuery,
  TheveninQuery,
  MaxPowerTransferQuery,
  ComponentValueQuery,
  GraphValueQuery,
  GraphSlopeQuery,
  GraphAreaQuery,
  GraphExtremumQuery,
]);
export type Query = z.infer<typeof Query>;

// A claim is each query variant plus its claimed number fields. Built by extension, not by rewriting.
export const Claim = z.discriminatedUnion("kind", [
  NodeVoltageQuery.extend({ value: z.number() }),
  BranchCurrentQuery.extend({ value: z.number() }),
  PowerQuery.extend({ value: z.number() }),
  EquivalentResistanceQuery.extend({ value: z.number() }),
  TheveninQuery.extend({ vth: z.number(), rth: z.number() }),
  MaxPowerTransferQuery.extend({ resistance: z.number(), power: z.number() }),
  ComponentValueQuery.extend({ value: z.number() }),
  GraphValueQuery.extend({ value: z.number() }),
  GraphSlopeQuery.extend({ value: z.number() }),
  GraphAreaQuery.extend({ value: z.number() }),
  GraphExtremumQuery.extend({ x: z.number(), value: z.number() }),
]);
export type Claim = z.infer<typeof Claim>;

/** The query a claim measures, without the claimed numbers. */
export function queryOf(claim: Claim): Query {
  switch (claim.kind) {
    case "node_voltage":
      return { kind: claim.kind, node: claim.node, setup: claim.setup };
    case "branch_current":
      return { kind: claim.kind, component: claim.component, setup: claim.setup };
    case "power":
      return { kind: claim.kind, component: claim.component, sense: claim.sense, setup: claim.setup };
    case "equivalent_resistance":
      return { kind: claim.kind, a: claim.a, b: claim.b, remove: claim.remove };
    case "thevenin":
      return { kind: claim.kind, a: claim.a, b: claim.b, remove: claim.remove };
    case "max_power_transfer":
      return { kind: claim.kind, load: claim.load };
    case "component_value_for_condition":
      return { kind: claim.kind, component: claim.component, condition: claim.condition };
    case "graph_value":
      return { kind: claim.kind, series: claim.series, x: claim.x };
    case "graph_slope":
      return { kind: claim.kind, series: claim.series, x1: claim.x1, x2: claim.x2 };
    case "graph_area":
      return { kind: claim.kind, series: claim.series, x1: claim.x1, x2: claim.x2 };
    case "graph_extremum":
      return { kind: claim.kind, series: claim.series, which: claim.which };
  }
}

/** The claimed numbers, in the order of the claim table in CONTRACTS.md. */
export function claimedValues(claim: Claim): { name: string; value: number }[] {
  switch (claim.kind) {
    case "thevenin":
      return [
        { name: "vth", value: claim.vth },
        { name: "rth", value: claim.rth },
      ];
    case "max_power_transfer":
      return [
        { name: "resistance", value: claim.resistance },
        { name: "power", value: claim.power },
      ];
    case "graph_extremum":
      return [
        { name: "x", value: claim.x },
        { name: "value", value: claim.value },
      ];
    case "node_voltage":
    case "branch_current":
    case "power":
    case "equivalent_resistance":
    case "component_value_for_condition":
    case "graph_value":
    case "graph_slope":
    case "graph_area":
      return [{ name: "value", value: claim.value }];
  }
}

// ---- Other shared types (plain TypeScript, not schemas) ----

export type Solution = {
  nodeVoltages: Record<string, number>; // includes ground: 0
  components: Record<string, { voltage: number; current: number; power: number }>;
};

export type SolveError = {
  code: "empty" | "no_ground" | "duplicate_id" | "unknown_component" | "invalid_value" | "singular" | "unknown_id";
  message: string;
};

export type Warning = {
  code:
    | "empty"
    | "no_ground"
    | "duplicate_id"
    | "unknown_component"
    | "invalid_value"
    | "shorted_source"
    | "disconnected"
    | "singular"
    | "dangling_node"
    | "label_mismatch"
    | "unit_mismatch"
    | "uncertain"
    | "empty_series"
    | "unsorted_points"
    | "bad_axis";
  severity: "error" | "warning";
  message: string; // one plain sentence for the user
  componentId: string | null;
  node: string | null;
};

export type Residuals = { kclMax: number; sourceMax: number; powerBalance: number };

export type MeasuredValue = { name: string; value: number; unit: "V" | "A" | "W" | "ohm" | "" };
export type Measurement = { values: MeasuredValue[]; residuals: Residuals | null };
export type MeasureError = {
  code:
    | SolveError["code"]
    | "certificate_failed"
    | "wrong_structure"
    | "not_measurable"
    | "out_of_range"
    | "unknown_series";
  message: string;
};

export type CheckItem = { name: string; claimed: number; measured: number; unit: string; ok: boolean };
export type CheckReport = {
  verified: boolean; // true only when every item is ok and no measurement failed
  items: CheckItem[];
  residuals: Residuals | null;
  notes: string[]; // plain sentences: why a check failed or could not run
};
