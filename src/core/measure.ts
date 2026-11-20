/**
 * Measure a circuit query, and certify each solution with element laws.
 *
 * Source of truth: docs/build/CONTRACTS.md, sections 1 to 3.
 */
import { area, extremum, findSeries, slope, valueAt } from "./graph";
import type { GraphError } from "./graph";
import { applyChanges, applySetup, solveCircuit } from "./mna";
import { err, ok } from "./schema";
import type {
  Circuit,
  Graph,
  MeasuredValue,
  MeasureError,
  Measurement,
  Query,
  Residuals,
  Result,
  Setup,
  Solution,
  Structure,
} from "./schema";
import { closeTo } from "./units";

// ===========================================================================
// Certificate.
//
// This section calls no solver function. It reads only the circuit and the
// solution it is given, and checks them against the element laws.
// ===========================================================================

function voltageAt(s: Solution, node: string): number {
  return Object.hasOwn(s.nodeVoltages, node) ? (s.nodeVoltages[node] ?? Number.NaN) : Number.NaN;
}

/** Each component's current, recomputed from the solution's node voltages. NaN when it cannot be. */
function recomputedCurrents(c: Circuit, s: Solution): Map<string, number> {
  const currents = new Map<string, number>();
  for (const comp of c.components) {
    let current: number;
    if (comp.type === "resistor") {
      current = (voltageAt(s, comp.a) - voltageAt(s, comp.b)) / comp.value;
    } else if (comp.type === "current_source") {
      current = -comp.value;
    } else if (comp.type === "voltage_source") {
      current = Object.hasOwn(s.components, comp.id) ? (s.components[comp.id]?.current ?? Number.NaN) : Number.NaN;
    } else {
      current = Number.NaN;
    }
    currents.set(comp.id, current);
  }
  return currents;
}

/** Element-law residuals of a solution. Any missing value makes the residuals NaN, which never certifies. */
export function certify(c: Circuit, s: Solution): Residuals {
  const currents = recomputedCurrents(c, s);

  const kcl = new Map<string, number>([[c.ground, 0]]);
  for (const comp of c.components) {
    const i = currents.get(comp.id) ?? Number.NaN;
    kcl.set(comp.a, (kcl.get(comp.a) ?? 0) + i);
    kcl.set(comp.b, (kcl.get(comp.b) ?? 0) - i);
  }
  let kclMax = 0;
  for (const sum of kcl.values()) kclMax = Math.max(kclMax, Math.abs(sum));

  let sourceMax = 0;
  for (const comp of c.components) {
    if (comp.type !== "voltage_source") continue;
    sourceMax = Math.max(sourceMax, Math.abs(voltageAt(s, comp.a) - voltageAt(s, comp.b) - comp.value));
  }

  let powerSum = 0;
  for (const comp of c.components) {
    powerSum += (voltageAt(s, comp.a) - voltageAt(s, comp.b)) * (currents.get(comp.id) ?? Number.NaN);
  }

  return { kclMax, sourceMax, powerBalance: Math.abs(powerSum) };
}

/** True when every residual is within 1e-9 of the solution's own scale. */
export function certified(r: Residuals, s: Solution): boolean {
  let iMax = 0;
  let powerScale = 0;
  for (const entry of Object.values(s.components)) {
    iMax = Math.max(iMax, Math.abs(entry.current));
    powerScale += Math.abs(entry.power);
  }
  let vMax = 0;
  for (const v of Object.values(s.nodeVoltages)) vMax = Math.max(vMax, Math.abs(v));

  return (
    r.kclMax <= 1e-9 * Math.max(1, iMax) &&
    r.sourceMax <= 1e-9 * Math.max(1, vMax) &&
    r.powerBalance <= 1e-9 * Math.max(1, powerScale)
  );
}

// ===========================================================================
// Measurement.
// ===========================================================================

type Certified = { solution: Solution; residuals: Residuals };

const TEST_SOURCE_ID = "__test";

function fail(code: MeasureError["code"], message: string): Result<never, MeasureError> {
  return err({ code, message });
}

