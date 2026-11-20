import { Anthropic, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type { AnthropicBeta } from "@anthropic-ai/sdk/resources/beta/beta";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ModelError } from "../pipeline/model";
import type { Usage } from "../pipeline/model";

export const MODEL: string = process.env.SCHEMANTIC_MODEL ?? "claude-opus-5-5";

export const BETAS: AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

export function baseParams() {
  return { model: MODEL, betas: BETAS, fallbacks: "default" as const };
}

/** The SDK reads ANTHROPIC_API_KEY from the environment. Never pass, print or log the key. */
export function createAnthropic(): Anthropic {
  return new Anthropic();
}

/** The reader and the solver both stream, so a call that is cut off still reports the tokens it used. */
export type MessagesApi = Pick<Anthropic["beta"]["messages"], "stream">;

/**
 * The part of a stream that holds the message still being received. The SDK's `currentMessage` is
 * set from `message_start` until the message ends, so after an abort, a timeout or an error mid-stream
 * it holds that turn's usage: the full input tokens and the output tokens reported so far.
 */
export type UnfinishedStream = { readonly currentMessage: Pick<BetaMessage, "usage"> | undefined };

/** The usage of a stream that did not finish, or zero when there is none. */
export function unfinishedUsage(stream: UnfinishedStream | null): Usage {
  const message = stream?.currentMessage;
  return message === undefined ? { inputTokens: 0, outputTokens: 0 } : usageOf(message);
}

export function addUsage(total: Usage, u: Usage): void {
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
}

type ErrorCode = ModelError["code"];

function isAbort(e: unknown): boolean {
  if (e instanceof APIUserAbortError) return true;
  return e instanceof Error && e.name === "AbortError";
}

/**
 * Maps any thrown value to a ModelError. The message never repeats the original
 * error text, which can hold request details; it keeps the HTTP status and the
 * error type only. `usage` is what the call spent before the throw; it is
 * attached unless the error already carries its own.
 */
export function toModelError(e: unknown, fallbackCode: ErrorCode, usage?: Usage): ModelError {
  if (e instanceof ModelError) {
    return e.usage === undefined && usage !== undefined ? new ModelError(e.code, e.message, usage) : e;
  }
  if (isAbort(e)) return new ModelError("cancelled", "The request was cancelled.", usage);
  if (e instanceof APIError) {
    const status = e.status ?? "none";
    const type = e.type ?? "unknown";
    return new ModelError(fallbackCode, `The model request failed (status ${status}, type ${type}).`, usage);
  }
  return new ModelError(fallbackCode, "The model request failed.", usage);
}

export function usageOf(message: Pick<BetaMessage, "usage">): Usage {
  return { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
}
