/**
 * HTTP and WebSocket server: serves the built client and runs one session per socket.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { ModelError, type ModelClient, type Usage } from "../pipeline/model";
import { createSession } from "../pipeline/session";
import { LIMITS } from "../shared/limits";
import type { Sample, ServerMessage } from "../shared/protocol";

/** Limits the server applies to sockets and addresses. Sessions apply `LIMITS` on top of these. */
export type ServerLimits = {
  maxConnectionsPerIp: number; // open sockets from one address
  maxConnections: number; // open sockets in total
  pingIntervalMs: number; // a socket that misses one pong by the next ping is terminated
  idleTimeoutMs: number; // a socket with no client message for this long is closed
  maxBufferedBytes: number; // unsent bytes queued for one socket before it is terminated
  maxMessagesPerSecond: number; // client messages per socket per second before it is terminated
  ipTokenBudget: number; // model tokens one address may spend per window, across all its sockets
  ipTokenWindowMs: number;
};

export const SERVER_LIMITS: ServerLimits = {
  maxConnectionsPerIp: 4,
  maxConnections: 64,
  pingIntervalMs: 30_000,
  idleTimeoutMs: 10 * 60_000,
  maxBufferedBytes: 1024 * 1024,
  maxMessagesPerSecond: 20,
  ipTokenBudget: 4 * LIMITS.maxSessionTokens,
  ipTokenWindowMs: 24 * 60 * 60_000,
};

export type ServerOptions = {
  port: number;
  model: ModelClient;
  samples: Sample[];
  staticDir: string | null;
  allowedOrigins: string[] | null;
  limits?: Partial<ServerLimits>;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const NOSNIFF = { "X-Content-Type-Options": "nosniff" } as const;

function reply(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { ...NOSNIFF, "Content-Type": type });
  res.end(body);
}

/** Resolve a request path to a file inside `root`, or null when it points anywhere else or at a dotfile. */
async function resolveStatic(root: string, rawPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.split(/[/\\]/).some((segment) => segment.startsWith("."))) return null;
  const relative = decoded === "/" ? "/index.html" : decoded;
  const candidate = resolve(root, `.${relative.startsWith("/") ? relative : `/${relative}`}`);
  try {
    const realRoot = await realpath(root);
    const real = await realpath(candidate);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    const info = await stat(real);
    return info.isFile() ? real : null;
  } catch {
    return null;
  }
}

async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
  const file = await resolveStatic(root, rawPath);
  if (file === null) {
    reply(res, 404, "Not found");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...NOSNIFF,
      "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    reply(res, 404, "Not found");
  }
}

function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

/** The peer address, with the IPv4-mapped IPv6 prefix removed so both forms count as one address. */
function clientIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? "unknown";
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

/** Tokens one address has spent in the current window. */
type IpSpend = { used: number; windowStart: number };

/**
 * Wrap `model` so every call counts toward `ip`'s token budget, and refuse calls once it is spent.
 * The session keeps its own per-socket budget; this one spans every socket from the address.
 */
/** Largest WebSocket message accepted in replay mode. A maximal approved structure is about 50,000 characters. */
export const REPLAY_MAX_FRAME_BYTES = 64 * 1024;

function meteredModel(model: ModelClient, left: () => number, spend: (tokens: number) => void): ModelClient {
  const count = (u: Usage): void => spend(u.inputTokens + u.outputTokens);
  function guarded<T extends { usage: Usage }>(call: () => Promise<T>): Promise<T> {
    if (left() <= 0) {
      return Promise.reject(new ModelError("limit_reached", "This address has used its token budget. Try again later."));
    }
    let pending: Promise<T>;
    try {
      pending = call();
    } catch (e) {
      return Promise.reject(e);
    }
    return pending.then(
      (out) => {
        count(out.usage);
        return out;
      },
      (e: unknown) => {
        if (e instanceof ModelError && e.usage !== undefined) count(e.usage);
        throw e;
      },
    );
  }
  return {
    mode: model.mode,
    read: (input) => guarded(() => model.read({ ...input, tokenBudget: Math.min(input.tokenBudget, left()) })),
    solve: (input) => guarded(() => model.solve({ ...input, tokenBudget: Math.min(input.tokenBudget, left()) })),
  };
}

