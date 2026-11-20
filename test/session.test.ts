import { describe, expect, it, vi } from "vitest";
import { problem as c01 } from "../eval/problems/c01";
import { readStructure } from "../src/agents/reader";
import { solveWithTools } from "../src/agents/solver";
import type { Circuit, Claim, Graph, Structure } from "../src/core/schema";
import type { ToolOutput } from "../src/core/tools";
import { validate } from "../src/core/validate";
import { LIMITS } from "../src/shared/limits";
import { ModelError, type ReadInput, type ReadOutput, type SolveInput, type SolveOutput, type Usage } from "../src/pipeline/model";
import { createSession, type SessionDeps } from "../src/pipeline/session";
import type { Sample, ServerMessage } from "../src/shared/protocol";
import { createFakeModel, messageStart, sdkStreamApi, type FakeScript, type Scripted } from "./fakeModel";
import { NO_SETUP, circuit, resistor, vsource } from "./helpers";

// `validate` keeps its real behaviour; the spy shows whether the session called it.
vi.mock("../src/core/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/validate")>();
  return { ...actual, validate: vi.fn(actual.validate) };
});

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };
const SAMPLES: Sample[] = [{ id: "c01", title: c01.title, question: c01.question, imageUrl: "samples/c01.png" }];

function truthCircuit(): Circuit {
  if (c01.truth.kind !== "circuit") throw new Error("c01 is a circuit");
  return structuredClone(c01.truth);
}

/** The c01 reading with R2 misread as 20 kΩ, as the replay sample has it. */
function misread(): Circuit {
  const c = truthCircuit();
  return { ...c, components: c.components.map((k) => (k.id === "R2" ? { ...k, value: 20000 } : k)) };
}

/** The reading with R2 fixed back to 2 kΩ. */
const APPROVED: Circuit = truthCircuit();

function claimB(value: number): Claim {
  return { kind: "node_voltage", node: "B", setup: NO_SETUP, value };
}

function readReturns(structure: Structure = misread(), usage: Usage = ZERO): Scripted<ReadInput, ReadOutput> {
  return { kind: "return", output: { structure, usage } };
}

function nodeVoltage(out: ToolOutput, node: string): number {
  if (!out.ok) throw new Error(out.error);
  const volts = out["nodeVoltages"];
  if (typeof volts !== "object" || volts === null) throw new Error("no node voltages");
  const value: unknown = Object.entries(volts).find(([k]) => k === node)?.[1];
  if (typeof value !== "number") throw new Error(`no voltage for ${node}`);
  return value;
}

/** What the scripted client does for c01: solve_circuit, read V(B), submit_answer, then the explanation as tokens. */
function scriptedC01(usage: Usage = ZERO): Scripted<SolveInput, SolveOutput> {
  return {
    kind: "run",
    run: (input) => {
      const solveInput = { changes: [] };
      const solved = input.tools.run("solve_circuit", solveInput);
      input.onEvent({ type: "step", tool: "solve_circuit", input: solveInput, output: solved });
      const claim = claimB(nodeVoltage(solved, "B"));
      const text = "I solved the circuit with solve_circuit. V(B) = 8 V";
      const submitInput = { claim, explanation: text };
      input.onEvent({ type: "step", tool: "submit_answer", input: submitInput, output: input.tools.run("submit_answer", submitInput) });
      for (const word of text.split(" ")) input.onEvent({ type: "token", text: `${word} ` });
      return { claim, text, usage };
    },
  };
}

/** A solve that emits two fake steps and returns the claim. */
function solveWith(claim: Claim | null, usage: Usage = ZERO): Scripted<SolveInput, SolveOutput> {
  return {
    kind: "run",
    run: (input) => {
      input.onEvent({ type: "step", tool: "evaluate", input: { expression: "1" }, output: { ok: true, value: 1 } });
      input.onEvent({ type: "step", tool: "evaluate", input: { expression: "2" }, output: { ok: true, value: 2 } });
      return { claim, text: "answer", usage };
    },
  };
}

