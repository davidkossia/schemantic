import type { ClientMessage, ServerMessage } from "../../src/shared/protocol";
import { parseServerMessage } from "../../src/shared/protocol";

export type Transport = {
  send(message: ClientMessage): void;
  subscribe(listener: (message: ServerMessage) => void): () => void;
  close(): void;
};

const CONNECTION_LOST: ServerMessage = { type: "error", code: "internal", message: "Connection lost." };

export function wsTransport(url: string): Transport {
  const socket = new WebSocket(url);
  const listeners = new Set<(message: ServerMessage) => void>();
  const queue: string[] = [];

  const deliver = (message: ServerMessage): void => {
    for (const listener of [...listeners]) listener(message);
  };

  socket.addEventListener("open", () => {
    for (const frame of queue.splice(0)) socket.send(frame);
  });
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    const parsed = parseServerMessage(event.data);
    if (parsed.ok) deliver(parsed.value);
  });
  socket.addEventListener("close", () => deliver(CONNECTION_LOST));

  return {
    send(message) {
      const frame = JSON.stringify(message);
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
      else queue.push(frame);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
      socket.close();
    },
  };
}