/** Solve, then certify. Every solve inside `measure` goes through here. */
function solveCertified(c: Circuit): Result<Certified, MeasureError> {
  const solved = solveCircuit(c);
  if (!solved.ok) return err(solved.error);
  const residuals = certify(c, solved.value);
  if (!certified(residuals, solved.value)) {
    return fail("certificate_failed", "The solution does not satisfy the circuit laws, so it cannot be trusted.");
  }
  return ok({ solution: solved.value, residuals });
}

/** Componentwise worst of the residuals of every solve a query needed. */
function worst(all: Residuals[]): Residuals {
  return all.reduce(
    (w, r) => ({
      kclMax: Math.max(w.kclMax, r.kclMax),
      sourceMax: Math.max(w.sourceMax, r.sourceMax),
      powerBalance: Math.max(w.powerBalance, r.powerBalance),
    }),
    { kclMax: 0, sourceMax: 0, powerBalance: 0 },
  );
}

function hasNode(c: Circuit, node: string): boolean {
  return node === c.ground || c.components.some((comp) => comp.a === node || comp.b === node);
}

function unknownNode(node: string): Result<never, MeasureError> {
  return fail("unknown_id", `There is no node named ${node}.`);
}

function unknownComponent(id: string): Result<never, MeasureError> {
  return fail("unknown_id", `There is no component with the id ${id}.`);
}

function setUp(c: Circuit, setup: Setup): Result<Circuit, MeasureError> {
  const r = applySetup(c, setup);
  return r.ok ? r : err(r.error);
}

function measured(values: MeasuredValue[], residuals: Residuals[]): Result<Measurement, MeasureError> {
  return ok({ values, residuals: worst(residuals) });
}

/** V(a) − V(b) with `remove` taken out. */
function openVoltage(c: Circuit, a: string, b: string, remove: string[]): Result<Certified & { value: number }, MeasureError> {
  const setup = setUp(c, { remove, zero: [] });
  if (!setup.ok) return setup;
  if (!hasNode(setup.value, a)) return unknownNode(a);
  if (!hasNode(setup.value, b)) return unknownNode(b);
  const r = solveCertified(setup.value);
  if (!r.ok) return r;
  const value = (r.value.solution.nodeVoltages[a] ?? 0) - (r.value.solution.nodeVoltages[b] ?? 0);
  return ok({ ...r.value, value });
}

/** Remove `remove`, zero every remaining source, drive 1 A into `a` from `b`, and read V(a) − V(b). */
function equivalentResistance(
  c: Circuit,
  a: string,
  b: string,
  remove: string[],
): Result<Certified & { value: number }, MeasureError> {
  if (a === b) return fail("unknown_id", `The two terminals are the same node, ${a}.`);
  const removed = setUp(c, { remove, zero: [] });
  if (!removed.ok) return removed;
  const sources = removed.value.components
    .filter((comp) => comp.type === "voltage_source" || comp.type === "current_source")
    .map((comp) => comp.id);
  const zeroed = setUp(removed.value, { remove: [], zero: sources });
  if (!zeroed.ok) return zeroed;
  if (!hasNode(zeroed.value, a)) return unknownNode(a);
  if (!hasNode(zeroed.value, b)) return unknownNode(b);
  const driven = applyChanges(zeroed.value, [
    { op: "add", id: TEST_SOURCE_ID, type: "current_source", value: 1, a, b },
  ]);
  if (!driven.ok) return err(driven.error);
  const r = solveCertified(driven.value);
  if (!r.ok) return r;
  const value = (r.value.solution.nodeVoltages[a] ?? 0) - (r.value.solution.nodeVoltages[b] ?? 0);
  return ok({ ...r.value, value });
}

function thevenin(
  c: Circuit,
  a: string,
  b: string,
  remove: string[],
): Result<{ vth: number; rth: number; residuals: Residuals[] }, MeasureError> {
  const open = openVoltage(c, a, b, remove);
  if (!open.ok) return open;
  const eq = equivalentResistance(c, a, b, remove);
  if (!eq.ok) return eq;
  return ok({ vth: open.value.value, rth: eq.value.value, residuals: [open.value.residuals, eq.value.residuals] });
}

