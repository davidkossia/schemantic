import type {
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { TOOL_SPECS } from "../core/tools";
import { ModelError } from "../pipeline/model";
import type { SolveInput, SolveOutput, Usage } from "../pipeline/model";
import { LIMITS } from "../shared/limits";
import { addUsage, baseParams, toModelError, unfinishedUsage, usageOf } from "./client";
import type { MessagesApi, UnfinishedStream } from "./client";
import { SOLVER_SYSTEM } from "./prompts";

export const NUDGE = "Finish by calling submit_answer with your claim.";

function toolDefinitions(): BetaTool[] {
  return TOOL_SPECS.map((spec) => {
    const schema = z.toJSONSchema(spec.input);
    if (schema.type !== "object") throw new Error(`The input of tool ${spec.name} must be an object.`);
    return {
      name: spec.name,
      description: spec.description,
      input_schema: { ...schema, type: "object" },
      strict: true,
    };
  });
}

function firstMessage(input: SolveInput): string {
  const parts = [
    `Question: ${input.question}`,
    `Approved structure (JSON):\n${JSON.stringify(input.structure, null, 2)}`,
  ];
  const report = input.feedback;
  if (report !== null) {
    const notes = report.notes.length > 0 ? report.notes.map((n) => `- ${n}`).join("\n") : "- (none)";
    const items =
      report.items.length > 0
        ? report.items
            .map(
              (i) =>
                `- ${i.name}: claimed ${i.claimed}, measured ${i.measured}${i.unit ? ` ${i.unit}` : ""}, ${i.ok ? "ok" : "failed"}`,
            )
            .join("\n")
        : "- (none)";
    parts.push(
      `Your previous answer to this question failed the check. Find the mistake before you answer again.\nCheck notes:\n${notes}\nCheck items:\n${items}`,
    );
  }
  return parts.join("\n\n");
}

function cancelled(): ModelError {
  return new ModelError("cancelled", "The request was cancelled.");
}

export async function solveWithTools(
  api: MessagesApi,
  input: SolveInput,
  limits: { maxTurns: number } = { maxTurns: LIMITS.maxSolveTurns },
): Promise<SolveOutput> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const tools = toolDefinitions();
  const messages: BetaMessageParam[] = [{ role: "user", content: firstMessage(input) }];
  let streamed = "";
  let nudged = false;
  // The stream of the turn in progress, until its final message arrives. On a throw, its usage so far is counted.
  let unfinished: UnfinishedStream | null = null;

  try {
    for (let turn = 0; turn < limits.maxTurns; turn++) {
      if (input.signal.aborted) throw cancelled();
      if (usage.inputTokens + usage.outputTokens >= input.tokenBudget) {
        throw new ModelError("limit_reached", "This session has used its token budget.");
      }
      const stream = api.stream(
        {
          ...baseParams(),
          max_tokens: 16000,
          system: SOLVER_SYSTEM,
          tools,
          messages: [...messages],
          output_config: { effort: "high" },
        },
        { signal: input.signal },
      );
      unfinished = stream;
      stream.on("text", (delta) => {
        streamed += delta;
        input.onEvent({ type: "token", text: delta });
      });
      const message = await stream.finalMessage();
      unfinished = null;
      addUsage(usage, usageOf(message));

      const stop = message.stop_reason;
      if (stop === "refusal") throw new ModelError("refused", "The model declined to solve this problem.");
      if (stop === "max_tokens") throw new ModelError("solve_failed", "The model's reply was cut off.");
      if (stop === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      if (stop === "tool_use") {
        messages.push({ role: "assistant", content: message.content });
        const results: BetaToolResultBlockParam[] = [];
        for (const block of message.content) {
          if (block.type !== "tool_use") continue;
          const output = input.tools.run(block.name, block.input);
          input.onEvent({ type: "step", tool: block.name, input: block.input, output });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(output),
            is_error: !output.ok,
          });
        }
        messages.push({ role: "user", content: results });
        if (input.tools.claim() !== null) break;
        continue;
      }
      if (stop === "end_turn") {
        if (input.tools.claim() === null && !nudged) {
          nudged = true;
          messages.push({ role: "assistant", content: message.content });
          messages.push({ role: "user", content: NUDGE });
          continue;
        }
        // A second end_turn, or an end_turn after a claim, ends the loop.
        break;
      }
      // Any other stop reason (for example model_context_window_exceeded) is a failed solve.
      throw new ModelError("solve_failed", "The model stopped for a reason the solver does not handle.");
    }
  } catch (e) {
    // Every error carries the usage spent so far, so the session can count it. That includes a turn
    // that was aborted, timed out or failed mid-stream: its tokens were spent even with no final message.
    addUsage(usage, unfinishedUsage(unfinished));
    throw toModelError(e, "solve_failed", { ...usage });
  }

  const result = input.tools.claim();
  return {
    claim: result === null ? null : result.claim,
    text: result === null ? streamed : result.explanation,
    usage,
  };
}
