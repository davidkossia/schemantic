/**
 * Resolves the repository root from this file, not from the folder the server was started in, and
 * loads `<root>/.env`. Imported first by index.ts, so the environment is set before any other module
 * reads it at import time.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

config({ path: resolve(ROOT, ".env"), quiet: true });
