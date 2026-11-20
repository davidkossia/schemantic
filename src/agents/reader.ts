import { AnthropicError, APIError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { Structure } from "../core/schema";
import { ModelError } from "../pipeline/model";
import type { ImageInput, ReadInput, ReadOutput, Usage } from "../pipeline/model";
import { baseParams, toModelError, usageOf } from "./client";
import type { MessagesApi } from "./client";
import { READER_SYSTEM } from "./prompts";

export const ReaderOutput = z.object({ structure: Structure });

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
    output_config: { effort: "high" as const, format: betaZodOutputFormat(ReaderOutput) },
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
      // SDK 1.8.0 throws (rather than returning a null parsed_output) when the reply's JSON fails the
      // schema. That is a bad read, not a transport failure, so it gets the same one retry.
      // The tokens of the failed call are not counted, because the SDK discards the message.
      if (attempt === 0 && isStructuredOutputParseError(e)) continue;
      throw toModelError(e, "read_failed");
    }
    const u = usageOf(message);
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;

    if (message.stop_reason === "refusal") throw new ModelError("refused", "The model declined to read this image.");
    if (message.parsed_output !== null && message.stop_reason !== "max_tokens") {
      return { structure: message.parsed_output.structure, usage };
    }
  }
  throw new ModelError("read_failed", "The model did not return a readable structure.");
}
