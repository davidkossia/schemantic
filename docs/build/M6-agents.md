# M6: reader, solver loop and live wiring (WP-23 to WP-25)

Read [README.md](README.md) first.

## Facts about the API, checked against the installed SDK

These were confirmed against `@anthropic-ai/sdk` 1.8.0 in `node_modules` and its documentation when this file was written. Confirm each one again by type-checking your code. If one is wrong, report it and do not guess a replacement.

| Fact | Detail |
|---|---|
| Model | `claude-opus-5-5`. Thinking is always on. Do not send a `thinking` parameter or a thinking budget. |
| Effort | `output_config: { effort: "high" }`. The default on this model is `medium`. |
| Fallbacks | `fallbacks: "default"` with `betas: ["server-side-fallback-2026-07-01"]`, on `client.beta.messages`. The type is `BetaFallbacksParam = Array<…> \| "default"`. |
| Structured output | `client.beta.messages.parse(…)` with `output_config: { format: betaZodOutputFormat(schema) }` from `@anthropic-ai/sdk/helpers/beta/zod`. The result has `parsed_output`, which is null when parsing failed. |
| Schema limits | No recursion, no numeric or string length limits, and every object needs `additionalProperties: false`. The root must be an object. |
| Tool choice | Forcing a tool (`any` or a named tool) returns a 400 on this model. Use the default automatic choice, and `strict: true` on each tool. |
| Streaming | `client.beta.messages.stream(…)` returns a stream with `.on("text", …)` and `.finalMessage()`. |
| Tool loop | Append the assistant's `content` to `messages` unchanged, including thinking blocks. Then append one user message that holds a `tool_result` block for every `tool_use` block. |
| Stop reasons | `end_turn`, `tool_use`, `max_tokens`, `pause_turn`, `refusal`. |
| Usage | `response.usage.input_tokens` and `response.usage.output_tokens`. |

Whether the server accepts `fallbacks` together with a structured output format can only be confirmed with a live call. WP-25 confirms it. If the API rejects the pair, the reader drops `output_config.format`, asks for JSON in the prompt, and parses the text with the same zod schema.

---

## WP-23: Reader agent

**Goal.** Turn an image and a question into a `Structure`.

**Read.** CONTRACTS.md sections 1, 2 and 5. The fact table in this file.

**Files.**
- `src/agents/client.ts` (replace the placeholder)
- `src/agents/reader.ts` (replace the placeholder)
- `src/agents/prompts.ts` (new)
- `test/reader.test.ts` (new)

**Spec.**

`src/agents/client.ts`:
- `MODEL`: `process.env.SCHEMANTIC_MODEL ?? "claude-opus-5-5"`.
- `BETAS`: `["server-side-fallback-2026-07-01"]`.
- `baseParams()`: returns `{ model: MODEL, betas: BETAS, fallbacks: "default" as const }`.
- `createAnthropic()`: returns `new Anthropic()`. The SDK reads `ANTHROPIC_API_KEY` from the environment. Never pass, print or log the key.
- `type MessagesApi = Pick<Anthropic["beta"]["messages"], "parse" | "stream">`. The reader and the solver take this type, so tests can pass a fake.
- `toModelError(e, fallbackCode)`: maps an abort to `ModelError("cancelled")`, and any SDK error to `ModelError(fallbackCode)` with a message that holds the HTTP status and the error type only.
- `usageOf(message): Usage`.

`src/agents/reader.ts`:

```ts
export const ReaderOutput = z.object({ structure: Structure });
export function readStructure(api: MessagesApi, input: ReadInput): Promise<ReadOutput>;
```

1. `input.image` null throws `ModelError("read_failed")`.
2. Make one `parse` call: `baseParams()`, `max_tokens: 16000`, the system prompt `READER_SYSTEM`, one user message with the image block (base64 source and media type) followed by the question text, and `output_config: { effort: "high", format: betaZodOutputFormat(ReaderOutput) }`. Pass `{ signal: input.signal }` as the request options.
3. A `stop_reason` of `refusal` throws `ModelError("refused")`.
4. If `parsed_output` is null, or `stop_reason` is `max_tokens`, make the call once more. A second failure throws `ModelError("read_failed")`. The usage counts both calls.
5. Return `parsed_output.structure` and the usage.

