import { AnthropicError, APIUserAbortError, AuthenticationError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MessagesApi } from "../src/agents/client";
import { READER_SYSTEM } from "../src/agents/prompts";
import { ReaderOutput, readStructure } from "../src/agents/reader";
import type { Structure } from "../src/core/schema";
import { ModelError } from "../src/pipeline/model";
import type { ReadInput } from "../src/pipeline/model";
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

function fakeApi() {
  const parse = vi.fn();
  const stream = vi.fn();
  const api: MessagesApi = { parse, stream };
  return { api, parse };
}

function input(overrides: Partial<ReadInput> = {}): ReadInput {
  return {
    image: { mediaType: "image/webp", base64: "AAAA" },
    sampleId: null,
    question: "Find the current through R1.",
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
    const { api, parse } = fakeApi();
    parse.mockResolvedValueOnce(message({ structure: STRUCTURE }));
    const out = await readStructure(api, input());
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("sends the model, both fallback fields, high effort, a format, the image and the question", async () => {
    const { api, parse } = fakeApi();
    parse.mockResolvedValueOnce(message({ structure: STRUCTURE }));
    const signal = new AbortController().signal;
    await readStructure(api, input({ signal }));

    const call: unknown[] = parse.mock.calls[0] ?? [];
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

  it("rejects with refused on a refusal", async () => {
    const { api, parse } = fakeApi();
    parse.mockResolvedValueOnce(message(null, "refusal"));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("refused");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("retries once when parsed_output is null, and sums the usage", async () => {
    const { api, parse } = fakeApi();
    parse
      .mockResolvedValueOnce(message(null, "end_turn", { input_tokens: 100, output_tokens: 5 }))
      .mockResolvedValueOnce(message({ structure: STRUCTURE }, "end_turn", { input_tokens: 110, output_tokens: 30 }));
    const out = await readStructure(api, input());
    expect(parse).toHaveBeenCalledTimes(2);
    expect(out.structure).toEqual(STRUCTURE);
    expect(out.usage).toEqual({ inputTokens: 210, outputTokens: 35 });
  });

  it("retries once when the stop reason is max_tokens", async () => {
    const { api, parse } = fakeApi();
    parse
      .mockResolvedValueOnce(message({ structure: STRUCTURE }, "max_tokens"))
      .mockResolvedValueOnce(message({ structure: STRUCTURE }));
    const out = await readStructure(api, input());
    expect(parse).toHaveBeenCalledTimes(2);
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("retries once when the SDK throws a structured-output parse error", async () => {
    const { api, parse } = fakeApi();
    parse
      .mockRejectedValueOnce(new AnthropicError("Failed to parse structured output: bad JSON"))
      .mockResolvedValueOnce(message({ structure: STRUCTURE }));
    const out = await readStructure(api, input());
    expect(parse).toHaveBeenCalledTimes(2);
    expect(out.structure).toEqual(STRUCTURE);
  });

  it("rejects with read_failed when the parse error repeats", async () => {
    const { api, parse } = fakeApi();
    parse.mockRejectedValue(new AnthropicError("Failed to parse structured output: bad JSON"));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("rejects with read_failed when parsed_output is null twice", async () => {
    const { api, parse } = fakeApi();
    parse.mockResolvedValue(message(null));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("rejects with cancelled when the SDK reports an abort", async () => {
    const { api, parse } = fakeApi();
    parse.mockRejectedValueOnce(new APIUserAbortError());
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("cancelled");
  });

  it("rejects with cancelled on a DOM abort error", async () => {
    const { api, parse } = fakeApi();
    parse.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("cancelled");
  });

  it("keeps the text of an SDK error out of the ModelError message", async () => {
    const { api, parse } = fakeApi();
    const body = { type: "error", error: { type: "authentication_error", message: "bad key sk-ant-secret" } };
    parse.mockRejectedValueOnce(
      new AuthenticationError(401, body, "bad key sk-ant-secret", new Headers(), "authentication_error"),
    );
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(e.message).not.toContain("sk-ant-secret");
    expect(e.message).toContain("401");
    expect(e.message).toContain("authentication_error");
  });

  it("keeps the text of any other error out of the ModelError message", async () => {
    const { api, parse } = fakeApi();
    parse.mockRejectedValueOnce(new Error("request failed with key sk-ant-secret"));
    const e = await rejection(readStructure(api, input()));
    expect(e.code).toBe("read_failed");
    expect(e.message).not.toContain("sk-ant-secret");
  });

  it("rejects with read_failed and makes no call when the image is null", async () => {
    const { api, parse } = fakeApi();
    const e = await rejection(readStructure(api, input({ image: null })));
    expect(e.code).toBe("read_failed");
    expect(parse).not.toHaveBeenCalled();
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
