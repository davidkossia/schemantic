/**
 * Scripted model client that calls no API. Used by tests and replay mode.
 * It reads recorded structures and answers by running the solver tools directly.
 * Pure: no Node built-ins, so it also runs in the browser.
 */
import { describeClaim } from "../core/describe";
import type { Circuit, Claim, Query, Structure } from "../core/schema";
import type { Change, ToolOutput } from "../core/tools";
import {
  ModelError,
  type ModelClient,
  type ReadInput,
  type ReadOutput,
  type SolveInput,
  type SolveOutput,
  type Usage,
} from "../pipeline/model";
import type { ReplayFixture } from "../../fixtures/replay";

export type ScriptedOptions = { fixtures: ReplayFixture[]; tokenDelayMs?: number };

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };
const UNSUPPORTED = "Replay mode cannot answer this kind of question. Run with an API key to use the live solver.";

type Failure = { failed: string };
type Solved = { nodeVoltages: Record<string, number>; components: Record<string, { voltage: number; current: number; power: number }> };

function isNumber(x: unknown): x is number {
  return typeof x === "number";
}

/** Narrow a successful `solve_circuit` output to its numbers, or describe why it is not usable. */
function readSolution(out: ToolOutput): Solved | Failure {
  if (!out.ok) return { failed: out.error };
  const volts = out["nodeVoltages"];
  const comps = out["components"];
  if (typeof volts !== "object" || volts === null || typeof comps !== "object" || comps === null) {
    return { failed: "The solver returned an unexpected result." };
  }
  const nodeVoltages: Record<string, number> = {};
  for (const [k, v] of Object.entries(volts)) if (isNumber(v)) nodeVoltages[k] = v;
  const components: Solved["components"] = {};
  for (const [k, v] of Object.entries(comps)) {
    if (typeof v !== "object" || v === null) continue;
    const entry = Object.fromEntries(Object.entries(v));
    const { voltage, current, power } = entry;
    if (isNumber(voltage) && isNumber(current) && isNumber(power)) components[k] = { voltage, current, power };
  }
  return { nodeVoltages, components };
}

function isFailure(x: Solved | Failure | number): x is Failure {
  return typeof x === "object" && "failed" in x;
}

function removes(ids: string[]): Change[] {
  return ids.map((id) => ({ op: "remove", id, type: null, value: null, a: null, b: null }));
}