function measureCircuit(c: Circuit, q: Query): Result<Measurement, MeasureError> {
  switch (q.kind) {
    case "node_voltage": {
      const setup = setUp(c, q.setup);
      if (!setup.ok) return setup;
      if (!hasNode(setup.value, q.node)) return unknownNode(q.node);
      const r = solveCertified(setup.value);
      if (!r.ok) return r;
      const value = r.value.solution.nodeVoltages[q.node] ?? 0;
      return measured([{ name: "value", value, unit: "V" }], [r.value.residuals]);
    }
    case "branch_current":
    case "power": {
      const setup = setUp(c, q.setup);
      if (!setup.ok) return setup;
      if (!setup.value.components.some((comp) => comp.id === q.component)) return unknownComponent(q.component);
      const r = solveCertified(setup.value);
      if (!r.ok) return r;
      const entry = r.value.solution.components[q.component];
      if (entry === undefined) return unknownComponent(q.component);
      if (q.kind === "branch_current") {
        return measured([{ name: "value", value: entry.current, unit: "A" }], [r.value.residuals]);
      }
      const value = q.sense === "delivered" ? -entry.power : entry.power;
      return measured([{ name: "value", value, unit: "W" }], [r.value.residuals]);
    }
    case "equivalent_resistance": {
      const r = equivalentResistance(c, q.a, q.b, q.remove);
      if (!r.ok) return r;
      return measured([{ name: "value", value: r.value.value, unit: "ohm" }], [r.value.residuals]);
    }
    case "thevenin": {
      const r = thevenin(c, q.a, q.b, q.remove);
      if (!r.ok) return r;
      return measured(
        [
          { name: "vth", value: r.value.vth, unit: "V" },
          { name: "rth", value: r.value.rth, unit: "ohm" },
        ],
        r.value.residuals,
      );
    }
    case "max_power_transfer": {
      const load = c.components.find((comp) => comp.id === q.load);
      if (load === undefined) return unknownComponent(q.load);
      const r = thevenin(c, load.a, load.b, [q.load]);
      if (!r.ok) return r;
      const { vth, rth } = r.value;
      if (closeTo(rth, 0)) {
        return fail("singular", `The circuit seen by ${q.load} has zero resistance, so no load value gives the most power.`);
      }
      return measured(
        [
          { name: "resistance", value: rth, unit: "ohm" },
          { name: "power", value: (vth * vth) / (4 * rth), unit: "W" },
        ],
        r.value.residuals,
      );
    }
    case "component_value_for_condition":
      return fail(
        "not_measurable",
        "A component value for a condition cannot be measured on its own. The checker tests the claimed value instead.",
      );
    case "graph_value":
    case "graph_slope":
    case "graph_area":
    case "graph_extremum":
      return fail("wrong_structure", "This question is about a graph, but the structure is a circuit.");
  }
}

function graphFailure(e: GraphError): Result<never, MeasureError> {
  return fail(e.code === "wrong_kind" ? "wrong_structure" : e.code, e.message);
}

function graphValue(r: Result<number, GraphError>): Result<Measurement, MeasureError> {
  if (!r.ok) return graphFailure(r.error);
  return ok({ values: [{ name: "value", value: r.value, unit: "" }], residuals: null });
}

function measureGraph(g: Graph, q: Query): Result<Measurement, MeasureError> {
  switch (q.kind) {
    case "graph_value":
    case "graph_slope":
    case "graph_area":
    case "graph_extremum": {
      const found = findSeries(g, q.series);
      if (!found.ok) return graphFailure(found.error);
      const s = found.value;
      if (q.kind === "graph_value") return graphValue(valueAt(s, q.x));
      if (q.kind === "graph_slope") return graphValue(slope(s, q.x1, q.x2));
      if (q.kind === "graph_area") return graphValue(area(s, q.x1, q.x2));
      const e = extremum(s, q.which);
      if (!e.ok) return graphFailure(e.error);
      return ok({
        values: [
          { name: "x", value: e.value.x, unit: "" },
          { name: "value", value: e.value.y, unit: "" },
        ],
        residuals: null,
      });
    }
    default:
      return fail("wrong_structure", "This question is about a circuit, but the structure is a graph.");
  }
}

export function measure(s: Structure, q: Query): Result<Measurement, MeasureError> {
  return s.kind === "graph" ? measureGraph(s, q) : measureCircuit(s, q);
}