function setup(script: FakeScript, extra: Partial<SessionDeps> = {}) {
  const sent: ServerMessage[] = [];
  const model = createFakeModel(script);
  const session = createSession({ model, send: (m) => sent.push(m), samples: SAMPLES, ...extra });
  return { sent, model, session };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const types = (messages: ServerMessage[]) => messages.map((m) => m.type);

function ofType<T extends ServerMessage["type"]>(messages: ServerMessage[], type: T): Extract<ServerMessage, { type: T }>[] {
  return messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
}

function errorCodes(messages: ServerMessage[]) {
  return ofType(messages, "error").map((m) => m.code);
}

const START = JSON.stringify({ type: "start", image: null, sampleId: "c01", question: c01.question });
const approve = (structure: Structure = APPROVED) => JSON.stringify({ type: "approve", structure });
const REOPEN = JSON.stringify({ type: "reopen" });
const CANCEL = JSON.stringify({ type: "cancel" });

/** A circuit of one source and `n - 1` resistors in a chain: n components, n nodes. */
function chain(n: number): Circuit {
  const parts = [vsource("V1", 1, "n1", "gnd")];
  for (let i = 1; i < n; i++) parts.push(resistor(`R${i}`, 1000, `n${i}`, i === n - 1 ? "gnd" : `n${i + 1}`));
  return circuit(parts);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Start c01, wait for the review gate, approve, and wait for the session to settle. */
async function runToDone(s: ReturnType<typeof setup>) {
  s.session.receive(START);
  await flush();
  s.session.receive(approve());
  await flush();
}

describe("createSession", () => {
  it("runs the happy path with the scripted c01 behaviour", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    expect(types(s.sent)).toEqual(["hello", "reading", "parsed", "awaiting_review"]);
    expect(ofType(s.sent, "hello")[0]).toEqual({ type: "hello", mode: "replay", samples: SAMPLES });
    expect(s.session.state()).toBe("awaiting_review");

    s.sent.length = 0;
    s.session.receive(approve());
    await flush();
    expect(ofType(s.sent, "token").length).toBeGreaterThan(0);
    expect(types(s.sent).filter((t) => t !== "token")).toEqual(["solving", "step", "step", "checking", "check", "done"]);
    // Tokens come after the steps and before the check.
    const firstToken = types(s.sent).indexOf("token");
    expect(firstToken).toBeGreaterThan(types(s.sent).lastIndexOf("step"));
    expect(firstToken).toBeLessThan(types(s.sent).indexOf("checking"));
    const done = ofType(s.sent, "done")[0];
    expect(done?.verified).toBe(true);
    expect(done?.claim).toEqual(claimB(8));
    expect(s.session.state()).toBe("done");
  });

  it("rejects messages that do not fit the state", async () => {
    const s = setup({ read: [{ kind: "hold", output: { structure: misread(), usage: ZERO } }] });
    s.session.receive(approve());
    expect(errorCodes(s.sent)).toEqual(["bad_state"]);
    expect(s.session.state()).toBe("idle");

    s.session.receive(START);
    s.session.receive(START);
    expect(types(s.sent)).toEqual(["hello", "error", "reading", "error"]);
    expect(errorCodes(s.sent)).toEqual(["bad_state", "bad_state"]);
    expect(s.session.state()).toBe("reading");
  });

  it("sends bad_message for text that is not a client message, and changes nothing", () => {
    const s = setup({ read: [readReturns()] });
    s.session.receive("not json");
    s.session.receive(JSON.stringify({ type: "start", image: null, sampleId: "zz", question: "q" }));
    expect(errorCodes(s.sent)).toEqual(["bad_message", "bad_message"]);
    expect(s.session.state()).toBe("idle");
    expect(s.model.readCalls).toHaveLength(0);
  });

  it("refuses to approve a structure with no ground", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    s.sent.length = 0;
    s.session.receive(approve({ ...APPROVED, ground: "nowhere" }));
    await flush();
    expect(types(s.sent)).toEqual(["error"]);
    expect(errorCodes(s.sent)).toEqual(["cannot_solve"]);
    expect(s.session.state()).toBe("awaiting_review");
    expect(s.model.solveCalls).toHaveLength(0);
  });

  it("refuses a circuit with more components than the limit, without validating it", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] }, { limits: { maxComponents: 2 } });
    s.session.receive(START);
    await flush();
    vi.mocked(validate).mockClear();
    s.session.receive(approve());
    await flush();
    expect(errorCodes(s.sent)).toEqual(["cannot_solve"]);
    expect(validate).not.toHaveBeenCalled();
    expect(s.session.state()).toBe("awaiting_review");
  });

  it("refuses an approve with maxComponents + 1 components at parse, without validating it", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    vi.mocked(validate).mockClear();
    s.sent.length = 0;
    s.session.receive(approve(chain(LIMITS.maxComponents + 1)));
    expect(ofType(s.sent, "error")).toEqual([
      { type: "error", code: "bad_message", message: `The circuit has more than ${LIMITS.maxComponents} components.` },
    ]);
    expect(validate).not.toHaveBeenCalled();
    expect(s.session.state()).toBe("awaiting_review");
    expect(s.model.solveCalls).toHaveLength(0);
  });

  it("refuses an approve with 5,000 components quickly", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    vi.mocked(validate).mockClear();
    s.sent.length = 0;
    const raw = approve(chain(5000));
    const began = performance.now();
    s.session.receive(raw);
    expect(performance.now() - began).toBeLessThan(1000);
    expect(errorCodes(s.sent)).toEqual(["bad_message"]);
    expect(validate).not.toHaveBeenCalled();
    expect(s.session.state()).toBe("awaiting_review");
  });

  it("refuses an approve over maxStructureChars with bad_message, without validating it", async () => {
    // 10 series of 500 points each fit the protocol's caps, but come to well over 50,000 characters.
    const graph: Graph = {
      kind: "graph",
      title: null,
      x: { label: "t", unit: "s", min: 0, max: 1 },
      y: { label: "v", unit: "V", min: 0, max: 1 },
      series: Array.from({ length: LIMITS.maxSeries }, (_, k) => ({
        id: `s${k + 1}`,
        name: `series ${k + 1}`,
        kind: "line" as const,
        points: Array.from({ length: LIMITS.maxPoints }, (_, i) => ({ x: i + 0.123456, y: i * 2 + 0.654321 })),
      })),
      asked: { summary: "Find the peak.", target: null },
      notes: null,
    };
    expect(JSON.stringify(graph).length).toBeGreaterThan(LIMITS.maxStructureChars);
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    vi.mocked(validate).mockClear();
    s.sent.length = 0;
    s.session.receive(approve(graph));
    expect(ofType(s.sent, "error")).toEqual([
      { type: "error", code: "bad_message", message: "The structure is too large to solve." },
    ]);
    expect(validate).not.toHaveBeenCalled();
    expect(s.session.state()).toBe("awaiting_review");
  });

  it("measures the structure against maxStructureChars from the session limits", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] }, { limits: { maxStructureChars: 100 } });
    s.session.receive(START);
    await flush();
    s.sent.length = 0;
    s.session.receive(approve());
    expect(errorCodes(s.sent)).toEqual(["bad_message"]);
    expect(s.model.solveCalls).toHaveLength(0);
  });

  it("retries once with the first report as feedback", async () => {
    const s = setup({ read: [readReturns()], solve: [solveWith(claimB(7)), solveWith(claimB(8))] });
    await runToDone(s);
    expect(types(s.sent).filter((t) => t !== "step").slice(4)).toEqual([
      "solving", "checking", "check", "solving", "checking", "check", "done",
    ]);
    expect(ofType(s.sent, "solving").map((m) => m.attempt)).toEqual([1, 2]);
    const checks = ofType(s.sent, "check");
    expect(checks.map((m) => m.attempt)).toEqual([1, 2]);
    expect(checks.map((m) => m.report.verified)).toEqual([false, true]);
    expect(ofType(s.sent, "done")[0]?.verified).toBe(true);
    expect(s.model.solveCalls[0]?.feedback).toBeNull();
    expect(s.model.solveCalls[1]?.feedback).toEqual(checks[0]?.report);
  });

  it("stops after two wrong claims", async () => {
    const s = setup({ read: [readReturns()], solve: [solveWith(claimB(7))] });
    await runToDone(s);
    const done = ofType(s.sent, "done");
    expect(done).toHaveLength(1);
    expect(done[0]?.verified).toBe(false);
    expect(done[0]?.claim).toEqual(claimB(7));
    expect(ofType(s.sent, "solving")).toHaveLength(2);
    expect(s.model.solveCalls).toHaveLength(2);
    expect(s.session.state()).toBe("done");
  });

  it("ends unverified with no check when the solver makes no claim", async () => {
    const s = setup({ read: [readReturns()], solve: [solveWith(null)] });
    await runToDone(s);
    expect(types(s.sent)).not.toContain("checking");
    expect(types(s.sent).at(-1)).toBe("done");
    expect(ofType(s.sent, "done")[0]).toMatchObject({ claim: null, text: "answer", verified: false });
  });

  it("reopens the approved structure after done, and only then", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    s.session.receive(START);
    await flush();
    s.session.receive(REOPEN);
    expect(errorCodes(s.sent)).toEqual(["bad_state"]);
    s.session.receive(approve());
    await flush();

    s.sent.length = 0;
    s.session.receive(REOPEN);
    expect(types(s.sent)).toEqual(["parsed", "awaiting_review"]);
    expect(ofType(s.sent, "parsed")[0]?.structure).toEqual(APPROVED);
    expect(ofType(s.sent, "parsed")[0]?.warnings).toEqual([]);
    expect(s.session.state()).toBe("awaiting_review");
  });

  it("cancels a held read and ignores its result", async () => {
    const s = setup({ read: [{ kind: "hold", output: { structure: misread(), usage: ZERO } }] });
    s.session.receive(START);
    s.session.receive(CANCEL);
    expect(types(s.sent)).toEqual(["hello", "reading", "error"]);
    expect(errorCodes(s.sent)).toEqual(["cancelled"]);
    expect(s.session.state()).toBe("idle");
    expect(s.model.readCalls[0]?.signal.aborted).toBe(true);

    const before = s.sent.length;
    s.model.release();
    await flush();
    expect(s.sent).toHaveLength(before);
    expect(s.session.state()).toBe("idle");
  });

  it("cancels a held solve and aborts its signal", async () => {
    const s = setup({ read: [readReturns()], solve: [{ kind: "hold", output: { claim: claimB(8), text: "", usage: ZERO } }] });
    await runToDone(s);
    expect(s.session.state()).toBe("solving");
    s.session.receive(CANCEL);
    expect(types(s.sent).at(-1)).toBe("error");
    expect(errorCodes(s.sent)).toEqual(["cancelled"]);
    expect(s.session.state()).toBe("idle");
    expect(s.model.solveCalls[0]?.signal.aborted).toBe(true);

    const before = s.sent.length;
    s.model.release();
    await flush();
    expect(s.sent).toHaveLength(before);
  });

  it("does nothing on cancel in idle", () => {
    const s = setup({});
    s.session.receive(CANCEL);
    expect(types(s.sent)).toEqual(["hello"]);
  });

  it("passes a ModelError code through and hides other errors", async () => {
    const refused = setup({ read: [{ kind: "throw", error: new ModelError("refused", "The model refused.") }] });
    refused.session.receive(START);
    await flush();
    expect(errorCodes(refused.sent)).toEqual(["refused"]);
    expect(refused.session.state()).toBe("idle");

    const broken = setup({ read: [{ kind: "throw", error: new Error("secret detail") }] });
    broken.session.receive(START);
    await flush();
    const error = ofType(broken.sent, "error")[0];
    expect(error?.code).toBe("internal");
    expect(error?.message).toBe("Something went wrong.");
    expect(JSON.stringify(broken.sent)).not.toContain("secret detail");
    expect(broken.session.state()).toBe("idle");
  });

  it("treats a read timeout as read_failed", async () => {
    const s = setup(
      { read: [{ kind: "hold", output: { structure: misread(), usage: ZERO } }] },
      { limits: { readTimeoutMs: 5 } },
    );
    s.session.receive(START);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(errorCodes(s.sent)).toEqual(["read_failed"]);
    expect(s.model.readCalls[0]?.signal.aborted).toBe(true);
    expect(s.session.state()).toBe("idle");
    s.model.release();
    await flush();
    expect(types(s.sent).at(-1)).toBe("error");
  });

  it("checks images before reading", () => {
    const image = (base64: string) =>
      JSON.stringify({ type: "start", image: { mediaType: "image/png", base64 }, sampleId: null, question: "q" });

    const replay = setup({ read: [readReturns()] });
    replay.session.receive(image("AAAA"));
    expect(ofType(replay.sent, "error")[0]).toEqual({
      type: "error",
      code: "unsupported_image",
      message: "Replay mode reads only the sample problems.",
    });

    const big = setup({ mode: "live", read: [readReturns()] }, { limits: { maxImageBytes: 10 } });
    big.session.receive(image("A".repeat(40)));
    expect(errorCodes(big.sent)).toEqual(["image_too_large"]);
    expect(big.session.state()).toBe("idle");
    expect(big.model.readCalls).toHaveLength(0);
  });

  it("numbers steps across attempts", async () => {
    const s = setup({ read: [readReturns()], solve: [solveWith(claimB(7)), solveWith(claimB(8))] });
    await runToDone(s);
    expect(ofType(s.sent, "step").map((m) => m.index)).toEqual([0, 1, 2, 3]);
  });

  it("stops at the token budget", async () => {
    const s = setup(
      { read: [readReturns(misread(), { inputTokens: 6, outputTokens: 4 })], solve: [scriptedC01()] },
      { limits: { maxSessionTokens: 10 } },
    );
    await runToDone(s);
    expect(types(s.sent)).toEqual(["hello", "reading", "parsed", "awaiting_review", "error"]);
    expect(errorCodes(s.sent)).toEqual(["limit_reached"]);
    expect(s.session.state()).toBe("idle");
    expect(s.model.solveCalls).toHaveLength(0);
  });

  it("sums the usage of the read and every solve", async () => {
    const s = setup({
      read: [readReturns(misread(), { inputTokens: 100, outputTokens: 10 })],
      solve: [solveWith(claimB(7), { inputTokens: 20, outputTokens: 2 }), solveWith(claimB(8), { inputTokens: 30, outputTokens: 3 })],
    });
    await runToDone(s);
    expect(ofType(s.sent, "done")[0]?.usage).toEqual({ inputTokens: 150, outputTokens: 15 });
  });

  it("keeps one token total across starts, passes what is left to the solver, and refuses a start once it is spent", async () => {
    const s = setup(
      {
        read: [readReturns(misread(), { inputTokens: 50, outputTokens: 10 })],
        solve: [solveWith(claimB(8), { inputTokens: 20, outputTokens: 0 })],
      },
      { limits: { maxSessionTokens: 150 } },
    );
    await runToDone(s);
    expect(ofType(s.sent, "done")[0]?.usage).toEqual({ inputTokens: 70, outputTokens: 10 });
    expect(s.model.solveCalls[0]?.tokenBudget).toBe(90);

    s.sent.length = 0;
    await runToDone(s);
    // `done` reports this run only; the budget passed to the solver counts both runs.
    expect(ofType(s.sent, "done")[0]?.usage).toEqual({ inputTokens: 70, outputTokens: 10 });
    expect(s.model.readCalls[0]?.tokenBudget).toBe(150);
    expect(s.model.readCalls[1]?.tokenBudget).toBe(70); // 150 - 80 (run 1)
    expect(s.model.solveCalls[1]?.tokenBudget).toBe(10); // 150 - 80 (run 1) - 60 (run 2 read)

    s.sent.length = 0;
    s.session.receive(START);
    expect(errorCodes(s.sent)).toEqual(["limit_reached"]);
    expect(s.model.readCalls).toHaveLength(2);
    expect(s.session.state()).toBe("done");
  });

  it("adds a failed solve's tokens to the session total", async () => {
    const failed = new ModelError("solve_failed", "cut off", { inputTokens: 85, outputTokens: 5 });
    const s = setup(
      {
        read: [readReturns(misread(), { inputTokens: 10, outputTokens: 0 })],
        solve: [{ kind: "throw", error: failed }, solveWith(claimB(8))],
      },
      { limits: { maxSessionTokens: 1000 } },
    );
    await runToDone(s);
    expect(errorCodes(s.sent)).toEqual(["solve_failed"]);
    expect(s.session.state()).toBe("idle");

    await runToDone(s);
    // 1000 - 10 (read) - 90 (failed solve) - 10 (second read)
    expect(s.model.solveCalls[1]?.tokenBudget).toBe(890);
  });

  it("counts the tokens of a solve that settles after cancel", async () => {
    const s = setup(
      {
        read: [readReturns()],
        solve: [{ kind: "hold", output: { claim: claimB(8), text: "", usage: { inputTokens: 400, outputTokens: 100 } } }],
      },
      { limits: { maxSessionTokens: 500 } },
    );
    await runToDone(s);
    s.session.receive(CANCEL);
    s.model.release();
    await flush();

    s.sent.length = 0;
    s.session.receive(START);
    expect(errorCodes(s.sent)).toEqual(["limit_reached"]);
    expect(s.model.readCalls).toHaveLength(1);
  });

  it("refuses a start while a cancelled call has not settled, and accepts it once it has", async () => {
    const s = setup(
      {
        read: [readReturns()],
        solve: [{ kind: "hold", output: { claim: claimB(8), text: "", usage: { inputTokens: 40, outputTokens: 0 } } }],
      },
      { limits: { maxSessionTokens: 1000 } },
    );
    await runToDone(s);
    s.session.receive(CANCEL);
    s.sent.length = 0;
    s.session.receive(START);
    expect(ofType(s.sent, "error")).toEqual([
      { type: "error", code: "bad_state", message: "The last request is still stopping. Try again in a moment." },
    ]);
    expect(s.model.readCalls).toHaveLength(1);
    expect(s.session.state()).toBe("idle");

    s.model.release();
    await flush();
    s.sent.length = 0;
    s.session.receive(START);
    expect(types(s.sent)).toEqual(["reading"]);
    expect(s.model.readCalls[1]?.tokenBudget).toBe(960); // the cancelled solve's 40 tokens are counted
  });

  it("refuses a start after a read timeout until the timed-out call settles", async () => {
    const s = setup(
      { read: [{ kind: "hold", output: { structure: misread(), usage: ZERO } }, readReturns()] },
      { limits: { readTimeoutMs: 5 } },
    );
    s.session.receive(START);
    await wait(30);
    expect(errorCodes(s.sent)).toEqual(["read_failed"]);
    s.session.receive(START);
    expect(errorCodes(s.sent)).toEqual(["read_failed", "bad_state"]);
    s.model.release();
    await flush();
    s.session.receive(START);
    expect(types(s.sent).at(-1)).toBe("reading");
  });

  it("adds the partial tokens of a solve turn aborted by cancel to the session total (real solver and SDK stream)", async () => {
    const api = sdkStreamApi([{ events: [messageStart(50_000)], hang: true }]);
    const fake = createFakeModel({ read: [readReturns(misread(), { inputTokens: 100, outputTokens: 0 })] });
    const model = { mode: "replay" as const, read: fake.read, solve: (input: SolveInput) => solveWithTools(api, input) };
    const sent: ServerMessage[] = [];
    const session = createSession({ model, send: (m) => sent.push(m), samples: SAMPLES, limits: { maxSessionTokens: 50_050 } });
    session.receive(START);
    await flush();
    session.receive(approve());
    await wait(30); // the stream has delivered message_start
    session.receive(CANCEL);
    await wait(30); // the aborted call settles
    sent.length = 0;
    session.receive(START);
    // 100 (read) + 50,000 (the aborted turn's input) + 1 (its output so far) is over the 50,050 budget.
    expect(errorCodes(sent)).toEqual(["limit_reached"]);
  });

  it("adds the partial tokens of a read aborted by cancel to the session total (real reader and SDK stream)", async () => {
    const api = sdkStreamApi([{ events: [messageStart(50_000)], hang: true }]);
    const model = {
      mode: "live" as const,
      read: (input: ReadInput) => readStructure(api, input),
      solve: () => Promise.reject(new Error("no solve in this test")),
    };
    const sent: ServerMessage[] = [];
    const session = createSession({ model, send: (m) => sent.push(m), samples: SAMPLES, limits: { maxSessionTokens: 50_000 } });
    const withImage = JSON.stringify({ type: "start", image: { mediaType: "image/png", base64: "AAAA" }, sampleId: null, question: "q" });
    session.receive(withImage);
    await wait(30); // the stream has delivered message_start
    session.receive(CANCEL);
    await wait(30); // the aborted call settles
    sent.length = 0;
    session.receive(withImage);
    expect(errorCodes(sent)).toEqual(["limit_reached"]);
  });

  it("sends nothing after close", async () => {
    const s = setup({ read: [{ kind: "hold", output: { structure: misread(), usage: ZERO } }] });
    s.session.receive(START);
    const before = s.sent.length;
    s.session.close();
    expect(s.model.readCalls[0]?.signal.aborted).toBe(true);
    s.model.release();
    await flush();
    s.session.receive(CANCEL);
    expect(s.sent).toHaveLength(before);
  });

  it("runs a second full session after done, with step numbers from 0", async () => {
    const s = setup({ read: [readReturns()], solve: [scriptedC01()] });
    await runToDone(s);
    expect(s.session.state()).toBe("done");

    s.sent.length = 0;
    await runToDone(s);
    expect(types(s.sent).filter((t) => t !== "token")).toEqual([
      "reading", "parsed", "awaiting_review", "solving", "step", "step", "checking", "check", "done",
    ]);
    expect(ofType(s.sent, "step").map((m) => m.index)).toEqual([0, 1]);
    expect(ofType(s.sent, "done")[0]?.verified).toBe(true);
  });
});
