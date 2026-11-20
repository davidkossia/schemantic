import { describe, expect, it } from "vitest";
import { circuit, resistor, vsource, NO_SETUP } from "./helpers";
import { initialState, reduce, type UiAction, type UiState } from "../web/src/state";
import type { CheckReport, Structure } from "../src/core/schema";
import type { ServerMessage } from "../src/shared/protocol";

const structure: Structure = circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]);
const usage = { inputTokens: 10, outputTokens: 5 };
const report: CheckReport = {
  verified: true,
  items: [{ name: "value", claimed: 12, measured: 12, unit: "V", ok: true }],
  residuals: null,
  notes: [],
};
const claim = { kind: "node_voltage" as const, node: "A", setup: NO_SETUP, value: 12 };

const server = (message: ServerMessage): UiAction => ({ type: "server", message });
const run = (actions: UiAction[], from: UiState = initialState): UiState => actions.reduce(reduce, from);

const sample = { id: "c01", title: "Divider", question: "Find V(A).", imageUrl: "/c01.png" };
const step = (index: number): ServerMessage => ({ type: "step", index, tool: "solve", input: {}, output: { ok: true, v: 1 } });

describe("reducer rows", () => {
  it("hello sets connected, mode and samples", () => {
    const s = run([server({ type: "hello", mode: "replay", samples: [sample] })]);
    expect(s).toMatchObject({ connected: true, mode: "replay", samples: [sample] });
  });

  it("started sets question and image and clears the run", () => {
    const dirty: UiState = {
      ...initialState,
      structure,
      warnings: [{ code: "empty", severity: "error", message: "m", componentId: null, node: null }],
      steps: [{ index: 0, tool: "t", input: {}, output: { ok: true } }],
      text: "x",
      reports: [report],
      result: { claim: null, text: "", verified: true, usage },
      error: { code: "internal", message: "e" },
      attempt: 2,
    };
    const s = reduce(dirty, { type: "started", question: "Q", imageUrl: "blob:1" });
    expect(s).toMatchObject({
      question: "Q", imageUrl: "blob:1", structure: null, warnings: [], steps: [], text: "",
      reports: [], result: null, error: null, attempt: null,
    });
  });

  it("reading sets the phase", () => {
    expect(run([server({ type: "reading" })]).phase).toBe("reading");
  });

  it("parsed sets structure and warnings", () => {
    const warnings = [{ code: "uncertain" as const, severity: "warning" as const, message: "m", componentId: "R1", node: null }];
    const s = run([server({ type: "parsed", structure, warnings })]);
    expect(s.structure).toEqual(structure);
    expect(s.warnings).toEqual(warnings);
  });

  it("awaiting_review sets the phase and clears the result", () => {
    const from: UiState = { ...initialState, phase: "done", result: { claim: null, text: "", verified: true, usage } };
    const s = run([server({ type: "awaiting_review" })], from);
    expect(s.phase).toBe("awaiting_review");
    expect(s.result).toBeNull();
  });

  it("edited sets structure and recomputes warnings", () => {
    const s = run([{ type: "edited", structure }]);
    expect(s.structure).toEqual(structure);
    expect(s.warnings.some((w) => w.severity === "error")).toBe(false);
  });

  it("solving attempt 1 clears text, steps and reports", () => {
    const from: UiState = { ...initialState, text: "x", reports: [report], steps: [{ index: 0, tool: "t", input: {}, output: { ok: true } }] };
    const s = run([server({ type: "solving", attempt: 1 })], from);
    expect(s).toMatchObject({ phase: "solving", attempt: 1, text: "", steps: [], reports: [] });
  });

  it("token appends to text", () => {
    const s = run([server({ type: "token", text: "ab" }), server({ type: "token", text: "cd" })]);
    expect(s.text).toBe("abcd");
  });

  it("step appends to steps", () => {
    const s = run([server(step(0)), server(step(1))]);
    expect(s.steps.map((x) => x.index)).toEqual([0, 1]);
    expect(s.steps[0]?.output.ok).toBe(true);
  });

  it("checking sets the phase", () => {
    expect(run([server({ type: "checking" })]).phase).toBe("checking");
  });

  it("check appends the report", () => {
    expect(run([server({ type: "check", report, attempt: 1 })]).reports).toEqual([report]);
  });

  it("done sets phase and result", () => {
    const s = run([server({ type: "done", claim, text: "V is 12 V", verified: true, usage })]);
    expect(s.phase).toBe("done");
    expect(s.result).toEqual({ claim, text: "V is 12 V", verified: true, usage });
  });

  it("error keeps the phase for cannot_solve, bad_message and bad_state", () => {
    for (const code of ["cannot_solve", "bad_message", "bad_state"] as const) {
      const s = run([server({ type: "error", code, message: "m" })], { ...initialState, phase: "awaiting_review" });
      expect(s.phase).toBe("awaiting_review");
      expect(s.error).toEqual({ code, message: "m" });
    }
  });

  it("error returns to idle for other codes", () => {
    const s = run([server({ type: "error", code: "read_failed", message: "m" })], { ...initialState, phase: "reading", connected: true });
    expect(s.phase).toBe("idle");
    expect(s.connected).toBe(true);
  });

  it("error internal Connection lost. sets connected false", () => {
    const s = run([server({ type: "error", code: "internal", message: "Connection lost." })], { ...initialState, phase: "solving", connected: true });
    expect(s).toMatchObject({ phase: "idle", connected: false });
  });

  it("internal error with another message keeps connected", () => {
    const s = run([server({ type: "error", code: "internal", message: "Oops." })], { ...initialState, connected: true });
    expect(s.connected).toBe(true);
  });

  it("dismissed_error clears the error", () => {
    const s = run([server({ type: "error", code: "refused", message: "m" }), { type: "dismissed_error" }]);
    expect(s.error).toBeNull();
  });
});