`READER_SYSTEM` in `src/agents/prompts.ts` is written for a careful model, in plain prose, without capital-letter emphasis. It must say:
- The task: transcribe the image into the schema. Do not solve the problem.
- How to decide `kind`: a schematic is a `circuit`; a plot of data on axes is a `graph`.
- For a circuit:
  - One entry per drawn component. `id` is the printed designator. If none is printed, use `R1`, `V1`, `I1` in reading order.
  - `label` is the value text exactly as printed. `value` is that quantity in SI base units.
  - Nodes: every set of terminals joined by wire is one node. Use the printed node name where there is one, otherwise `n1`, `n2`. Name the ground node `gnd` when a ground symbol is drawn. With no ground symbol, choose the node at the negative terminal of the first source and say so in `notes`.
  - Terminal order: for a voltage source, `a` is the + terminal. For a current source, `a` is the node the arrow points at. For a resistor, either order.
  - `pa` and `pb`: where each terminal is in the image, as fractions from the top-left corner.
  - A symbol that is not a resistor, a DC voltage source or a DC current source gets `type: "unknown"`.
  - `uncertain`: a short note when a value or a connection is hard to read. Otherwise null. Do not guess silently.
- For a graph: the axis labels, units and ranges; each series as its key points (the corners of a line, or one point per bar), in order of `x`; values read to the nearest gridline fraction.
- `asked.summary` restates the question. `asked.target` names the node or component it is about, when there is one.

**Tests.** Use a fake `MessagesApi` whose `parse` returns scripted messages and records its arguments.
- A good response returns the structure and the usage.
- The call's arguments include the model, both fallback fields, `effort: "high"`, a `format`, an image block with the media type from the input, and the question text.
- A `refusal` rejects with code `refused`.
- `parsed_output` null, then a good response: resolves, and `parse` ran twice. The usage is the sum.
- `parsed_output` null twice: rejects with code `read_failed`.
- The fake throwing an abort error rejects with code `cancelled`.
- The fake throwing an error whose message contains `sk-ant-secret` rejects with a `ModelError` whose message does not contain that string.
- `image: null` rejects with `read_failed` and makes no call.
- `z.toJSONSchema(ReaderOutput)` has an object at its root and contains no `minimum`, `maximum`, `minLength` or `maxLength` key anywhere.

**Done when.** The tests pass with no API key set.

---

## WP-24: Solver agent loop

**Goal.** Run the tool loop until the solver submits a claim.

**Read.** CONTRACTS.md sections 4 and 5. The fact table in this file.

**Files.**
- `src/agents/solver.ts` (replace the placeholder)
- `src/agents/prompts.ts` (add `SOLVER_SYSTEM`)
- `test/solver.test.ts` (new)

**Spec.**

```ts
export function solveWithTools(api: MessagesApi, input: SolveInput, limits?: { maxTurns: number }): Promise<SolveOutput>;
```

1. Tool definitions: one per entry of `TOOL_SPECS`, as `{ name, description, input_schema: z.toJSONSchema(spec.input), strict: true }`.
2. The first user message holds: the question; the approved structure as JSON; and, when `input.feedback` is set, a paragraph that says the previous answer failed the check, followed by the report's `notes` and items.
3. Each turn calls `api.stream` with `baseParams()`, `max_tokens: 16000`, `SOLVER_SYSTEM`, the tools, the messages so far, `output_config: { effort: "high" }`, and the signal. Forward each text delta as a `token` event. Then await `finalMessage()`.
4. Add the turn's usage to the total.
5. Handle the stop reason:
   - `refusal`: throw `ModelError("refused")`.
   - `max_tokens`: throw `ModelError("solve_failed")`.
   - `pause_turn`: append the assistant content and call again.
   - `tool_use`: append the assistant's `content` unchanged. For each `tool_use` block, in order, call `input.tools.run(name, block.input)` and emit a `step` event. Append one user message with a `tool_result` for each block: `content` is the output as a JSON string, and `is_error` is true when `ok` is false. Then, if `input.tools.claim()` is not null, stop the loop.
   - `end_turn` with no claim yet: append the assistant content and one user message, "Finish by calling submit_answer with your claim." Do this once. A second `end_turn` without a claim ends the loop.
6. Stop after `limits.maxTurns` turns (default `LIMITS.maxSolveTurns`).
7. Return the claim from `input.tools.claim()` or null. `text` is the claim's explanation when there is a claim, otherwise the text streamed so far.
8. Errors go through `toModelError(e, "solve_failed")`.

