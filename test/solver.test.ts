import { APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { MessagesApi } from "../src/agents/client";
import { SOLVER_SYSTEM } from "../src/agents/prompts";
import { NUDGE, solveWithTools } from "../src/agents/solver";
import type { CheckReport, Circuit } from "../src/core/schema";
import { messageStart, sdkStreamApi } from "./fakeModel";
import { createToolRunner } from "../src/core/tools";
import { ModelError } from "../src/pipeline/model";
import type { SolveEvent, SolveInput } from "../src/pipeline/model";
import { CIRCUITS } from "./fixtures/circuits";

function fixture(id: string): Circuit {
  const c = CIRCUITS[id];
  if (c === undefined) throw new Error(`fixture ${id} is missing`);
  return c;
}
const C01 = fixture("c01");

type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

type Turn = {
  stop: "end_turn" | "tool_use" | "max_tokens" | "pause_turn" | "refusal" | "model_context_window_exceeded";
  content: Block[];
  deltas?: string[];
  usage?: { input_tokens: number; output_tokens: number };
};

const CLAIM = { kind: "node_voltage", node: "B", setup: { remove: [], zero: [] }, value: 8 };

function fakeStream(turn: Turn) {
  const listeners: ((delta: string) => void)[] = [];
  return {
    on(event: string, listener: (delta: string) => void) {
      if (event === "text") listeners.push(listener);
      return this;
    },
    async finalMessage() {
      for (const d of turn.deltas ?? []) for (const l of listeners) l(d);
      return {
        stop_reason: turn.stop,
        content: turn.content,
        usage: turn.usage ?? { input_tokens: 100, output_tokens: 10 },
      };
    },
  };
}

function fakeApi(turns: Turn[]) {
  let i = 0;
  const stream = vi.fn();
  stream.mockImplementation(() => {
    const turn = turns[Math.min(i, turns.length - 1)];
    i++;
    if (turn === undefined) throw new Error("no scripted turn");
    return fakeStream(turn);
  });
  const api: MessagesApi = { stream };
  return { api, stream };
}

function input(overrides: Partial<SolveInput> = {}) {
  const events: SolveEvent[] = [];
  const base: SolveInput = {
    structure: C01,
    question: "What is the voltage at node B?",
    sampleId: null,
    tools: createToolRunner(C01),
    feedback: null,
    tokenBudget: 200_000,
    onEvent: (e) => events.push(e),
    signal: new AbortController().signal,
    ...overrides,
  };
  return { input: base, events };
}

/** The request params of call n, as a plain record. */
function params(stream: ReturnType<typeof fakeApi>["stream"], n: number): Record<string, unknown> {
  const call: unknown[] = stream.mock.calls[n] ?? [];
  const p = call[0];
  if (typeof p !== "object" || p === null) throw new Error(`no call ${n}`);
  return Object.fromEntries(Object.entries(p));
}

function messagesOf(stream: ReturnType<typeof fakeApi>["stream"], n: number): unknown[] {
  const m = params(stream, n)["messages"];
  if (!Array.isArray(m)) throw new Error("messages is not an array");
  return m;
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

const SOLVE_TURN: Turn = {
  stop: "tool_use",
  content: [
    { type: "thinking", thinking: "Solve the divider.", signature: "sig-1" },
    { type: "text", text: "First I solve the circuit." },
    { type: "tool_use", id: "tu_1", name: "solve_circuit", input: { changes: [] } },
  ],
};

const SUBMIT_TURN: Turn = {
  stop: "tool_use",
  content: [
    {
      type: "tool_use",
      id: "tu_2",
      name: "submit_answer",
      input: { claim: CLAIM, explanation: "V(B) is 8 V from the divider." },
    },
  ],
};

const EVALUATE_TURN: Turn = {
  stop: "tool_use",
  content: [{ type: "tool_use", id: "tu_e", name: "evaluate", input: { expression: "1 + 1" } }],
};

describe("solveWithTools", () => {
  it("runs a solve_circuit turn then a submit_answer turn on c01", async () => {
    const { api, stream } = fakeApi([SOLVE_TURN, SUBMIT_TURN]);
    const { input: inp, events } = input();
    const out = await solveWithTools(api, inp);

    expect(out.claim).toEqual(CLAIM);
    expect(out.text).toBe("V(B) is 8 V from the divider.");
    expect(stream).toHaveBeenCalledTimes(2);

    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((s) => s.tool)).toEqual(["solve_circuit", "submit_answer"]);
    const first = steps[0];
    if (first?.type !== "step") throw new Error("missing step");
    expect(first.output.ok).toBe(true);
    if (!first.output.ok) throw new Error("solve failed");
    expect(first.output["nodeVoltages"]).toMatchObject({ B: expect.closeTo(8, 6) });

    const second = messagesOf(stream, 1);
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: "assistant", content: SOLVE_TURN.content });
    expect(second[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false }],
    });
  });

  it("forwards text deltas as token events in order", async () => {
    const { api } = fakeApi([{ ...SOLVE_TURN, deltas: ["First ", "I solve", " the circuit."] }, SUBMIT_TURN]);
    const { input: inp, events } = input();
    await solveWithTools(api, inp);
    expect(events.filter((e) => e.type === "token")).toEqual([
      { type: "token", text: "First " },
      { type: "token", text: "I solve" },
      { type: "token", text: " the circuit." },
    ]);
  });

  it("runs two tool_use blocks in one turn and returns both results in one user message", async () => {
    const both: Turn = {
      stop: "tool_use",
      content: [
        { type: "tool_use", id: "tu_a", name: "evaluate", input: { expression: "12 * 2000 / 3000" } },
        { type: "tool_use", id: "tu_b", name: "solve_circuit", input: { changes: [] } },
      ],
    };
    const { api, stream } = fakeApi([both, SUBMIT_TURN]);
    const { input: inp, events } = input();
    await solveWithTools(api, inp);

    expect(events.filter((e) => e.type === "step").map((e) => e.tool)).toEqual([
      "evaluate",
      "solve_circuit",
      "submit_answer",
    ]);
    const msgs = messagesOf(stream, 1);
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toMatchObject({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_a", is_error: false },
        { type: "tool_result", tool_use_id: "tu_b", is_error: false },
      ],
    });
    const last = msgs[2];
    if (typeof last !== "object" || last === null || !("content" in last) || !Array.isArray(last.content)) {
      throw new Error("bad tool result message");
    }
    const firstResult: unknown = last.content[0];
    expect(firstResult).toMatchObject({ content: JSON.stringify({ ok: true, value: 8 }) });
  });

  it("marks a tool call with bad input as an error and keeps going", async () => {
    const bad: Turn = {
      stop: "tool_use",
      content: [{ type: "tool_use", id: "tu_bad", name: "solve_circuit", input: { changes: "none" } }],
    };
    const { api, stream } = fakeApi([bad, SUBMIT_TURN]);
    const { input: inp, events } = input();
    const out = await solveWithTools(api, inp);

    expect(stream).toHaveBeenCalledTimes(2);
    const step = events.find((e) => e.type === "step");
    expect(step).toMatchObject({ tool: "solve_circuit", output: { ok: false } });
    expect(messagesOf(stream, 1)[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_bad", is_error: true }],
    });
    expect(out.claim).toEqual(CLAIM);
  });

  it("nudges once after end_turn without a claim, then returns claim null", async () => {
    const talk: Turn = { stop: "end_turn", content: [{ type: "text", text: "V(B) is 8 V." }], deltas: ["V(B) is 8 V."] };
    const { api, stream } = fakeApi([talk, talk]);
    const { input: inp } = input();
    const out = await solveWithTools(api, inp);

    expect(stream).toHaveBeenCalledTimes(2);
    const msgs = messagesOf(stream, 1);
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: "assistant", content: talk.content });
    expect(msgs[2]).toEqual({ role: "user", content: NUDGE });
    expect(out.claim).toBeNull();
    expect(out.text).toBe("V(B) is 8 V.V(B) is 8 V.");
  });

  it("stops at maxTurns when the model keeps calling evaluate", async () => {
    const { api, stream } = fakeApi([EVALUATE_TURN]);
    const { input: inp, events } = input();
    const out = await solveWithTools(api, inp, { maxTurns: 3 });
    expect(stream).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.type === "step")).toHaveLength(3);
    expect(out.claim).toBeNull();
  });

  it("calls again after pause_turn, keeping the assistant content", async () => {
    const pause: Turn = { stop: "pause_turn", content: [{ type: "text", text: "Working." }] };
    const { api, stream } = fakeApi([pause, SUBMIT_TURN]);
    const { input: inp } = input();
    const out = await solveWithTools(api, inp);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(messagesOf(stream, 1)[1]).toEqual({ role: "assistant", content: pause.content });
    expect(out.claim).toEqual(CLAIM);
  });

  it("rejects with refused on a refusal", async () => {
    const { api } = fakeApi([{ stop: "refusal", content: [] }]);
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("refused");
  });

  it("rejects with solve_failed on max_tokens, carrying the usage so far", async () => {
    const { api } = fakeApi([SOLVE_TURN, { stop: "max_tokens", content: [{ type: "text", text: "cut" }] }]);
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("solve_failed");
    expect(e.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("rejects with solve_failed on a stop reason it does not handle", async () => {
    const { api, stream } = fakeApi([{ stop: "model_context_window_exceeded", content: [{ type: "text", text: "full" }] }]);
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("solve_failed");
    expect(e.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("rejects with limit_reached when the token budget runs out mid-loop, carrying the usage so far", async () => {
    // Each turn costs 110 tokens. After two turns the solve has used 220, which reaches the budget of 200.
    const { api, stream } = fakeApi([EVALUATE_TURN]);
    const e = await rejection(solveWithTools(api, input({ tokenBudget: 200 }).input));
    expect(e.code).toBe("limit_reached");
    expect(e.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("rejects with limit_reached and makes no call when no budget is left", async () => {
    const { api, stream } = fakeApi([SUBMIT_TURN]);
    const e = await rejection(solveWithTools(api, input({ tokenBudget: 0 }).input));
    expect(e.code).toBe("limit_reached");
    expect(e.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(stream).not.toHaveBeenCalled();
  });

  it("puts the check report's notes and items in the first user message when feedback is set", async () => {
    const report: CheckReport = {
      verified: false,
      items: [{ name: "V(B)", claimed: 6, measured: 8, unit: "V", ok: false }],
      residuals: null,
      notes: ["The claimed voltage at node B does not match the circuit."],
    };
    const { api, stream } = fakeApi([SUBMIT_TURN]);
    await solveWithTools(api, input({ feedback: report }).input);

    const first = messagesOf(stream, 0)[0];
    expect(first).toMatchObject({ role: "user" });
    if (typeof first !== "object" || first === null || !("content" in first)) throw new Error("bad first message");
    const text = String(first.content);
    expect(text).toContain("failed the check");
    expect(text).toContain("The claimed voltage at node B does not match the circuit.");
    expect(text).toContain("V(B): claimed 6, measured 8 V, failed");
  });

  it("puts the question and the structure in the first user message without feedback", async () => {
    const { api, stream } = fakeApi([SUBMIT_TURN]);
    await solveWithTools(api, input().input);
    const first = messagesOf(stream, 0)[0];
    if (typeof first !== "object" || first === null || !("content" in first)) throw new Error("bad first message");
    const text = String(first.content);
    expect(text).toContain("What is the voltage at node B?");
    expect(text).toContain(JSON.stringify(C01, null, 2));
    expect(text).not.toContain("failed the check");
  });

  it("sends the model, both fallback fields, strict tools, and no tool_choice or thinking", async () => {
    const { api, stream } = fakeApi([SOLVE_TURN, SUBMIT_TURN]);
    const signal = new AbortController().signal;
    await solveWithTools(api, input({ signal }).input);

    for (const n of [0, 1]) {
      const p = params(stream, n);
      expect(p).toMatchObject({
        model: "claude-opus-5-5",
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        max_tokens: 16000,
        system: SOLVER_SYSTEM,
        output_config: { effort: "high" },
      });
      expect(p).not.toHaveProperty("tool_choice");
      expect(p).not.toHaveProperty("thinking");
      const tools = p["tools"];
      if (!Array.isArray(tools)) throw new Error("tools is not an array");
      expect(tools).toHaveLength(4);
      for (const t of tools) {
        expect(t).toMatchObject({ strict: true, input_schema: { type: "object" } });
      }
      expect(tools.map((t: unknown) => (typeof t === "object" && t !== null && "name" in t ? t.name : null))).toEqual([
        "solve_circuit",
        "evaluate",
        "graph_query",
        "submit_answer",
      ]);
      const call: unknown[] = stream.mock.calls[n] ?? [];
      expect(call[1]).toEqual({ signal });
    }
  });

  it("sums the usage over turns", async () => {
    const { api } = fakeApi([
      { ...SOLVE_TURN, usage: { input_tokens: 100, output_tokens: 7 } },
      { ...SUBMIT_TURN, usage: { input_tokens: 250, output_tokens: 30 } },
    ]);
    const out = await solveWithTools(api, input().input);
    expect(out.usage).toEqual({ inputTokens: 350, outputTokens: 37 });
  });

  it("rejects with cancelled and makes no call when the signal is already aborted", async () => {
    const { api, stream } = fakeApi([SUBMIT_TURN]);
    const controller = new AbortController();
    controller.abort();
    const e = await rejection(solveWithTools(api, input({ signal: controller.signal }).input));
    expect(e.code).toBe("cancelled");
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects with cancelled when the stream reports an abort", async () => {
    const stream = vi.fn();
    stream.mockImplementation(() => ({
      on() {
        return this;
      },
      finalMessage: () => Promise.reject(new APIUserAbortError()),
    }));
    const api: MessagesApi = { stream };
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("cancelled");
  });

  it("counts the tokens of a turn aborted mid-stream, on top of the finished turns", async () => {
    // Turn 1 finishes (110 tokens). Turn 2 is aborted after message_start reported 50,000 input tokens.
    let calls = 0;
    const stream = vi.fn();
    stream.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return fakeStream(EVALUATE_TURN);
      return {
        currentMessage: { usage: { input_tokens: 50_000, output_tokens: 3 } },
        on() {
          return this;
        },
        finalMessage: () => Promise.reject(new APIUserAbortError()),
      };
    });
    const api: MessagesApi = { stream };
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("cancelled");
    expect(e.usage).toEqual({ inputTokens: 50_100, outputTokens: 13 });
  });

  it("counts a turn aborted mid-stream through the real SDK stream", async () => {
    const controller = new AbortController();
    const api = sdkStreamApi([{ events: [messageStart(50_000)], hang: true }], () => controller.abort());
    const e = await rejection(solveWithTools(api, input({ signal: controller.signal }).input));
    expect(e.code).toBe("cancelled");
    expect(e.usage).toEqual({ inputTokens: 50_000, outputTokens: 1 });
  });

  it("keeps the text of an unexpected error out of the ModelError message", async () => {
    const stream = vi.fn();
    stream.mockImplementation(() => {
      throw new Error("request failed with key sk-ant-secret");
    });
    const api: MessagesApi = { stream };
    const e = await rejection(solveWithTools(api, input().input));
    expect(e.code).toBe("solve_failed");
    expect(e.message).not.toContain("sk-ant-secret");
  });
});