describe("sequences and purity", () => {
  it("a c01 replay session ends done with two steps and one report", () => {
    const s = run([
      server({ type: "hello", mode: "replay", samples: [sample] }),
      { type: "started", question: sample.question, imageUrl: sample.imageUrl },
      server({ type: "reading" }),
      server({ type: "parsed", structure, warnings: [] }),
      server({ type: "awaiting_review" }),
      server({ type: "solving", attempt: 1 }),
      server({ type: "token", text: "Solving." }),
      server(step(0)),
      server(step(1)),
      server({ type: "checking" }),
      server({ type: "check", report, attempt: 1 }),
      server({ type: "done", claim, text: "V(A) = 12 V", verified: true, usage }),
    ]);
    expect(s.phase).toBe("done");
    expect(s.steps).toHaveLength(2);
    expect(s.reports).toHaveLength(1);
  });

  it("edited with no ground gives a no_ground warning", () => {
    const noGround: Structure = { ...structure, ground: "nowhere" };
    const s = run([{ type: "edited", structure: noGround }]);
    expect(s.warnings.map((w) => w.code)).toContain("no_ground");
  });

  it("retry: solving attempt 2 keeps steps and reports and clears text", () => {
    const s = run([
      server({ type: "solving", attempt: 1 }),
      server({ type: "token", text: "first" }),
      server(step(0)),
      server({ type: "check", report: { ...report, verified: false }, attempt: 1 }),
      server({ type: "solving", attempt: 2 }),
    ]);
    expect(s).toMatchObject({ attempt: 2, text: "" });
    expect(s.steps).toHaveLength(1);
    expect(s.reports).toHaveLength(1);
  });

  it("reduce returns a new object and leaves the old state unchanged", () => {
    const before = run([server({ type: "solving", attempt: 1 }), server(step(0)), server({ type: "check", report, attempt: 1 })]);
    const copy = structuredClone(before);
    const after = reduce(before, server({ type: "token", text: "x" }));
    expect(after).not.toBe(before);
    expect(before).toEqual(copy);
    const after2 = reduce(before, { type: "edited", structure });
    expect(after2).not.toBe(before);
    expect(before).toEqual(copy);
  });
});
