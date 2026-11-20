# M4: protocol, scripted client, session and server (WP-13 to WP-16)

Read [README.md](README.md) first.

---

## WP-13: Message protocol

**Goal.** The WebSocket messages as zod schemas.

**Read.** CONTRACTS.md sections 5, 6 and 7.

**Files.**
- `src/shared/protocol.ts` (replace the placeholder)
- `src/shared/limits.ts` (new)
- `src/pipeline/model.ts` (new)
- `test/protocol.test.ts` (new)

**Spec.**
1. `src/shared/limits.ts`: copy `LIMITS` from CONTRACTS.md section 7.
2. `src/pipeline/model.ts`: copy section 5 exactly. `ImageInput` and `Usage` are zod schemas here, because the protocol reuses them. `ToolRunner` and `ToolOutput` are imported as types from `../core/tools`. If WP-07 is not merged yet, declare the two types in `src/core/tools.ts` exactly as in CONTRACTS.md section 4 and leave the rest of that file alone.
3. `src/shared/protocol.ts`: `ClientMessage` and `ServerMessage` as discriminated unions on `type`, with the fields from section 6. Export `Sample`, `ErrorCode`, `SessionState`, and the two parse functions.
4. `start` validation: `question` is 1 to `LIMITS.maxQuestionChars` characters after trimming, and exactly one of `image` and `sampleId` is non-null. Use `.refine` for the second rule.
5. The parse functions return `err("…")` for text that is not JSON, and for JSON that does not match. They never throw.
6. `step.input` is `z.unknown()`. `step.output` is an object with a boolean `ok` that allows other keys.

**Tests.**
- A valid message of each client type and each server type parses.
- `start` with both `image` and `sampleId` set fails. With neither set it fails. With an empty question it fails. With a question of 1001 characters it fails.
- `approve` with a structure that has a component missing `b` fails.
- `parseClientMessage("not json")` and `parseClientMessage("{\"type\":\"nope\"}")` return errors.
- A `done` message with `claim: null` parses.

**Done when.** The tests pass.

---

## WP-14: Scripted client and replay fixtures

**Goal.** A model client that calls no API, plus the two replay samples.

**Serial.** This package edits `tsconfig.json`.

**Read.** CONTRACTS.md sections 2, 4 and 5. PROBLEMS.md ("Replay samples").

**Files.**
- `src/core/describe.ts` (new)
- `src/agents/scripted.ts` (replace the placeholder)
- `fixtures/replay/c01.ts`, `fixtures/replay/c09.ts`, `fixtures/replay/index.ts` (new)
- `tsconfig.json`: add `"fixtures"` to `include`
- `test/describe.test.ts`, `test/scripted.test.ts` (new)
- Delete `fixtures/.gitkeep`.

**Spec.**

`describeClaim(claim): string` in `src/core/describe.ts`, using `formatQuantity`:

| Kind | Output |
|---|---|
| `node_voltage` | `V(B) = 8 V` |
| `branch_current` | `I(R2) = 20 mA` |
| `power`, absorbed | `P(R2) = 250 mW` |
| `power`, delivered | `P delivered by V1 = 53.33 mW` |
| `equivalent_resistance` | `R(A, gnd) = 4 kΩ` |
| `thevenin` | `Vth = 9 V, Rth = 4 kΩ` |
| `max_power_transfer` | `RL = 2 kΩ, P = 5.556 mW` |
| `component_value_for_condition` | `R2 = 30 kΩ` |
| `graph_value` | `y(4) = 8` |
| `graph_slope` | `slope = -2` |
| `graph_area` | `area = 36` |
| `graph_extremum` | `max = 31 at x = 4` |

Fixtures:

```ts
export type ReplayFixture = { sample: Sample; reading: Structure; query: Query };
```

- `sample.imageUrl` is `samples/c01.png` and `samples/c09.png` (relative, no leading slash).
- `reading` is the problem's `truth` from `eval/problems`, with the one misread from PROBLEMS.md applied. Build it in code from the problem file so the positions stay in sync. Do not paste a copy.
- `query` is `queryOf(problem.expected)`.
- `fixtures/replay/index.ts` exports `REPLAY_FIXTURES: ReplayFixture[]`.
- These files and the problem files they import must not use Node APIs.

