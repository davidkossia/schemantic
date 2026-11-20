import { request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { problem as c01 } from "../eval/problems/c01";
import { createScriptedClient } from "../src/agents/scripted";
import type { ModelClient } from "../src/pipeline/model";
import { startServer, type ServerLimits } from "../src/server/app";
import { parseServerMessage, type ServerMessage } from "../src/shared/protocol";
import { REPLAY_FIXTURES } from "../fixtures/replay";

type Running = { port: number; close(): Promise<void> };

const SAMPLES = REPLAY_FIXTURES.map((f) => f.sample);
const open: Running[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];

type BootOverrides = {
  staticDir?: string | null;
  allowedOrigins?: string[] | null;
  limits?: Partial<ServerLimits>;
  model?: ModelClient;
};

async function boot(overrides: BootOverrides = {}): Promise<Running> {
  const server = await startServer({
    port: 0,
    model: overrides.model ?? createScriptedClient({ fixtures: REPLAY_FIXTURES }),
    samples: SAMPLES,
    staticDir: overrides.staticDir ?? null,
    allowedOrigins: overrides.allowedOrigins ?? null,
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
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

function connect(port: number, options: { origin?: string; autoPong?: boolean } = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      autoPong: options.autoPong ?? true,
    });
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

type Got = { status: number; body: string; nosniff: string | undefined };

function get(port: number, path: string): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      const header = res.headers["x-content-type-options"];
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, nosniff: typeof header === "string" ? header : undefined }));
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
    await expect(connect(port, { origin: "http://evil.example" })).rejects.toThrow();
    await expect(connect(port)).rejects.toThrow();
    const good = await connect(port, { origin: "http://localhost:5173" });
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

/** Resolves with the close code once the socket closes. */
function closeCode(ws: WebSocket): Promise<number> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve(1006);
  return new Promise((resolve) => ws.once("close", (code: number) => resolve(code)));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Connect, retrying while the server still counts a socket that just closed. */
async function connectWhenFree(port: number): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await connect(port);
    } catch (e) {
      if (attempt >= 20) throw e;
      await wait(25);
    }
  }
}

describe("server limits", () => {
  it("refuses the 5th connection from one address with 503, and frees the slot on close", async () => {
    const { port } = await boot();
    const four = await Promise.all([connect(port), connect(port), connect(port), connect(port)]);
    await expect(connect(port)).rejects.toThrow("503");
    four[0]?.ws.close();
    const again = await connectWhenFree(port);
    expect((await again.waitFor("hello")).type).toBe("hello");
  });

  it("refuses connections past the total cap with 503", async () => {
    const { port } = await boot({ limits: { maxConnections: 2 } });
    await Promise.all([connect(port), connect(port)]);
    await expect(connect(port)).rejects.toThrow("503");
  });

  it("terminates a socket that floods 50 bad messages in a second", async () => {
    const { port } = await boot();
    const client = await connect(port);
    await client.waitFor("hello");
    const closed = closeCode(client.ws);
    for (let i = 0; i < 50; i++) client.ws.send("not json");
    expect(await closed).toBe(1006);
    const errors = client.messages.filter((m) => m.type === "error");
    expect(errors.length).toBeLessThanOrEqual(20);
  });

  it("keeps a socket that sends 15 bad messages in a second", async () => {
    const { port } = await boot();
    const client = await connect(port);
    await client.waitFor("hello");
    for (let i = 0; i < 15; i++) client.ws.send("not json");
    await expect.poll(() => client.messages.filter((m) => m.type === "error").length).toBe(15);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("terminates a socket that stops answering pings, and keeps one that answers", async () => {
    const { port } = await boot({ limits: { pingIntervalMs: 50 } });
    const silent = await connect(port, { autoPong: false });
    const answering = await connect(port);
    expect(await closeCode(silent.ws)).toBe(1006);
    await wait(200);
    expect(answering.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a socket idle past the idle timeout", async () => {
    const { port } = await boot({ limits: { idleTimeoutMs: 100 } });
    const client = await connect(port);
    expect(await closeCode(client.ws)).toBe(1000);
  });

  it("applies one token budget per address across sockets", async () => {
    const scripted = createScriptedClient({ fixtures: REPLAY_FIXTURES });
    const usage = { inputTokens: 60, outputTokens: 40 };
    const model: ModelClient = {
      mode: scripted.mode,
      read: async (input) => ({ ...(await scripted.read(input)), usage }),
      solve: async (input) => ({ ...(await scripted.solve(input)), usage }),
    };
    const { port } = await boot({ model, limits: { ipTokenBudget: 150 } });
    const first = await connect(port);
    const done = await runC01(first);
    expect(done.type).toBe("done");
    first.ws.close();
    const second = await connectWhenFree(port);
    second.ws.send(startMessage());
    const err = await second.waitFor("error");
    if (err.type !== "error") throw new Error("expected error");
    expect(err.code).toBe("limit_reached");
  });
});

describe("http hardening", () => {
  it("sets nosniff on every response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schemantic-static-"));
    dirs.push(dir);
    await writeFile(join(dir, "index.html"), "<p>hello</p>");
    const { port } = await boot({ staticDir: dir });
    for (const path of ["/healthz", "/", "/missing.js"]) {
      expect((await get(port, path)).nosniff).toBe("nosniff");
    }
  });

  it("returns 404 for any path segment that starts with a dot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schemantic-static-"));
    dirs.push(dir);
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "config"), "secret");
    await writeFile(join(dir, ".hidden.json"), "{}");
    await writeFile(join(dir, "app.js"), "ok");
    const { port } = await boot({ staticDir: dir });
    expect((await get(port, "/app.js")).status).toBe(200);
    expect((await get(port, "/.hidden.json")).status).toBe(404);
    expect((await get(port, "/.git/config")).status).toBe(404);
    expect((await get(port, "/%2egit/config")).status).toBe(404);
  });
});