`SOLVER_SYSTEM` must say:
- The role: explain to a student how to solve the problem, using the approved structure as the only source of facts about the circuit or graph.
- Get every number from a tool. Do not do arithmetic in prose.
- The sign conventions for `current` and `power`, and that all values are in SI base units.
- How to use `solve_circuit` changes for a Thevenin equivalent, superposition, and finding a component value.
- Keep the explanation short: what you computed, in order, and why.
- Finish with exactly one `submit_answer` call. Choose the claim kind that matches the question. Put the explanation in the `explanation` field.
- If feedback from a failed check is present, find the mistake before answering again.

**Tests.** Use a fake `MessagesApi` whose `stream` returns scripted turns. Each fake stream supports `.on("text", …)` and `.finalMessage()`.
- Two turns (a `solve_circuit` call, then `submit_answer`) on `c01`: returns the claim; two `step` events in order; the second request's messages hold the first assistant content unchanged, including a thinking block, and a `tool_result` for the call.
- Text deltas arrive as `token` events in order.
- One turn with two `tool_use` blocks: both run, and one user message carries two `tool_result` blocks in the same order.
- A tool call with bad input: the `tool_result` has `is_error: true`, and the loop continues.
- `end_turn` without a claim: one nudge message is added. A second `end_turn` returns `claim: null`.
- The loop stops at `maxTurns: 3` when the model keeps calling `evaluate`, and returns `claim: null`.
- `refusal` rejects with code `refused`. `max_tokens` rejects with `solve_failed`.
- With `feedback` set, the first user message contains the report's notes.
- Every request includes the model, both fallback fields, `strict: true` on all four tools, and no `tool_choice` and no `thinking` key.
- The usage is the sum over turns.
- An aborted signal rejects with code `cancelled`.

**Done when.** The tests pass with no API key set.

---

## WP-25: Live wiring and smoke run

**Goal.** Connect the agents to the server, and prove one live session works.

**Needs the API key** in `.env` for the smoke run. Build and test steps 1 to 3 without it.

**Files.**
- `src/agents/live.ts` (new)
- `src/server/index.ts` (replace the live-mode branch)
- `eval/smoke.ts` (new)
- `eval/cost.ts` (new)
- `package.json`: add the script `"smoke": "tsx eval/smoke.ts"`
- `test/live.test.ts` (new)
- `README.md` ("Run it" section)

**Spec.**
1. `createLiveClient(api: MessagesApi, options: { loadSampleImage(id: string): Promise<ImageInput | null> }): ModelClient` with `mode: "live"`. `read` calls `readStructure`. When `input.image` is null and `input.sampleId` is set, it first loads the image with `loadSampleImage`, and a null result throws `ModelError("read_failed")`. `solve` calls `solveWithTools`.
2. `src/server/index.ts` in live mode uses `createLiveClient(createAnthropic().beta.messages, …)`, with a `loadSampleImage` that reads `web/public/samples/<id>.png` for the ids in the samples list only. If the mode is `live` and the key is missing, exit with: "Set ANTHROPIC_API_KEY in .env, or run with SCHEMANTIC_MODE=replay." In live mode the `samples` list still holds the two samples.
3. `eval/cost.ts`: `PRICE_PER_MTOK = { input: 4, output: 20 }` and `costUsd(usage): number`.
4. `eval/smoke.ts <problemId>` (default `c01`): loads the problem and its PNG, runs a session through `createSession` with the live client, approves the reader's output unedited, prints each message type as it arrives, then prints the reading's `scoreNetlist` result, the final claim, whether it was verified, the token usage and the cost in dollars. It exits with code 1 when the session ends in an error.
5. The smoke run costs about $0.25. It needs no further approval once the key is in place.

**Tests** (no key):
- `createLiveClient` with a fake API passes `read` and `solve` through and reports `mode: "live"`.
- `costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })` is 24.
- A session with the live client over a fake API reaches `done`.

**Done when.**
- The tests pass.
- `npm run smoke` completes on `c01` and on `c09`, and you report for each: the parse score, the claim, verified or not, tokens and cost.
- You report whether the API accepted `fallbacks` together with the structured output format. If it did not, apply the fallback described under the fact table and note it in PLAN.md's risk table.
- A live session works in the browser with an uploaded copy of `eval/images/c05.png`.
