import { AnthropicError, APIUserAbortError, AuthenticationError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MessagesApi } from "../src/agents/client";
import { READER_SYSTEM } from "../src/agents/prompts";
import { ReaderOutput, readStructure } from "../src/agents/reader";
import type { Structure } from "../src/core/schema";
import { ModelError } from "../src/pipeline/model";
import type { ReadInput } from "../src/pipeline/model";
import { messageStart, sdkStreamApi, textReply } from "./fakeModel";
import { circuit, resistor, vsource } from "./helpers";

const STRUCTURE: Structure = circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]);

type FakeMessage = {
  stop_reason: "end_turn" | "max_tokens" | "refusal";
  parsed_output: { structure: Structure } | null;
  usage: { input_tokens: number; output_tokens: number };
};

function message(
  parsed: { structure: Structure } | null,
  stop: FakeMessage["stop_reason"] = "end_turn",
  usage = { input_tokens: 100, output_tokens: 20 },
): FakeMessage {
  return { stop_reason: stop, parsed_output: parsed, usage };
}

/** A fake stream whose final message is `m`. */
function ok(m: FakeMessage) {
  return { currentMessage: undefined, finalMessage: () => Promise.resolve(m) };
}

/** A fake stream that fails with `error` after the message reported `partial` usage (none when omitted). */
function fail(error: unknown, partial?: { input_tokens: number; output_tokens: number }) {
  return {
    currentMessage: partial === undefined ? undefined : { usage: partial },
    finalMessage: () => Promise.reject(error),
  };
}

function fakeApi() {
  const stream = vi.fn();
  const api: MessagesApi = { stream };
  return { api, stream };
}

function input(overrides: Partial<ReadInput> = {}): ReadInput {
  return {
    image: { mediaType: "image/webp", base64: "AAAA" },
    sampleId: null,
    question: "Find the current through R1.",
    tokenBudget: 200_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function rejection(p: Promise<unknown>): Promise<ModelError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ModelError) return e;
    throw new Error(`expected a ModelError, got ${String(e)}`);
  }
  throw new Error("expected a rejection");
}

