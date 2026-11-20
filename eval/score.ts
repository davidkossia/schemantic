/**
 * Score a reading against ground truth: netlist match up to node renaming, graph points within tolerance.
 *
 * `scoreNetlist` tries every way to map the truth nodes onto the read nodes and keeps the best.
 * Component ids and labels do not count.
 */
import type { Circuit, Component } from "../src/core/schema";
import { closeTo } from "../src/core/units";

export type NetlistScore = {
  truthCount: number;
  readCount: number;
  matched: number;
  recall: number; // matched / truthCount
  precision: number; // matched / readCount, or 0 when readCount is 0
  exact: boolean; // matched === truthCount && matched === readCount
  mapping: Record<string, string | null>; // truth node -> read node
};

const MAX_TRUTH_NODES = 7;

function nodesOf(c: Circuit): string[] {
  const seen = new Set<string>();
  for (const comp of c.components) {
    seen.add(comp.a);
    seen.add(comp.b);
  }
  seen.delete(c.ground);
  return [...seen];
}

function isMatch(truth: Component, read: Component, ma: string | null | undefined, mb: string | null | undefined): boolean {
  if (truth.type !== read.type) return false;
  if (ma == null || mb == null) return false;
  if (truth.type === "resistor") {
    if (!closeTo(read.value, truth.value)) return false;
    return (read.a === ma && read.b === mb) || (read.a === mb && read.b === ma);
  }
  if (read.a === ma && read.b === mb && closeTo(read.value, truth.value)) return true;
  return read.a === mb && read.b === ma && closeTo(read.value, -truth.value);
}

function countMatches(truth: Circuit, read: Circuit, map: Map<string, string | null>): number {
  const used = new Set<number>();
  let matched = 0;
  for (const t of truth.components) {
    const ma = map.get(t.a);
    const mb = map.get(t.b);
    for (let i = 0; i < read.components.length; i++) {
      const r = read.components[i];
      if (r === undefined || used.has(i)) continue;
      if (isMatch(t, r, ma, mb)) {
        used.add(i);
        matched++;
        break;
      }
    }
  }
  return matched;
}

export function scoreNetlist(truth: Circuit, read: Circuit): NetlistScore {
  const truthNodes = nodesOf(truth);
  if (truthNodes.length > MAX_TRUTH_NODES) {
    throw new Error(`scoreNetlist: ${truthNodes.length} truth nodes besides ground; the limit is ${MAX_TRUTH_NODES}`);
  }
  const readNodes = nodesOf(read);

  const map = new Map<string, string | null>([[truth.ground, read.ground]]);
  let best = -1;
  let bestMap = new Map(map);
  const taken = new Set<string>();

  const walk = (i: number): void => {
    if (i === truthNodes.length) {
      const m = countMatches(truth, read, map);
      if (m > best) {
        best = m;
        bestMap = new Map(map);
      }
      return;
    }
    const node = truthNodes[i];
    if (node === undefined) return;
    for (const candidate of readNodes) {
      if (taken.has(candidate)) continue;
      taken.add(candidate);
      map.set(node, candidate);
      walk(i + 1);
      taken.delete(candidate);
    }
    map.set(node, null);
    walk(i + 1);
    map.delete(node);
  };
  walk(0);

  const truthCount = truth.components.length;
  const readCount = read.components.length;
  const matched = Math.max(best, 0);
  const mapping: Record<string, string | null> = {};
  for (const [k, v] of bestMap) mapping[k] = v;

  return {
    truthCount,
    readCount,
    matched,
    recall: truthCount === 0 ? 0 : matched / truthCount,
    precision: readCount === 0 ? 0 : matched / readCount,
    exact: matched === truthCount && matched === readCount,
    mapping,
  };
}