`createScriptedClient(options: { fixtures: ReplayFixture[]; tokenDelayMs?: number }): ModelClient`:
- `mode` is `"replay"`.
- `read`: find the fixture by `sampleId`. No match, or `sampleId` null, throws `ModelError("read_failed", …)`. Return a deep copy of `reading` and a usage of zeros.
- `solve`: find the fixture's `query`, then run the procedure for its kind. Every `tools.run` call is followed by an `onEvent({ type: "step", … })`.

| Query kind | Procedure |
|---|---|
| `node_voltage`, `branch_current`, `power` | One `solve_circuit` with a `remove` change per id in `setup.remove` and a `zero` change per id in `setup.zero`. Read the value. |
| `equivalent_resistance` | One `solve_circuit` with: a `remove` per id in `remove`; a `zero` for every source left in the approved structure; an `add` of a 1 A `current_source` with id `Itest`, `a` and `b` from the query. The value is `V(a) − V(b)`. |
| `thevenin` | First a `solve_circuit` with the removes, for `vth = V(a) − V(b)`. Then the `equivalent_resistance` procedure, for `rth`. |
| any other | No tool calls. `claim: null`. Text: "Replay mode cannot answer this kind of question. Run with an API key to use the live solver." |

- After the procedure, call `submit_answer` with the claim and an explanation, then emit the explanation as `token` events, one per word with a trailing space. Wait `tokenDelayMs` (default 0) between tokens.
- The explanation is two or three template sentences that name the tool calls made and end with `describeClaim(claim)`.
- If any tool returns `ok: false`, stop and return `claim: null` with a text that includes the error.
- Check `signal.aborted` before each tool call and each token. If set, throw `ModelError("cancelled", …)`.
- The usage is zeros.

**Tests.**
- `describeClaim`: every row of the table.
- `read("c01")` returns a structure in which R2 has value 20000, and `validate` on it gives one `label_mismatch`.
- `read` twice returns equal but distinct objects (changing one does not change the other).
- `read` with an unknown `sampleId` rejects with a `ModelError` of code `read_failed`.
- `solve` for `c01` on the corrected structure (R2 set to 2000): the claim's value is 8, there are two step events (`solve_circuit`, `submit_answer`), and `checkClaim` verifies the claim.
- `solve` for `c01` on the uncorrected reading: the claim's value is 12 × 20000 / 21000, and `checkClaim` against that same structure verifies it. The checker checks the answer against what was approved, not against the image.
- `solve` for `c09` on the corrected structure: vth 9, rth 4000, and exactly three step events in this order: `solve_circuit`, `solve_circuit`, `submit_answer`.
- `solve` after the user deleted the node the query names: `claim` is null and the text contains the tool's error.
- `solve` with an already-aborted signal rejects with code `cancelled`.

**Done when.** The tests pass and the check chain passes with `fixtures` in `tsconfig.json`.

---

## WP-15: Session state machine

**Goal.** The one piece of code that runs a session from start to done. The server, the tests and the in-browser demo all use it.

**Read.** CONTRACTS.md sections 5, 6 and 7. PLAN.md ("Session states").

**Files.**
- `src/pipeline/session.ts` (replace the placeholder)
- `test/fakeModel.ts` (new)
- `test/session.test.ts` (new)

**Spec.**

```ts
export type SessionDeps = {
  model: ModelClient;
  send: (message: ServerMessage) => void;
  samples: Sample[];
  limits?: Partial<typeof LIMITS>;
};
export type Session = { receive(raw: string): void; close(): void; state(): SessionState };
export function createSession(deps: SessionDeps): Session;
```

On creation, send `hello` with `deps.model.mode` and `deps.samples`.

`receive(raw)` parses with `parseClientMessage`. A parse failure sends `error` with code `bad_message` and changes nothing. A message that is not valid in the current state (see CONTRACTS.md section 6) sends `error` with code `bad_state` and changes nothing.