export function startServer(options: ServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const { model, samples, staticDir, allowedOrigins } = options;
  const limits: ServerLimits = { ...SERVER_LIMITS, ...options.limits };

  const server: Server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/healthz") {
      reply(res, 200, "ok");
      return;
    }
    if (staticDir !== null && (method === "GET" || method === "HEAD")) {
      void serveStatic(staticDir, req, res);
      return;
    }
    reply(res, 404, "Not found");
  });

  // Replay mode takes no image uploads, so its messages are small; a 64 KB cap stops one 8 MB frame
  // from stalling the event loop while it parses. Live mode keeps the full frame limit for images.
  const maxPayload = model.mode === "replay" ? REPLAY_MAX_FRAME_BYTES : LIMITS.maxFrameBytes;
  const wss = new WebSocketServer({ noServer: true, maxPayload });

  // Open sockets per address and in total. A slot is taken before the upgrade and freed when the raw socket closes.
  const openByIp = new Map<string, number>();
  let openTotal = 0;
  const spendByIp = new Map<string, IpSpend>();

  function spendFor(ip: string): IpSpend {
    const now = Date.now();
    let entry = spendByIp.get(ip);
    if (entry === undefined || now - entry.windowStart >= limits.ipTokenWindowMs) {
      entry = { used: 0, windowStart: now };
      spendByIp.set(ip, entry);
    }
    return entry;
  }

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/ws") {
      refuseUpgrade(socket, 404, "Not Found");
      return;
    }
    if (allowedOrigins !== null) {
      const origin = req.headers.origin;
      if (origin === undefined || !allowedOrigins.includes(origin)) {
        refuseUpgrade(socket, 403, "Forbidden");
        return;
      }
    }
    const ip = clientIp(req);
    const fromIp = openByIp.get(ip) ?? 0;
    if (fromIp >= limits.maxConnectionsPerIp || openTotal >= limits.maxConnections) {
      refuseUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    openByIp.set(ip, fromIp + 1);
    openTotal += 1;
    socket.once("close", () => {
      openTotal -= 1;
      const now = (openByIp.get(ip) ?? 1) - 1;
      if (now <= 0) openByIp.delete(ip);
      else openByIp.set(ip, now);
    });
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Sockets that answered the last ping. The heartbeat terminates any socket not in this set.
  const alive = new WeakSet<WebSocket>();

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req);
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));

    const send = (message: ServerMessage): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(message));
      if (ws.bufferedAmount > limits.maxBufferedBytes) ws.terminate();
    };
    const metered = meteredModel(
      model,
      () => limits.ipTokenBudget - spendFor(ip).used,
      (tokens) => {
        spendFor(ip).used += tokens;
      },
    );
    const session = createSession({ model: metered, send, samples });

    let idleTimer: ReturnType<typeof setTimeout> =setTimeout(() => ws.close(1000, "Idle"), limits.idleTimeoutMs);
    let windowStart = Date.now();
    let windowCount = 0;

    ws.on("message", (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }
      windowCount += 1;
      if (windowCount > limits.maxMessagesPerSecond || ws.bufferedAmount > limits.maxBufferedBytes) {
        ws.terminate();
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => ws.close(1000, "Idle"), limits.idleTimeoutMs);
      if (isBinary) {
        send({ type: "error", code: "bad_message", message: "Send text frames only." });
        return;
      }
      try {
        session.receive(data.toString());
      } catch {
        send({ type: "error", code: "internal", message: "Something went wrong." });
      }
    });
    const end = (): void => {
      clearTimeout(idleTimer);
      session.close();
    };
    ws.on("close", end);
    ws.on("error", end);
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
    const now = Date.now();
    for (const [ip, entry] of spendByIp) {
      if (now - entry.windowStart >= limits.ipTokenWindowMs) spendByIp.delete(ip);
    }
  }, limits.pingIntervalMs);
  heartbeat.unref();

  return new Promise((resolvePromise, reject) => {
    server.once("error", (e) => {
      clearInterval(heartbeat);
      reject(e);
    });
    server.listen(options.port, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        clearInterval(heartbeat);
        reject(new Error("The server has no port."));
        return;
      }
      resolvePromise({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            for (const client of wss.clients) client.terminate();
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
