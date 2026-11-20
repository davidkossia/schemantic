/**
 * HTTP and WebSocket server: serves the built client and runs one session per socket.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { ModelClient } from "../pipeline/model";
import { createSession } from "../pipeline/session";
import { LIMITS } from "../shared/limits";
import type { Sample, ServerMessage } from "../shared/protocol";

export type ServerOptions = {
  port: number;
  model: ModelClient;
  samples: Sample[];
  staticDir: string | null;
  allowedOrigins: string[] | null;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function reply(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

/** Resolve a request path to a file inside `root`, or null when it points anywhere else. */
async function resolveStatic(root: string, rawPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
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
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    reply(res, 404, "Not found");
  }
}

function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function startServer(options: ServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const { model, samples, staticDir, allowedOrigins } = options;

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

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxFrameBytes });

  server.on("upgrade", (req, socket, head) => {
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
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    const send = (message: ServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const session = createSession({ model, send, samples });
    ws.on("message", (data, isBinary) => {
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
    ws.on("close", () => session.close());
    ws.on("error", () => session.close());
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The server has no port."));
        return;
      }
      resolvePromise({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