| Message | Behaviour |
|---|---|
| `start` | Check the image: decoded size over `maxImageBytes` gives `image_too_large`. In replay mode, an `image` gives `unsupported_image` with the message "Replay mode reads only the sample problems." A `sampleId` that is not in `deps.samples` gives `bad_message`. A session token total at or above `maxSessionTokens` gives `limit_reached`. Otherwise clear the earlier run's data (not the session token total), go to `reading`, send `reading`, and call `model.read`. On success, run `validate`, go to `awaiting_review`, and send `parsed` then `awaiting_review`. |
| `approve` | Run `validate` on the received structure. If `canSolve` is false, or a circuit has more than `maxComponents` components, send `error` with code `cannot_solve` and stay in `awaiting_review`. Otherwise store the structure as the approved one and run solve attempt 1. |
| `reopen` | Needs an approved structure, otherwise `bad_state`. Go to `awaiting_review`. Send `parsed` with the approved structure and its warnings, then `awaiting_review`. |
| `cancel` | In `idle`, do nothing. Otherwise abort the call in flight, go to `idle`, and send `error` with code `cancelled`. |

**Solve attempt n:**
1. If the session token total is at or above `maxSessionTokens`, send `error` with code `limit_reached` and go to `idle`.
2. Go to `solving`. Send `solving` with `attempt: n`.
3. Create a fresh `createToolRunner(approved)`. Call `model.solve` with `feedback` set to the previous `CheckReport` on attempt 2, and null on attempt 1, and `tokenBudget` set to `maxSessionTokens` minus the session token total.
4. Forward each `SolveEvent`: `token` as `token`; `step` as `step` with an `index` that starts at 0 for the session's first step and keeps counting across attempts.
5. If the returned `claim` is null: go to `done` and send `done` with `verified: false`.
6. Otherwise go to `checking`, send `checking`, run `checkClaim(approved, claim)`, and send `check` with the report and the attempt.
7. If the report is verified: go to `done`, send `done` with `verified: true`.
8. If it is not verified and `n` is 1: run attempt 2.
9. If it is not verified and `n` is 2: go to `done`, send `done` with `verified: false`.

**Rules that hold everywhere:**
- `usage` in `done` is the sum of this run's read and every solve.
- The session token total is the usage of every model call since the session was created. It never resets. Each call's usage is added when the call settles: the output's `usage` on success, the `ModelError`'s `usage` on failure. Calls whose result is ignored (cancel, close, a new `start`, a timeout) still count.
- Each model call gets an `AbortSignal`. `read` times out after `readTimeoutMs` and `solve` after `solveTimeoutMs`. A timeout is handled as the model error `read_failed` or `solve_failed`.
- A `ModelError` sends `error` with its code and goes to `idle`. Any other thrown value sends `error` with code `internal` and the message "Something went wrong.", and goes to `idle`. Never send a stack trace or a raw error message from an unknown error.
- A result that arrives after `cancel`, `close` or a new `start` is ignored. Keep a run counter and compare it when a promise settles.
- After `close()`, `send` is never called again.
- `send` is called synchronously in the order of the steps given here.

`test/fakeModel.ts` exports `createFakeModel(script)`, a `ModelClient` whose `read` and `solve` results are set by the test. It supports: a result returned at once, a result held until the test releases it, a thrown `ModelError`, a thrown plain `Error`, and a list of solve results used in order (for the retry).

