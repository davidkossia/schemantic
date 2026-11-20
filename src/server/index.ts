/**
 * Server entry point. Reads the environment and starts the HTTP and WebSocket server.
 */
import { ROOT } from "./env";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createScriptedClient } from "../agents/scripted";
import { REPLAY_FIXTURES } from "../../fixtures/replay";
import { startServer } from "./app";

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 8787;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("PORT must be a whole number from 0 to 65535.");
    process.exit(1);
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort(process.env["PORT"]);
  const keySet = (process.env["ANTHROPIC_API_KEY"] ?? "").trim() !== "";
  const requested = process.env["SCHEMANTIC_MODE"];
  if (requested !== undefined && requested !== "" && requested !== "live" && requested !== "replay") {
    console.error('SCHEMANTIC_MODE must be "live" or "replay".');
    process.exit(1);
  }
  const mode = requested === "live" || requested === "replay" ? requested : keySet ? "live" : "replay";
  const origins = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
  const allowedOrigins = origins.length > 0 ? origins : null;

  if (mode === "live") {
    // Every live session spends model tokens, so only listed origins may connect.
    if (allowedOrigins === null) {
      console.error("Live mode needs ALLOWED_ORIGINS, a comma-separated list of the origins that may connect.");
      process.exit(1);
    }
    console.error("Live mode arrives in WP-25.");
    process.exit(1);
  }
  const model = createScriptedClient({ fixtures: REPLAY_FIXTURES, tokenDelayMs: 15 });

  const dist = resolve(ROOT, "web/dist");
  const server = await startServer({
    port,
    model,
    samples: REPLAY_FIXTURES.map((f) => f.sample),
    staticDir: existsSync(dist) ? dist : null,
    allowedOrigins,
  });
  console.log(`schemantic server listening on port ${server.port} in ${mode} mode`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "The server failed to start.");
  process.exit(1);
});
