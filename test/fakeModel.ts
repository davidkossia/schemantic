/**
 * Fakes for tests. `createFakeModel` is a ModelClient for session tests: the test scripts what each
 * read and solve call does. `sdkStreamApi` is the real SDK client over a fake `fetch`, for agent tests
 * that need the SDK's own stream handling. Neither makes a network call.
 */
import { Anthropic } from "@anthropic-ai/sdk";
import type { MessagesApi } from "../src/agents/client";
import type { ModelClient, ReadInput, ReadOutput, SolveInput, SolveOutput } from "../src/pipeline/model";

/** What one model call does. */
export type Scripted<I, O> =
  | { kind: "return"; output: O } // resolves at once
  | { kind: "hold"; output: O } // resolves when the test calls release()
  | { kind: "throw"; error: unknown } // rejects with this value
  | { kind: "run"; run: (input: I) => O | Promise<O> }; // the test's own code

/** What one streamed reply sends: its events in order, then either the end of the body or a hang until abort. */
export type SseReply = { events: object[]; hang: boolean };

/** A `message_start` event that reports this usage. */
export function messageStart(inputTokens: number, outputTokens = 1): object {
  return {
    type: "message_start",
    message: {
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  };
}

/** The events of a whole reply with one text block. */
export function textReply(text: string, inputTokens: number, outputTokens: number): SseReply {
  return {
    hang: false,
    events: [
      messageStart(inputTokens),
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null },
        usage: { output_tokens: outputTokens },
      },
      { type: "message_stop" },
    ],
  };
}

/**
 * The real SDK's `beta.messages` over a fake `fetch` that plays `replies` in order (the last one
 * repeats). `onEvents` runs after a reply's events are queued, for example to abort.
 */
export function sdkStreamApi(replies: SseReply[], onEvents: () => void = () => {}): MessagesApi {
  const encoder = new TextEncoder();
  let i = 0;
  const fetchImpl = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const reply = replies[Math.min(i, replies.length - 1)];
    i++;
    if (reply === undefined) throw new Error("no scripted reply");
    const signal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of reply.events) {
          const type = "type" in event && typeof event.type === "string" ? event.type : "unknown";
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`));
        }
        if (!reply.hang) controller.close();
        signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        setTimeout(onEvents, 0);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return new Anthropic({ apiKey: "test-key", fetch: fetchImpl, maxRetries: 0 }).beta.messages;
}

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
