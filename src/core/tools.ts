import type { Claim } from "./schema";

export type ToolOutput = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export type ToolRunner = {
  run(name: string, input: unknown): ToolOutput;   // validates input with zod; never throws
  claim(): { claim: Claim; explanation: string } | null;  // the last accepted submit_answer
};
