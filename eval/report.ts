/**
 * Core eval: verify every expected claim, then check that wrong numbers are rejected.
 * Pure functions. The CLI lives in eval/run.ts.
 */
import { checkClaim } from "../src/core/checker";
import { Unit, claimedValues } from "../src/core/schema";
import type { CheckReport, Claim } from "../src/core/schema";
import { formatQuantity, unitFor } from "../src/core/units";
import type { Problem } from "./types";

export type CoreRow = {
  id: string;
  title: string;
  expected: string;
  verified: boolean;
  mutationsRejected: number;
  mutationsTotal: number;
};

export type CoreResult = {
  rows: CoreRow[];
  verified: number;
  mutationsRejected: number;
  mutationsTotal: number;
};

const FACTORS: ((v: number) => number)[] = [(v) => v * 1.05, (v) => -v, (v) => v * 1000];
// A design claim is checked through its condition, and a 5% change in the component can move the
// condition by less than the 1% tolerance (c11: R2 x 1.05 moves V(B) by 0.96%). So design claims
// are mutated by 25% instead of 5%.
const DESIGN_FACTORS: ((v: number) => number)[] = [(v) => v * 1.25, (v) => -v, (v) => v * 1000];

function withValue(claim: Claim, name: string, value: number): Claim {
  return Object.assign({}, claim, { [name]: value });
}

function asUnit(text: string): Unit {
  const parsed = Unit.safeParse(text);
  return parsed.success ? parsed.data : "";
}

function expectedText(claim: Claim, report: CheckReport, truth: Problem["truth"]): string {
  // A design claim's report items hold the condition (for example 9 V); the answer is the component value.
  if (claim.kind === "component_value_for_condition") {
    const comp = truth.kind === "circuit" ? truth.components.find((c) => c.id === claim.component) : undefined;
    return formatQuantity(claim.value, comp ? unitFor(comp.type) : "");
  }
  if (report.items.length > 0) {
    return report.items.map((i) => formatQuantity(i.claimed, asUnit(i.unit))).join(", ");
  }
  return claimedValues(claim)
    .map((c) => formatQuantity(c.value, ""))
    .join(", ");
}

function runProblem(problem: Problem): CoreRow {
  const { truth, expected } = problem;
  const report = checkClaim(truth, expected);

  let mutationsRejected = 0;
  let mutationsTotal = 0;
  for (const { name, value } of claimedValues(expected)) {
    const factors = expected.kind === "component_value_for_condition" ? DESIGN_FACTORS : FACTORS;
    for (const factor of factors) {
      const mutated = withValue(expected, name, factor(value));
      mutationsTotal += 1;
      if (!checkClaim(truth, mutated).verified) mutationsRejected += 1;
    }
  }

  return {
    id: problem.id,
    title: problem.title,
    expected: expectedText(expected, report, truth),
    verified: report.verified,
    mutationsRejected,
    mutationsTotal,
  };
}

/**
 * Graph problems are skipped until measure() supports graph queries (WP-26).
 */
export function runCore(problems: Problem[]): CoreResult {
  const rows = problems.filter((p) => p.truth.kind !== "graph").map(runProblem);
  return {
    rows,
    verified: rows.filter((r) => r.verified).length,
    mutationsRejected: rows.reduce((n, r) => n + r.mutationsRejected, 0),
    mutationsTotal: rows.reduce((n, r) => n + r.mutationsTotal, 0),
  };
}

export function coreTable(result: CoreResult): string {
  const lines = [
    "| Id | Title | Expected answer | Verified | Mutations rejected |",
    "|---|---|---|---|---|",
    ...result.rows.map(
      (r) =>
        `| ${r.id} | ${r.title} | ${r.expected} | ${r.verified ? "yes" : "no"} | ${r.mutationsRejected}/${r.mutationsTotal} |`,
    ),
    `| **Total** | | | ${result.verified}/${result.rows.length} | ${result.mutationsRejected}/${result.mutationsTotal} |`,
  ];
  return lines.join("\n");
}
