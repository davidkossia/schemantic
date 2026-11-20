import { describe, expect, it } from "vitest";
import { problem as c01 } from "../eval/problems/c01";
import { localTransport } from "../web/src/localTransport";
import type { ServerMessage } from "../src/shared/protocol";

describe("localTransport", () => {
  it("runs a full c01 session to done with verified true", async () => {
    const t = localTransport();
    const messages: ServerMessage[] = [];
    const waitFor = (type: ServerMessage["type"]) =>
      new Promise<void>((resolve) => {
        const check = () => messages.some((m) => m.type === type);
        if (check()) return resolve();
        const timer = setInterval(() => {
          if (check()) {
            clearInterval(timer);
            resolve();
          }
        }, 5);
      });
    t.subscribe((m) => messages.push(m));

    expect(messages[0]?.type).toBe("hello");
    t.send({ type: "start", image: null, sampleId: "c01", question: c01.question });
    await waitFor("awaiting_review");
    if (c01.truth.kind !== "circuit") throw new Error("c01 is a circuit");
    t.send({ type: "approve", structure: c01.truth });
    await waitFor("done");
    t.close();

    const done = messages.find((m) => m.type === "done");
    expect(done?.type === "done" && done.verified).toBe(true);
  }, 20000);
});
