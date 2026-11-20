import { describe, expect, it } from "vitest";
import { circuit, resistor, vsource, NO_SETUP } from "./helpers";
import { parseClientMessage, parseServerMessage } from "../src/shared/protocol";
import { LIMITS } from "../src/shared/limits";
import type { Structure } from "../src/core/schema";

const image = { mediaType: "image/png" as const, base64: "AAAA" };
const usage = { inputTokens: 10, outputTokens: 5 };
const structure: Structure = circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "gnd")]);
const claim = { kind: "node_voltage" as const, node: "A", setup: NO_SETUP, value: 12 };

describe("client messages", () => {
  it("parses each client type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "start", image, sampleId: null, question: "Find V(A)." })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "start", image: null, sampleId: "c01", question: "Find V(A)." })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "approve", structure })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "reopen" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "cancel" })).ok).toBe(true);
  });

  it("rejects start with both image and sampleId", () => {
    const raw = JSON.stringify({ type: "start", image, sampleId: "c01", question: "Q" });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects start with neither image nor sampleId", () => {
    const raw = JSON.stringify({ type: "start", image: null, sampleId: null, question: "Q" });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects an empty question after trimming", () => {
    const raw = JSON.stringify({ type: "start", image: null, sampleId: "c01", question: "   " });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects a question of 1001 characters", () => {
    expect(LIMITS.maxQuestionChars).toBe(1000);
    const raw = JSON.stringify({ type: "start", image: null, sampleId: "c01", question: "x".repeat(1001) });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects approve with a component missing b", () => {
    const bad = JSON.parse(JSON.stringify({ type: "approve", structure })) as { structure: { components: Array<Record<string, unknown>> } };
    delete bad.structure.components[0]?.b;
    expect(parseClientMessage(JSON.stringify(bad)).ok).toBe(false);
  });

  it("returns an error for text that is not JSON", () => {
    const result = parseClientMessage("not json");
    expect(result.ok).toBe(false);
  });

  it("returns an error for an unknown type", () => {
    const result = parseClientMessage("{\"type\":\"nope\"}");
    expect(result.ok).toBe(false);
  });
});

describe("server messages", () => {
  it("parses each server type", () => {
    const report = { verified: true, items: [], residuals: null, notes: [] };
    const warning = { code: "empty", severity: "warning", message: "Nothing here.", componentId: null, node: null };
    const messages = [
      { type: "hello", mode: "replay", samples: [{ id: "c01", title: "Divider", question: "Q", imageUrl: "/c01.png" }] },
      { type: "reading" },
      { type: "parsed", structure, warnings: [warning] },
      { type: "awaiting_review" },
      { type: "solving", attempt: 1 },
      { type: "token", text: "Using KVL." },
      { type: "step", index: 0, tool: "solve_circuit", input: { changes: [] }, output: { ok: true, nodeVoltages: {} } },
      { type: "checking" },
      { type: "check", report, attempt: 2 },
      { type: "done", claim, text: "V(A) is 12 V.", verified: true, usage },
      { type: "error", code: "limit_reached", message: "Too many turns." },
    ];
    for (const message of messages) {
      const result = parseServerMessage(JSON.stringify(message));
      expect(result.ok, `${message.type}: ${result.ok ? "" : result.error}`).toBe(true);
    }
  });

  it("parses a step whose output has extra keys", () => {
    const raw = JSON.stringify({ type: "step", index: 1, tool: "evaluate", input: "1+1", output: { ok: false, error: "bad", extra: 1 } });
    expect(parseServerMessage(raw).ok).toBe(true);
  });

  it("parses done with claim null", () => {
    const raw = JSON.stringify({ type: "done", claim: null, text: "", verified: false, usage });
    expect(parseServerMessage(raw).ok).toBe(true);
  });

  it("returns an error for text that is not JSON", () => {
    expect(parseServerMessage("{").ok).toBe(false);
  });
});
