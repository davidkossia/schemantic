import { request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { problem as c01 } from "../eval/problems/c01";
import { createScriptedClient } from "../src/agents/scripted";
import { startServer } from "../src/server/app";
import { parseServerMessage, type ServerMessage } from "../src/shared/protocol";
import { REPLAY_FIXTURES } from "../fixtures/replay";

type Running = { port: number; close(): Promise<void> };

const SAMPLES = REPLAY_FIXTURES.map((f) => f.sample);
const open: Running[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];

async function boot(overrides: { staticDir?: string | null; allowedOrigins?: string[] | null } = {}): Promise<Running> {
  const server = await startServer({
    port: 0,
    model: createScriptedClient({ fixtures: REPLAY_FIXTURES }),
    samples: SAMPLES,
    staticDir: overrides.staticDir ?? null,
    allowedOrigins: overrides.allowedOrigins ?? null,
  });
  open.push(server);
  return server;
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of open.splice(0)) await s.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A connected socket that records every server message in order. */
type Client = { ws: WebSocket; messages: ServerMessage[]; waitFor(type: ServerMessage["type"]): Promise<ServerMessage> };

function connect(port: number, origin?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === undefined ? {} : { origin });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    const waiters: { type: string; resolve: (m: ServerMessage) => void }[] = [];
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) return;
      messages.push(parsed.value);
      for (const w of waiters.splice(0)) {
        if (w.type === parsed.value.type) w.resolve(parsed.value);
        else waiters.push(w);
      }
    });
    const waitFor = (type: ServerMessage["type"]): Promise<ServerMessage> => {
      const seen = messages.find((m) => m.type === type);
      if (seen) return Promise.resolve(seen);
      return new Promise((res) => waiters.push({ type, resolve: res }));
    };
    ws.once("open", () => resolve({ ws, messages, waitFor }));
    ws.once("error", reject);
  });
}

function startMessage(): string {
  return JSON.stringify({ type: "start", image: null, sampleId: "c01", question: c01.question });
}

/** Drive a full c01 session: start, approve the true circuit, wait for done. */
async function runC01(client: Client): Promise<ServerMessage> {
  client.ws.send(startMessage());
  await client.waitFor("awaiting_review");
  client.ws.send(JSON.stringify({ type: "approve", structure: c01.truth }));
  return client.waitFor("done");
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("websocket server", () => {
  it("sends hello first, with replay mode and two samples", async () => {
    const { port } = await boot();
    const client = await connect(port);
    const hello = await client.waitFor("hello");
    expect(client.messages[0]?.type).toBe("hello");
    if (hello.type !== "hello") throw new Error("expected hello");
    expect(hello.mode).toBe("replay");
    expect(hello.samples).toHaveLength(2);
  });

  it("runs a full c01 session to a verified done", async () => {
    const { port } = await boot();
    const client = await connect(port);
    const done = await runC01(client);
    if (done.type !== "done") throw new Error("expected done");
    expect(done.verified).toBe(true);
  });

  it("answers a binary frame with bad_message and stays open", async () => {
    const { port } = await boot();
    const client = await connect(port);
    await client.waitFor("hello");
    client.ws.send(Buffer.from([1, 2, 3]));
    const err = await client.waitFor("error");
    if (err.type !== "error") throw new Error("expected error");
    expect(err.code).toBe("bad_message");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("keeps two sockets separate", async () => {
    const { port } = await boot();
    const [a, b] = await Promise.all([connect(port), connect(port)]);
    const [doneA] = await Promise.all([runC01(a), (async () => b.waitFor("hello"))()]);
    expect(doneA.type).toBe("done");
    expect(b.messages.map((m) => m.type)).toEqual(["hello"]);
    const doneB = await runC01(b);
    expect(doneB.type).toBe("done");
    expect(a.messages.filter((m) => m.type === "done")).toHaveLength(1);
    expect(b.messages.filter((m) => m.type === "done")).toHaveLength(1);
  });

  it("checks the Origin header when a list is set", async () => {
    const { port } = await boot({ allowedOrigins: ["http://localhost:5173"] });
    await expect(connect(port, "http://evil.example")).rejects.toThrow();
    await expect(connect(port)).rejects.toThrow();
    const good = await connect(port, "http://localhost:5173");
    const hello = await good.waitFor("hello");
    expect(hello.type).toBe("hello");
  });

  it("closes and stops accepting connections", async () => {
    const server = await boot();
    const client = await connect(server.port);
    await client.waitFor("hello");
    const closed = new Promise<void>((res) => client.ws.once("close", () => res()));
    await server.close();
    open.splice(open.indexOf(server), 1);
    await closed;
    expect(client.ws.readyState).toBe(WebSocket.CLOSED);
    await expect(connect(server.port)).rejects.toThrow();
  });
});

describe("http", () => {
  it("answers /healthz", async () => {
    const { port } = await boot();
    const res = await get(port, "/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("serves the static folder and refuses paths outside it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schemantic-static-"));
    dirs.push(dir);
    const site = join(dir, "site");
    await import("node:fs/promises").then((fs) => fs.mkdir(site));
    await writeFile(join(site, "index.html"), "<p>hello</p>");
    await writeFile(join(dir, "secret.json"), "{}");
    const { port } = await boot({ staticDir: site });
    const root = await get(port, "/");
    expect(root.status).toBe(200);
    expect(root.body).toBe("<p>hello</p>");
    expect((await get(port, "/../secret.json")).status).toBe(404);
    expect((await get(port, "/%2e%2e/secret.json")).status).toBe(404);
    expect((await get(port, "/..%2fsecret.json")).status).toBe(404);
    expect((await get(port, "/missing.js")).status).toBe(404);
  });

  it("returns 404 for unknown paths without a static folder", async () => {
    const { port } = await boot();
    expect((await get(port, "/")).status).toBe(404);
  });
});
