import { describe, expect, it } from "vitest";
import { createScriptedClient } from "../src/agents/scripted";
import { checkClaim } from "../src/core/checker";
import type { Circuit, Structure } from "../src/core/schema";
import { createToolRunner } from "../src/core/tools";
import { validate } from "../src/core/validate";
import { ModelError, type SolveEvent } from "../src/pipeline/model";
import { REPLAY_FIXTURES } from "../fixtures/replay";
import { problem as c01 } from "../eval/problems/c01";
import { problem as c09 } from "../eval/problems/c09";
import { closeTo } from "../src/core/units";

const client = createScriptedClient({ fixtures: REPLAY_FIXTURES });

function circuitOf(s: Structure): Circuit {
  if (s.kind !== "circuit") throw new Error("expected a circuit");
  return s;
}

async function readSample(id: string): Promise<Circuit> {
  const out = await client.read({ image: null, sampleId: id, question: "", signal: new AbortController().signal });
  return circuitOf(out.structure);
}

async function solveOn(id: string, structure: Structure, signal = new AbortController().signal) {
  const events: SolveEvent[] = [];
  const out = await client.solve({
    structure,
    question: "",
    sampleId: id,
    tools: createToolRunner(structure),
    feedback: null,
    tokenBudget: 200_000,
    onEvent: (e) => events.push(e),
    signal,
  });
  const steps = events.flatMap((e) => (e.type === "step" ? [e.tool] : []));
  return { out, events, steps };
}

function withValue(c: Circuit, id: string, value: number): Circuit {
  return { ...c, components: c.components.map((k) => (k.id === id ? { ...k, value } : k)) };
}

describe("scripted client: read", () => {
  it("returns the c01 misread, which the validator flags", async () => {
    const c = await readSample("c01");
    expect(c.components.find((k) => k.id === "R2")?.value).toBe(20000);
    expect(validate(c).filter((w) => w.code === "label_mismatch")).toHaveLength(1);
  });

  it("returns equal but distinct copies", async () => {
    const a = await readSample("c01");
    const b = await readSample("c01");
    expect(a).toEqual(b);
    const first = a.components[0];
    if (!first) throw new Error("no components");
    first.value = 999;
    expect(b.components[0]?.value).not.toBe(999);
  });

  it("rejects an unknown sample with read_failed", async () => {
    await expect(client.read({ image: null, sampleId: "zzz", question: "", signal: new AbortController().signal })).rejects.toMatchObject({
      code: "read_failed",
    });
    await expect(client.read({ image: null, sampleId: null, question: "", signal: new AbortController().signal })).rejects.toBeInstanceOf(
      ModelError,
    );
  });

  it("has two fixtures with relative image urls", () => {
    expect(REPLAY_FIXTURES.map((f) => f.sample.imageUrl)).toEqual(["samples/c01.png", "samples/c09.png"]);
    expect(client.mode).toBe("replay");
  });
});

describe("scripted client: solve", () => {
  it("c01 corrected: value 8, two steps, verified", async () => {
    const approved = withValue(await readSample("c01"), "R2", 2000);
    const { out, steps, events } = await solveOn("c01", approved);
    expect(out.claim?.kind === "node_voltage" && out.claim.value).toBeCloseTo(8, 9);
    expect(steps).toEqual(["solve_circuit", "submit_answer"]);
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(out.text.endsWith("V(B) = 8 V.")).toBe(true);
    if (!out.claim) throw new Error("no claim");
    expect(checkClaim(approved, out.claim).verified).toBe(true);
  });

  it("c01 uncorrected: answers for what was approved", async () => {
    const approved = await readSample("c01");
    const { out } = await solveOn("c01", approved);
    if (!out.claim || out.claim.kind !== "node_voltage") throw new Error("no claim");
    expect(closeTo(out.claim.value, (12 * 20000) / 21000)).toBe(true);
    expect(checkClaim(approved, out.claim).verified).toBe(true);
  });

  it("c09 corrected: vth 9, rth 4000, three steps", async () => {
    const approved = circuitOf(c09.truth);
    const { out, steps } = await solveOn("c09", approved);
    if (!out.claim || out.claim.kind !== "thevenin") throw new Error("no claim");
    expect(out.claim.vth).toBeCloseTo(9, 9);
    expect(out.claim.rth).toBeCloseTo(4000, 6);
    expect(steps).toEqual(["solve_circuit", "solve_circuit", "submit_answer"]);
    expect(checkClaim(approved, out.claim).verified).toBe(true);
  });

  it("returns a null claim with the tool error when the queried part was deleted", async () => {
    const base = circuitOf(c09.truth);
    const approved: Circuit = { ...base, components: base.components.filter((k) => k.id !== "RL") };
    const { out, steps } = await solveOn("c09", approved);
    expect(out.claim).toBeNull();
    expect(out.text).toContain("RL");
    expect(steps).toEqual(["solve_circuit"]);
    // c01 with the queried node gone
    const c = circuitOf(c01.truth);
    const gone: Circuit = { ...c, components: c.components.filter((k) => k.id === "V1") };
    const r = await solveOn("c01", gone);
    expect(r.out.claim).toBeNull();
    expect(r.out.text).toContain("node B");
  });

  it("rejects with cancelled when the signal is already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(solveOn("c01", circuitOf(c01.truth), ctl.signal)).rejects.toMatchObject({ code: "cancelled" });
  });

  it("emits one word per token event", async () => {
    const { events, out } = await solveOn("c01", circuitOf(c01.truth));
    const text = events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(text).toBe(`${out.text} `);
  });
});
