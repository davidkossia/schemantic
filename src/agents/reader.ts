import { AnthropicError, APIError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AutoParseableBetaOutputFormat } from "@anthropic-ai/sdk/lib/beta-parser";
import { z } from "zod";
import { Structure } from "../core/schema";
import { ModelError } from "../pipeline/model";
import type { ImageInput, ReadInput, ReadOutput, Usage } from "../pipeline/model";
import { baseParams, toModelError, usageOf } from "./client";
import type { MessagesApi } from "./client";
import { READER_SYSTEM } from "./prompts";

export const ReaderOutput = z.object({ structure: Structure });
export type ReaderOutput = z.infer<typeof ReaderOutput>;

/**
 * The output format for the reader. The schema sent to the API is the one from
 * `betaZodOutputFormat`. Its `parse` is replaced: the SDK's own throws when the
 * reply fails the schema and discards the message, so the tokens of that call
 * would be lost. This one validates with `ReaderOutput.safeParse` and returns
 * null instead, so a bad reply is a null `parsed_output` with its usage intact.
 * `parse` is a function, so it is never part of the request body.
 */
export function readerFormat(): AutoParseableBetaOutputFormat<ReaderOutput | null> {
  return {
    ...betaZodOutputFormat(ReaderOutput),
    parse(content: string): ReaderOutput | null {
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        return null;
      }
      const result = ReaderOutput.safeParse(json);
      return result.success ? result.data : null;
    },
  };
}

function request(image: ImageInput, question: string) {
  return {
    ...baseParams(),
    max_tokens: 16000,
    system: READER_SYSTEM,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
          },
          { type: "text" as const, text: question },
        ],
      },
    ],
    output_config: { effort: "high" as const, format: readerFormat() },
  };
}

function isStructuredOutputParseError(e: unknown): boolean {
  return (
    e instanceof AnthropicError &&
    !(e instanceof APIError) &&
    e.message.startsWith("Failed to parse structured output")
  );
}

export async function readStructure(api: MessagesApi, input: ReadInput): Promise<ReadOutput> {
  const image = input.image;
  if (image === null) throw new ModelError("read_failed", "No image was given to read.");

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    let message;
    try {
      message = await api.parse(request(image, input.question), { signal: input.signal });
    } catch (e) {
      // `readerFormat` keeps the SDK from throwing on a reply that fails the schema. If an SDK
      // version throws its parse error anyway, it is still a bad read and gets the same one retry;
      // the tokens of that call are unknown, because the SDK discards the message.
      if (attempt === 0 && isStructuredOutputParseError(e)) continue;
      throw toModelError(e, "read_failed", { ...usage });
    }
    const u = usageOf(message);
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;

    if (message.stop_reason === "refusal") {
      throw new ModelError("refused", "The model declined to read this image.", { ...usage });
    }
    const parsed = message.parsed_output;
    if (parsed !== null && message.stop_reason !== "max_tokens") {
      return { structure: parsed.structure, usage };
    }
  }
  throw new ModelError("read_failed", "The model did not return a readable structure.", { ...usage });
}