**Tests.** Each test collects the sent messages and asserts the exact sequence of `type` values.
1. Happy path with the scripted client and `c01`: `hello`, `reading`, `parsed`, `awaiting_review`; then `approve` with R2 fixed gives `solving`, `step`, `step`, tokens, `checking`, `check`, `done` with `verified: true`. Allow any number of `token` messages, and assert the rest in order.
2. `approve` in `idle` gives `bad_state`. `start` during `reading` gives `bad_state`.
3. `approve` with a structure that has no ground gives `cannot_solve` and the state stays `awaiting_review`.
4. A first solve that returns a wrong claim and a second that returns the right one: two `solving` messages with attempts 1 and 2, two `check` messages, and `done` with `verified: true`. The second `solve` call received the first report as `feedback`.
5. Two wrong claims: `done` with `verified: false`, and no third attempt.
6. A solve that returns `claim: null`: `done` with `verified: false` and no `checking`.
7. `reopen` after `done`: `parsed` and `awaiting_review` with the approved structure. `reopen` before any approval gives `bad_state`.
8. `cancel` during a held `read`: `error` with code `cancelled`, state `idle`. Releasing the held result afterwards sends nothing more.
9. `cancel` during a held `solve`: the same, and the fake saw its signal aborted.
10. A `read` that throws `ModelError("refused", …)` sends `error` with code `refused`. A `read` that throws `new Error("secret detail")` sends code `internal`, and the message does not contain `secret detail`.
11. `start` with an image in replay mode gives `unsupported_image`. An image over the size limit, with a small `maxImageBytes` passed in `limits`, gives `image_too_large`.
12. Step indices across two attempts are 0, 1, 2, 3.
13. A token budget of 10 passed in `limits`, with a fake read that reports usage of 10 tokens: `approve` gives `limit_reached`.
14. After `close()`, releasing a held result sends nothing.
15. `start` from `done` runs a second full session and the step index starts at 0 again.
16. The token total spans `start`s: the second run's solve gets the budget left after both runs' reads and the first solve, and a `start` once the total is spent gives `limit_reached` with no read.
17. A solve that throws a `ModelError` with usage adds that usage to the total.
18. A held solve released after `cancel` still adds its usage to the total.

**Done when.** The tests pass and the file imports no Node built-in.

---

## WP-16: WebSocket server

**Goal.** Serve the client and run one session per socket.

**Read.** CONTRACTS.md sections 6 and 7.

**Files.**
- `src/server/app.ts` (new)
- `src/server/index.ts` (replace the placeholder)
- `test/server.test.ts` (new)

**Spec.**

```ts
export type ServerOptions = { port: number; model: ModelClient; samples: Sample[]; staticDir: string | null; allowedOrigins: string[] | null };
export function startServer(options: ServerOptions): Promise<{ port: number; close(): Promise<void> }>;
```

1. An `http` server plus a `ws` `WebSocketServer` on the path `/ws`, with `maxPayload: LIMITS.maxFrameBytes`.
2. `GET /healthz` returns 200 and `ok`.
3. If `staticDir` is set, serve files from it. `/` serves `index.html`. Resolve the requested path and refuse anything outside `staticDir` with a 404. Set a content type for `.html`, `.js`, `.css`, `.png`, `.svg` and `.json`. Unknown paths return 404.
4. If `allowedOrigins` is set, refuse a WebSocket upgrade whose `Origin` header is not in the list, with a 403. If it is null, accept every origin.
5. Each connection gets `createSession` with `send` writing `JSON.stringify(message)` when the socket is open. A text frame goes to `session.receive`. A binary frame sends `error` with code `bad_message`. On close or error, call `session.close()`.
6. `close()` ends every socket and stops the server.
7. `src/server/index.ts` loads `dotenv/config` and reads the environment:
   - `PORT`, default 8787.
   - `SCHEMANTIC_MODE`: `live` or `replay`. The default is `live` when `ANTHROPIC_API_KEY` is set, otherwise `replay`.
   - `ALLOWED_ORIGINS`: a comma-separated list, or unset.
   - In replay mode, use `createScriptedClient` with `REPLAY_FIXTURES` and `tokenDelayMs: 15`.
   - In live mode, exit with the message "Live mode arrives in WP-25." WP-25 replaces this branch.
   - `staticDir` is `web/dist` when that folder exists.
   - Log one line with the port and the mode. Never log the key, images or questions.

**Tests.** Start the server on port 0 with the scripted client, and connect with the `ws` client.
- The first message is `hello` with `mode: "replay"` and two samples.
- A full `c01` session over the socket ends with `done` and `verified: true`.
- A binary frame gets `error` with code `bad_message`, and the socket stays open.
- Two sockets at once each run their own session without mixing messages.
- With `allowedOrigins: ["http://localhost:5173"]`, a connection with another origin fails, and one with that origin succeeds.
- `GET /healthz` returns 200.
- With a temporary static folder, `GET /` returns its `index.html`, and `GET /../package.json` and `GET /%2e%2e/package.json` return 404.
- `close()` resolves and the port stops accepting connections.

**Done when.** The tests pass. `npm run dev:server` starts in replay mode with no `.env` file and logs the port.
