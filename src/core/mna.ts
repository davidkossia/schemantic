/**
 * Modified nodal analysis solver for DC circuits of resistors, voltage
 * sources and current sources.
 */
import { solveLinear } from "./linear";
import { err, ok } from "./schema";
import type { Circuit, Component, ComponentType, Result, Setup, Solution, SolveError } from "./schema";

/** The shape of a solver-tool change. `Change` in `tools.ts` is structurally the same. */
export type ChangeInput = {
  op: "set_value" | "remove" | "zero" | "add";
  id: string;
  type: ComponentType | null;
  value: number | null;
  a: string | null;
  b: string | null;
};

function fail(code: SolveError["code"], message: string): Result<never, SolveError> {
  return err({ code, message });
}

export function solveCircuit(c: Circuit): Result<Solution, SolveError> {
  const comps = c.components;
  if (comps.length === 0) return fail("empty", "The circuit has no components.");

  const seen = new Set<string>();
  for (const comp of comps) {
    if (seen.has(comp.id)) return fail("duplicate_id", `Two components share the id ${comp.id}.`);
    seen.add(comp.id);
  }
  for (const comp of comps) {
    if (comp.type === "unknown") return fail("unknown_component", `Component ${comp.id} has an unknown type.`);
  }
  for (const comp of comps) {
    if (!Number.isFinite(comp.value) || (comp.type === "resistor" && comp.value <= 0)) {
      return fail("invalid_value", `Component ${comp.id} has a value that cannot be used.`);
    }
  }
  if (!comps.some((comp) => comp.a === c.ground || comp.b === c.ground)) {
    return fail("no_ground", `No component touches the ground node ${c.ground}.`);
  }

  const nodeIndex = new Map<string, number>();
  for (const comp of comps) {
    for (const n of [comp.a, comp.b]) {
      if (n !== c.ground && !nodeIndex.has(n)) nodeIndex.set(n, nodeIndex.size);
    }
  }
  const nodeCount = nodeIndex.size;
  const sources = comps.filter((comp) => comp.type === "voltage_source");
  const size = nodeCount + sources.length;

  const A: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const z: number[] = new Array<number>(size).fill(0);
  const add = (r: number | undefined, col: number | undefined, v: number): void => {
    if (r === undefined || col === undefined) return;
    const row = A[r];
    if (row !== undefined) row[col] = (row[col] ?? 0) + v;
  };
  const addZ = (r: number | undefined, v: number): void => {
    if (r === undefined) return;
    z[r] = (z[r] ?? 0) + v;
  };

  let k = nodeCount;
  const sourceRow = new Map<string, number>();
  for (const comp of comps) {
    const i = nodeIndex.get(comp.a);
    const j = nodeIndex.get(comp.b);
    if (comp.type === "resistor") {
      const g = 1 / comp.value;
      add(i, i, g);
      add(j, j, g);
      add(i, j, -g);
      add(j, i, -g);
    } else if (comp.type === "current_source") {
      addZ(i, comp.value);
      addZ(j, -comp.value);
    } else {
      sourceRow.set(comp.id, k);
      add(i, k, 1);
      add(k, i, 1);
      add(j, k, -1);
      add(k, j, -1);
      z[k] = comp.value;
      k++;
    }
  }

  const x = solveLinear(A, z);
  if (x === null) return fail("singular", "The circuit equations have no single solution.");

  const nodeVoltages: Record<string, number> = { [c.ground]: 0 };
  for (const [name, idx] of nodeIndex) nodeVoltages[name] = x[idx] ?? 0;

  const components: Solution["components"] = {};
  for (const comp of comps) {
    const voltage = (nodeVoltages[comp.a] ?? 0) - (nodeVoltages[comp.b] ?? 0);
    let current: number;
    if (comp.type === "resistor") current = voltage / comp.value;
    else if (comp.type === "current_source") current = -comp.value;
    else current = x[sourceRow.get(comp.id) ?? 0] ?? 0;
    components[comp.id] = { voltage, current, power: voltage * current };
  }
  return ok({ nodeVoltages, components });
}

function cloneCircuit(c: Circuit): Circuit {
  return { ...c, components: c.components.map((comp) => ({ ...comp })) };
}

function unknownId(id: string): Result<never, SolveError> {
  return fail("unknown_id", `There is no component with the id ${id}.`);
}

function removeId(c: Circuit, id: string): Result<Circuit, SolveError> {
  if (!c.components.some((comp) => comp.id === id)) return unknownId(id);
  return ok({ ...c, components: c.components.filter((comp) => comp.id !== id) });
}

function zeroId(c: Circuit, id: string): Result<Circuit, SolveError> {
  const target = c.components.find((comp) => comp.id === id);
  if (target === undefined || target.type === "resistor" || target.type === "unknown") return unknownId(id);
  if (target.type === "current_source") return removeId(c, id);
  return ok({
    ...c,
    components: c.components.map((comp) => (comp.id === id ? { ...comp, value: 0 } : comp)),
  });
}

export function applySetup(c: Circuit, setup: Setup): Result<Circuit, SolveError> {
  let cur = cloneCircuit(c);
  for (const id of setup.remove) {
    const r = removeId(cur, id);
    if (!r.ok) return r;
    cur = r.value;
  }
  for (const id of setup.zero) {
    const r = zeroId(cur, id);
    if (!r.ok) return r;
    cur = r.value;
  }
  return ok(cur);
}

export function applyChanges(c: Circuit, changes: ChangeInput[]): Result<Circuit, SolveError> {
  let cur = cloneCircuit(c);
  for (const ch of changes) {
    if (ch.op === "remove") {
      const r = removeId(cur, ch.id);
      if (!r.ok) return r;
      cur = r.value;
    } else if (ch.op === "zero") {
      const r = zeroId(cur, ch.id);
      if (!r.ok) return r;
      cur = r.value;
    } else if (ch.op === "set_value") {
      if (!cur.components.some((comp) => comp.id === ch.id)) return unknownId(ch.id);
      if (ch.value === null) return fail("invalid_value", `set_value on ${ch.id} needs a value.`);
      const value = ch.value;
      cur = {
        ...cur,
        components: cur.components.map((comp) => (comp.id === ch.id ? { ...comp, value } : comp)),
      };
    } else {
      if (ch.type === null || ch.type === "unknown" || ch.value === null || ch.a === null || ch.b === null) {
        return fail("invalid_value", `add of ${ch.id} needs a type, a value, a and b.`);
      }
      if (cur.components.some((comp) => comp.id === ch.id)) {
        return fail("duplicate_id", `A component with the id ${ch.id} already exists.`);
      }
      const added: Component = {
        id: ch.id,
        type: ch.type,
        label: "",
        value: ch.value,
        a: ch.a,
        b: ch.b,
        pa: null,
        pb: null,
        uncertain: null,
      };
      cur = { ...cur, components: [...cur.components, added] };
    }
  }
  return ok(cur);
}
