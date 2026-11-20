/**
 * Verify a typed claim against the approved structure with element laws: Ohm's law, KCL, power balance, units, tolerance.
 */
import { measure } from "./measure";
import { applyChanges } from "./mna";
import { claimedValues, queryOf } from "./schema";
import type { Claim, CheckItem, CheckReport, MeasureError, Query, Residuals, Structure, Unit } from "./schema";
import { closeTo, formatQuantity, unitFor } from "./units";

function failed(note: string): CheckReport {
  return { verified: false, items: [], residuals: null, notes: [note] };
}

function describe(e: MeasureError): string {
  return e.message.endsWith(".") ? e.message : `${e.message}.`;
}

function finish(items: CheckItem[], residuals: Residuals | null, notes: string[]): CheckReport {
  return { verified: items.length > 0 && items.every((i) => i.ok), items, residuals, notes };
}

function checkConditionClaim(
  structure: Structure,
  claim: Extract<Claim, { kind: "component_value_for_condition" }>,
): CheckReport {
  if (structure.kind !== "circuit") return failed("This question is about a circuit, but the structure is a graph.");
  if (!Number.isFinite(claim.value)) return failed(`The claimed value for ${claim.component} is not a finite number.`);
  const target = structure.components.find((c) => c.id === claim.component);
  if (target && target.type === "resistor" && claim.value <= 0) {
    return failed(`A resistor cannot have a value of ${claim.value} or less.`);
  }

  const changed = applyChanges(structure, [
    { op: "set_value", id: claim.component, type: null, value: claim.value, a: null, b: null },
  ]);
  if (!changed.ok) return failed(describe(changed.error));

  const empty = { remove: [], zero: [] };
  const { condition } = claim;
  let query: Query;
  if (condition.kind === "node_voltage") query = { kind: "node_voltage", node: condition.target, setup: empty };
  else if (condition.kind === "branch_current") {
    query = { kind: "branch_current", component: condition.target, setup: empty };
  } else query = { kind: "power", component: condition.target, sense: "absorbed", setup: empty };

  const m = measure(changed.value, query);
  if (!m.ok) return failed(describe(m.error));
  const got = m.value.values[0];
  if (!got) return failed("The measurement returned no value.");

  const ok = closeTo(got.value, condition.value);
  const notes: string[] = [];
  if (!ok) {
    const unit: Unit = got.unit;
    notes.push(
      `With ${claim.component} at ${formatQuantity(claim.value, target ? unitFor(target.type) : "")}, the circuit gives ${formatQuantity(got.value, unit)}. The condition needs ${formatQuantity(condition.value, unit)}.`,
    );
  }
  return finish([{ name: "condition", claimed: condition.value, measured: got.value, unit: got.unit, ok }], m.value.residuals, notes);
}

export function checkClaim(structure: Structure, claim: Claim): CheckReport {
  if (claim.kind === "component_value_for_condition") return checkConditionClaim(structure, claim);

  const m = measure(structure, queryOf(claim));
  if (!m.ok) return failed(describe(m.error));

  const items: CheckItem[] = [];
  const notes: string[] = [];
  for (const { name, value } of claimedValues(claim)) {
    const got = m.value.values.find((v) => v.name === name);
    if (!got) return failed(`The measurement has no value named ${name}.`);
    const ok = closeTo(value, got.value);
    items.push({ name, claimed: value, measured: got.value, unit: got.unit, ok });
    if (!ok) {
      notes.push(
        `The claimed value is ${formatQuantity(value, got.unit)}. The circuit gives ${formatQuantity(got.value, got.unit)}.`,
      );
    }
  }
  return finish(items, m.value.residuals, notes);
}