describe("readStructure", () => {
  it("returns the structure and the usage from a good response", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValueOnce(ok(message({ structure: STRUCTURE })));
    const out = await readStructure(api, input());
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("sends the model, both fallback fields, high effort, a format, the image and the question", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValueOnce(ok(message({ structure: STRUCTURE })));
    const signal = new AbortController().signal;
    await readStructure(api, input({ signal }));

    const call: unknown[] = stream.mock.calls[0] ?? [];
    const [params, options] = call;
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 16000,
      system: READER_SYSTEM,
      output_config: { effort: "high", format: expect.objectContaining({ type: "json_schema" }) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/webp", data: "AAAA" } },
            { type: "text", text: "Find the current through R1." },
          ],
        },
      ],
    });
    expect(options).toEqual({ signal });
  });

  it("rejects with refused on a refusal, carrying the usage", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValueOnce(ok(message(null, "refusal")));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("refused");
    expect(e.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("counts the tokens of a reply that fails the schema, through the real SDK stream and its parse step", async () => {
    const api = sdkStreamApi([
      textReply('{"structure": {"kind": "nonsense"}}', 100, 7),
      textReply(JSON.stringify({ structure: STRUCTURE }), 110, 30),
    ]);
    const out = await readStructure(api, input());
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 210, outputTokens: 37 });
  });

  it("rejects with read_failed carrying the tokens of both calls when both replies fail to parse", async () => {
    const api = sdkStreamApi([textReply("{not json", 100, 5)]);
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(e.usage).toEqual({ inputTokens: 200, outputTokens: 10 });
  });

  it("counts the tokens of a read aborted mid-stream, through the real SDK stream", async () => {
    const controller = new AbortController();
    const api = sdkStreamApi([{ events: [messageStart(50_000)], hang: true }], () => controller.abort());
    const e = await rejection(readStructure(api, input({ signal: controller.signal })));
    expect(e.code).toBe("cancelled");
    expect(e.usage).toEqual({ inputTokens: 50_000, outputTokens: 1 });
  });

  it("adds an aborted retry's partial tokens to the first call's", async () => {
    const { api, stream } = fakeApi();
    stream
      .mockReturnValueOnce(ok(message(null, "end_turn", { input_tokens: 100, output_tokens: 5 })))
      .mockReturnValueOnce(fail(new APIUserAbortError(), { input_tokens: 110, output_tokens: 1 }));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("cancelled");
    expect(e.usage).toEqual({ inputTokens: 210, outputTokens: 6 });
  });

  it("rejects with limit_reached before its second call when the first used up the budget", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValue(ok(message(null, "end_turn", { input_tokens: 100, output_tokens: 5 })));
    const e = await rejection(readStructure(api, input({ tokenBudget: 1 })));
    expect(e.code).toBe("limit_reached");
    expect(e.usage).toEqual({ inputTokens: 100, outputTokens: 5 });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("rejects with limit_reached and makes no call when no budget is left", async () => {
    const { api, stream } = fakeApi();
    const e = await rejection(readStructure(api, input({ tokenBudget: 0 })));
    expect(e.code).toBe("limit_reached");
    expect(e.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(stream).not.toHaveBeenCalled();
  });

  it("retries once when parsed_output is null, and sums the usage", async () => {
    const { api, stream } = fakeApi();
    stream
      .mockReturnValueOnce(ok(message(null, "end_turn", { input_tokens: 100, output_tokens: 5 })))
      .mockReturnValueOnce(ok(message({ structure: STRUCTURE }, "end_turn", { input_tokens: 110, output_tokens: 30 })));
    const out = await readStructure(api, input());
    expect(stream).toHaveBeenCalledTimes(2);
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 210, outputTokens: 35 });
  });

  it("retries once when the stop reason is max_tokens", async () => {
    const { api, stream } = fakeApi();
    stream
      .mockReturnValueOnce(ok(message({ structure: STRUCTURE }, "max_tokens")))
      .mockReturnValueOnce(ok(message({ structure: STRUCTURE })));
    const out = await readStructure(api, input());
    expect(stream).toHaveBeenCalledTimes(2);
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("retries once when the SDK throws a structured-output parse error, and counts the failed call", async () => {
    const { api, stream } = fakeApi();
    stream
      .mockReturnValueOnce(
        fail(new AnthropicError("Failed to parse structured output: bad JSON"), { input_tokens: 100, output_tokens: 9 }),
      )
      .mockReturnValueOnce(ok(message({ structure: STRUCTURE })));
    const out = await readStructure(api, input());
    expect(stream).toHaveBeenCalledTimes(2);
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 29 });
  });

  it("rejects with read_failed when the parse error repeats", async () => {
    const { api, stream } = fakeApi();
    stream.mockImplementation(() => fail(new AnthropicError("Failed to parse structured output: bad JSON")));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("rejects with read_failed when parsed_output is null twice", async () => {
    const { api, stream } = fakeApi();
    stream.mockImplementation(() => ok(message(null)));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("rejects with cancelled when the SDK reports an abort", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValueOnce(fail(new APIUserAbortError()));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("cancelled");
  });

  it("rejects with cancelled on a DOM abort error", async () => {
    const { api, stream } = fakeApi();
    stream.mockReturnValueOnce(fail(new DOMException("The operation was aborted.", "AbortError")));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("cancelled");
  });

  it("keeps the text of an SDK error out of the ModelError message", async () => {
    const { api, stream } = fakeApi();
    const body = { type: "error", error: { type: "authentication_error", message: "bad key sk-ant-secret" } };
    stream.mockReturnValueOnce(
      fail(new AuthenticationError(401, body, "bad key sk-ant-secret", new Headers(), "authentication_error")),
    );
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(e.message).not.toContain("sk-ant-secret");
    expect(e.message).toContain("401");
    expect(e.message).toContain("authentication_error");
  });

  it("keeps the text of any other error out of the ModelError message", async () => {
    const { api, stream } = fakeApi();
    stream.mockImplementationOnce(() => {
      throw new Error("request failed with key sk-ant-secret");
    });
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(e.message).not.toContain("sk-ant-secret");
  });

  it("rejects with read_failed and makes no call when the image is null", async () => {
    const { api, stream } = fakeApi();
    const e = await rejection(readStructure(api, input({ image: null })));
    expect(e.code).toBe("read_failed");
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("ReaderOutput", () => {
  const BANNED = ["minimum", "maximum", "minLength", "maxLength"];

  function bannedKeys(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) {
      for (const item of node) bannedKeys(item, found);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (BANNED.includes(key)) found.push(key);
        bannedKeys(value, found);
      }
    }
    return found;
  }

  it("has an object root and no numeric or string length limits", () => {
    const schema = z.toJSONSchema(ReaderOutput);
    expect(schema.type).toBe("object");
    expect(bannedKeys(schema)).toEqual([]);
  });
});
