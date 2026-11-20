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

export type MessagesApi = Pick<Anthropic["beta"]["messages"], "parse" | "stream">;

type ErrorCode = ModelError["code"];

function isAbort(e: unknown): boolean {
  if (e instanceof APIUserAbortError) return true;
  return e instanceof Error && e.name === "AbortError";
}

/**
 * Maps any thrown value to a ModelError. The message never repeats the original
 * error text, which can hold request details; it keeps the HTTP status and the
 * error type only.
 */
export function toModelError(e: unknown, fallbackCode: ErrorCode): ModelError {
  if (e instanceof ModelError) return e;
  if (isAbort(e)) return new ModelError("cancelled", "The request was cancelled.");
  if (e instanceof APIError) {
    const status = e.status ?? "none";
    const type = e.type ?? "unknown";
    return new ModelError(fallbackCode, `The model request failed (status ${status}, type ${type}).`);
  }
  return new ModelError(fallbackCode, "The model request failed.");
}

export function usageOf(message: Pick<BetaMessage, "usage">): Usage {
  return { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
}