function zeros(ids: string[]): Change[] {
  return ids.map((id) => ({ op: "zero", id, type: null, value: null, a: null, b: null }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function createScriptedClient(options: ScriptedOptions): ModelClient {
  const delay = options.tokenDelayMs ?? 0;
  const find = (sampleId: string | null): ReplayFixture | undefined =>
    sampleId === null ? undefined : options.fixtures.find((f) => f.sample.id === sampleId);

  return {
    mode: "replay",

    async read(input: ReadInput): Promise<ReadOutput> {
      const fixture = find(input.sampleId);
      if (!fixture) throw new ModelError("read_failed", "Replay mode reads only the sample problems.");
      return { structure: copy(fixture.reading), usage: { ...ZERO } };
    },

    async solve(input: SolveInput): Promise<SolveOutput> {
      const fixture = find(input.sampleId);
      if (!fixture) throw new ModelError("solve_failed", "Replay mode solves only the sample problems.");
      const query = fixture.query;
      const { structure, tools, signal, onEvent } = input;

      const checkAbort = (): void => {
        if (signal.aborted) throw new ModelError("cancelled", "The solve was cancelled.");
      };

      const call = (name: string, toolInput: unknown): ToolOutput => {
        checkAbort();
        const output = tools.run(name, toolInput);
        onEvent({ type: "step", tool: name, input: toolInput, output });
        return output;
      };

      const giveUp = (text: string): SolveOutput => ({ claim: null, text, usage: { ...ZERO } });

      const solve = (changes: Change[]): Solved | Failure => readSolution(call("solve_circuit", { changes }));

      const sourcesLeft = (c: Circuit, removed: string[]): string[] =>
        c.components
          .filter((k) => (k.type === "voltage_source" || k.type === "current_source") && !removed.includes(k.id))
          .map((k) => k.id);

      /** The resistance seen between a and b, from a 1 A test source. */
      const resistance = (c: Circuit, a: string, b: string, remove: string[]): number | Failure => {
        const changes: Change[] = [
          ...removes(remove),
          ...zeros(sourcesLeft(c, remove)),
          { op: "add", id: "Itest", type: "current_source", value: 1, a, b },
        ];
        const sol = solve(changes);
        if (isFailure(sol)) return sol;
        const va = sol.nodeVoltages[a];
        const vb = sol.nodeVoltages[b];
        if (va === undefined || vb === undefined) return { failed: `Node ${va === undefined ? a : b} is not in the circuit.` };
        return va - vb;
      };

      const answer = async (claim: Claim, steps: string): Promise<SolveOutput> => {
        const explanation = `${steps} The result is ${describeClaim(claim)}.`;
        const out = call("submit_answer", { claim, explanation });
        if (!out.ok) return giveUp(`The solver rejected the answer: ${out.error}`);
        for (const word of explanation.split(" ")) {
          checkAbort();
          if (delay > 0) await wait(delay);
          checkAbort();
          onEvent({ type: "token", text: `${word} ` });
        }
        return { claim, text: explanation, usage: { ...ZERO } };
      };

      return run(query, structure);

      async function run(q: Query, s: Structure): Promise<SolveOutput> {
        checkAbort();
        if (s.kind !== "circuit") return giveUp(UNSUPPORTED);
        switch (q.kind) {
          case "node_voltage":
          case "branch_current":
          case "power": {
            const sol = solve([...removes(q.setup.remove), ...zeros(q.setup.zero)]);
            if (isFailure(sol)) return giveUp(`The solver failed: ${sol.failed}`);
            const steps = "I solved the approved circuit with solve_circuit and read the value from the result.";
            if (q.kind === "node_voltage") {
              const v = sol.nodeVoltages[q.node];
              if (v === undefined) return giveUp(`The solver failed: node ${q.node} is not in the circuit.`);
              return answer({ ...q, value: v }, steps);
            }
            const comp = sol.components[q.component];
            if (comp === undefined) return giveUp(`The solver failed: ${q.component} is not in the circuit.`);
            if (q.kind === "branch_current") return answer({ ...q, value: comp.current }, steps);
            return answer({ ...q, value: q.sense === "delivered" ? -comp.power : comp.power }, steps);
          }
          case "equivalent_resistance": {
            const r = resistance(s, q.a, q.b, q.remove);
            if (isFailure(r)) return giveUp(`The solver failed: ${r.failed}`);
            return answer(
              { ...q, value: r },
              "I zeroed the sources, injected a 1 A test current with solve_circuit, and read the voltage across the terminals.",
            );
          }
          case "thevenin": {
            const open = solve(removes(q.remove));
            if (isFailure(open)) return giveUp(`The solver failed: ${open.failed}`);
            const va = open.nodeVoltages[q.a];
            const vb = open.nodeVoltages[q.b];
            if (va === undefined || vb === undefined) {
              return giveUp(`The solver failed: node ${va === undefined ? q.a : q.b} is not in the circuit.`);
            }
            const r = resistance(s, q.a, q.b, q.remove);
            if (isFailure(r)) return giveUp(`The solver failed: ${r.failed}`);
            return answer(
              { ...q, vth: va - vb, rth: r },
              "I solved the circuit with the load removed to get the open-circuit voltage. Then I zeroed the sources and injected a 1 A test current to get the resistance.",
            );
          }
          default:
            return giveUp(UNSUPPORTED);
        }
      }
    },
  };
}
