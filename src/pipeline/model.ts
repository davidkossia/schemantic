import { z } from "zod";
import type { CheckReport, Claim, Structure } from "../core/schema";
import type { ToolOutput, ToolRunner } from "../core/tools";

export const Usage = z.object({ inputTokens: z.number(), outputTokens: z.number() });
export type Usage = z.infer<typeof Usage>;

export const ImageInput = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  base64: z.string(),
});
export type ImageInput = z.infer<typeof ImageInput>;

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
  tokenBudget: number;               // tokens the session has left; the solve stops before a turn once its usage reaches this
  onEvent: (e: SolveEvent) => void;
  signal: AbortSignal;
};
export type SolveOutput = { claim: Claim | null; text: string; usage: Usage };

export interface ModelClient {
  readonly mode: "live" | "replay";
  read(input: ReadInput): Promise<ReadOutput>;
  solve(input: SolveInput): Promise<SolveOutput>;
}

/** `usage` is what the failed call spent before it threw, when that is known. */
export class ModelError extends Error {
  constructor(
    public code: "refused" | "read_failed" | "solve_failed" | "limit_reached" | "cancelled",
    message: string,
    public usage?: Usage,
  ) {
    super(message);
  }
}
