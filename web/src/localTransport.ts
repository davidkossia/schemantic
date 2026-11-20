/**
 * In-page transport for the static demo. It runs the session and the scripted client in the browser,
 * so the demo needs no server and no key. No Node built-ins.
 */
import { createScriptedClient } from "../../src/agents/scripted";
import { createSession } from "../../src/pipeline/session";
import type { ServerMessage } from "../../src/shared/protocol";
import { REPLAY_FIXTURES } from "../../fixtures/replay";
import type { Transport } from "./transport";

export function localTransport(): Transport {
  const listeners = new Set<(message: ServerMessage) => void>();
  // The session sends `hello` while it is created, before anyone can subscribe. Hold messages until then.
  const held: ServerMessage[] = [];
  let closed = false;

  const session = createSession({
    model: createScriptedClient({ fixtures: REPLAY_FIXTURES, tokenDelayMs: 15 }),
    samples: REPLAY_FIXTURES.map((f) => f.sample),
    send(message) {
      if (listeners.size === 0) {
        held.push(message);
        return;
      }
      for (const listener of [...listeners]) listener(message);
    },
  });

  return {
    send(message) {
      const frame = JSON.stringify(message);
      queueMicrotask(() => {
        if (!closed) session.receive(frame);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      for (const message of held.splice(0)) listener(message);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
      session.close();
    },
  };
}
