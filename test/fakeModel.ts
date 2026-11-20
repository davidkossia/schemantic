/**
 * A ModelClient for session tests. The test scripts what each read and solve call does.
 */
import type { ModelClient, ReadInput, ReadOutput, SolveInput, SolveOutput } from "../src/pipeline/model";

/** What one model call does. */
export type Scripted<I, O> =
  | { kind: "return"; output: O } // resolves at once
  | { kind: "hold"; output: O } // resolves when the test calls release()
  | { kind: "throw"; error: unknown } // rejects with this value
  | { kind: "run"; run: (input: I) => O | Promise<O> }; // the test's own code

export type FakeScript = {
  mode?: "live" | "replay";
  /** Used in order. The last entry repeats when the list runs out. */
  read?: Scripted<ReadInput, ReadOutput>[];
  /** Used in order. The last entry repeats when the list runs out. */
  solve?: Scripted<SolveInput, SolveOutput>[];
};

export type FakeModel = ModelClient & {
  readonly readCalls: ReadInput[];
  readonly solveCalls: SolveInput[];
  /** Resolve every held call that is still waiting. */
  release(): void;
};

export function createFakeModel(script: FakeScript): FakeModel {
  const readCalls: ReadInput[] = [];
  const solveCalls: SolveInput[] = [];
  let held: (() => void)[] = [];

  function play<I, O>(entries: Scripted<I, O>[] | undefined, index: number, input: I, what: string): Promise<O> {
    const entry = entries?.[Math.min(index, entries.length - 1)];
    if (!entry) return Promise.reject(new Error(`The fake model has no ${what} result.`));
    switch (entry.kind) {
      case "return":
        return Promise.resolve(entry.output);
      case "hold":
        return new Promise<O>((resolve) => {
          held.push(() => resolve(entry.output));
        });
      case "throw":
        return Promise.reject(entry.error);
      case "run":
        try {
          return Promise.resolve(entry.run(input));
        } catch (e) {
          return Promise.reject(e);
        }
    }
  }

  return {
    mode: script.mode ?? "replay",
    readCalls,
    solveCalls,
    read(input) {
      readCalls.push(input);
      return play(script.read, readCalls.length - 1, input, "read");
    },
    solve(input) {
      solveCalls.push(input);
      return play(script.solve, solveCalls.length - 1, input, "solve");
    },
    release() {
      const waiting = held;
      held = [];
      for (const resolve of waiting) resolve();
    },
  };
}
