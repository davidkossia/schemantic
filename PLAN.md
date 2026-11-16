# Schemantic plan

Schemantic is a 2026 rebuild of NexusAgents, an earlier project of mine whose repository was lost. This file is the build plan. The README describes what exists today.

Revision 2, 2026-11-16. The last section lists what changed from revision 1.

## Goal

A multi-agent system that takes a question plus an image (a circuit schematic or a graph) and helps solve it:

1. A **reader** agent turns the image into structured data.
2. A **person** checks and corrects that data before anything is solved.
3. A **solver** agent reasons over the approved data and calls deterministic tools for the math.
4. A **checker** verifies the answer numerically before it is shown.
5. Every phase streams to the browser over WebSockets.

The project must run and show the work. It does not need to be perfect.

## Architecture

```
browser (React + Tailwind)  <-- WebSocket -->  Node server (ws)
        |                                           |
        |                                     session pipeline
  in-browser transport                 (state machine, no Node APIs)
  (static demo, no server)                          |
                       +----------------------------+--------------------------+
                       |                            |                          |
                  reader agent                 solver agent                 checker
                  (Claude, vision,             (Claude + tools:             (pure code:
                   zod structured output)       solve_circuit, evaluate,     element laws,
                                                graph_query, submit_answer)  units, tolerance)
                                                    |
                                              core/ (no model calls)
                                              schemas, units, validation, MNA,
                                              graph tools, schematic renderer
```

- `src/core` has no model calls and no Node APIs, so it runs on the server, in tests and in the browser. It holds the zod schemas, the unit parser, the structural validator, the modified nodal analysis (MNA) solver, the graph tools, the schematic renderer and the checker. Every number that reaches the user comes from this code.
- `src/pipeline` holds the session state machine. It takes a model client and a transport as arguments. The WebSocket server, the tests and the static demo all run the same session code.
- `src/agents` wraps the Anthropic SDK. The model is `claude-opus-5-5`, set in one place and overridable with `SCHEMANTIC_MODEL`. It also holds a scripted model client that calls no API, for tests and replay mode.
- `src/server` is an HTTP and WebSocket server. One session per socket.
- `web` is the Vite, React and Tailwind client.

### Session states

`idle → reading → awaiting_review → solving → checking → done`

- The server rejects a message that does not fit the current state.
- If the check fails, the solver gets one retry with the checker's report. If the check fails again, the session ends with the answer marked **not verified**, and the UI offers to reopen the review.
- `cancel` works in every state and aborts the model call in flight.

### Message protocol

Client to server: `start` (image, media type, question), `approve` (the edited structure), `retry`, `cancel`.

Server to client: `phase`, `parsed` (structure plus validator warnings), `awaiting_review`, `solving`, `token`, `step` (a tool call and its result), `check` (the checker's report), `done` (answer, verified or not), `error`.

Both directions are zod-validated. The server re-validates the structure in `approve` and never trusts the client's copy.

### Reader output

A circuit is a netlist. Each component has:

| Field | Purpose |
|---|---|
| `id`, `type` | `resistor`, `voltage_source`, `current_source` or `unknown`. `unknown` lets the reader report a symbol it cannot classify instead of guessing. |
| `label` | The text printed next to the symbol, copied as written (`4k7`, `10 mA`). |
| `value`, `unit` | The reader's number in SI units. |
| `a`, `b` | The two nodes. For a voltage source, `a` is the + terminal. A current source pushes current into `a`. |
| `at`, `orientation` | Where the symbol sits in the image (0 to 1 on each axis) and whether it is horizontal or vertical. |
| `uncertain` | An optional note when the reader is unsure. |

The netlist also names the ground node and what the question asks for.

Code parses `label` with the unit parser and compares it with `value`. A mismatch (the label says `4k7`, the value says 47,000) becomes a warning in the review. The validator adds structural warnings: no ground, a floating node, a shorted voltage source, or a matrix that cannot be solved.

A graph is axes (label, unit, range, scale), series as key points, and annotations.

### The review screen

Automatic schematic layout from a bare netlist is a hard problem, so the plan avoids it:

- The original image is shown with a numbered marker on each component, placed from the reader's `at` field. This is the main check: marker 3 sits on a resistor, row 3 says what the reader thinks it is.
- Next to it, the schematic is redrawn from the netlist, with each symbol at its `at` position snapped to a grid and wires routed between terminals that share a node. If positions are missing or collide, a plain ladder layout is used instead.
- The table is editable. Hovering a row highlights its marker and its symbol. Every edit re-runs the validator and redraws the schematic.
- Warnings and `uncertain` notes are highlighted. Approve is blocked while the circuit cannot be solved.

### Solver tools

- `solve_circuit`: runs MNA on the approved netlist. It accepts optional changes (set a component's value, remove a component, zero a source), which is what Thevenin, superposition and design questions need.
- `evaluate`: a `mathjs` expression evaluator.
- `graph_query`: value at x, slope, area under a series, extrema.
- `submit_answer`: the final answer as a typed claim.

Forcing a tool call is rejected on Opus 5.5, so the loop uses automatic tool choice with strict tool schemas, and the prompt tells the solver to finish with `submit_answer`. The loop stops after 12 turns.

### Typed claims and the checker

`submit_answer` takes a claim with a kind: `node_voltage`, `branch_current`, `power`, `equivalent_resistance`, `thevenin`, `component_value_for_condition`, or a graph kind. Each kind has its own check:

- The checker computes the claimed quantity from the approved structure through a separate code path from the solver tools. It applies element laws: Ohm's law per component, current balance (KCL) at every node, and power balance (delivered equals dissipated).
- It compares the claim's value and unit against that result, within 1% for circuits.
- A design claim ("R3 = 2 kΩ gives 5 V at node B") is checked by substituting the value and testing the condition.
- A claim kind the checker does not know is reported as not verified. It is never passed silently.

The MNA solver itself is tested against closed-form answers written by hand, so it is not graded against itself.

### Why the split

- **Vision is the weak link.** A misread resistor value gives a confident, wrong answer. The human check catches it before the solver runs.
- **Models are unreliable at arithmetic.** The solver agent decides what to compute. Code computes it.
- **The checker does not trust the agent.** It works from the approved structure and the claim only.

### Model calls

- Reader: one call with the image and question, structured output through `zodOutputFormat`, effort `high`.
- Solver: a manual tool loop with streaming, so text and tool calls reach the browser as they happen. Thinking blocks are passed back unchanged between turns.
- Both use `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta on `client.beta.messages`, so a safety decline retries on a fallback model. A final `stop_reason` of `refusal` becomes an `error` event.
- Every response's token usage is recorded per session.

To check before writing agent code (M6): that structured output and `fallbacks` work on the same beta call. If they do not, the reader requests JSON with the same schema and validates it with zod itself.

### Limits and safety

- Images: PNG, JPEG or WebP, at most 5 MB. The WebSocket rejects larger payloads.
- Nothing is stored. An upload lives in memory for the session.
- Each session has a token cap. A hosted live server also needs a daily spend cap, an origin check and a passcode, because a public page backed by an API key spends real money.

## Replay mode

Replay mode runs the whole pipeline with no API key:

- The scripted model client returns a recorded reader result that contains one deliberate misread, so the review has something to fix.
- After approval, a scripted solver calls the real `solve_circuit` on whatever you approved and submits the result. The math and the check are real. The explanation text is a template.
- The UI labels the session: "Replay mode. No model is called."
- Once the key exists, `SCHEMANTIC_MODE=record` saves a live session's model responses to `fixtures/`, and the replay sample becomes a recording of a real run.

Because the pipeline has no Node dependencies, replay mode can also run entirely in the browser. That makes a free static demo possible (M9).

## Milestones

Ordered so that everything that runs without a key comes first.

| # | Milestone | Done when | Key needed |
|---|---|---|---|
| M1 | Plan, scaffold, CI | Done | No |
| M2 | Circuit core | Schemas, unit parser, validator, MNA and checker pass unit tests against closed-form answers. The checker rejects corrupted claims (5% off, wrong unit, wrong sign). | No |
| M3 | Schematic renderer and problem set | The renderer draws all 14 circuits. The solver-only eval runs and prints a table. | No |
| M4 | Session pipeline and server | A test client completes the full flow over a real WebSocket in replay mode, including a failed check and a cancel. | No |
| M5 | UI | Upload, marker overlay, editable table, redrawn schematic, streamed steps and the check report work in replay mode, checked in a browser at phone and desktop widths. README has a screenshot. | No |
| M6 | Reader and solver agents | The tool loop passes tests against a fake client. One live run completes on a sample image. | Live run only |
| M7 | Graphs | Graph schema, `graph_query`, graph review (editable points, replot) and 4 graph problems. | Live run only |
| M8 | Live eval | Parse and final-answer accuracy measured and in the README, with token counts and cost. Replay sample re-recorded from a live run. | Yes |
| M9 | Hosting | Static replay demo on GitHub Pages (free). A live server is optional and needs your yes. | No for the static demo |

Schemantic is showable after M5: it runs locally on the sample problems in replay mode. The feat log and the portfolio card update then, and say plainly that the live model path is not measured yet.

## Eval design

- **Set:** 18 problems.
  - 8 circuits answered by one solve: dividers, series and parallel networks, a ladder, a bridge, a circuit with a current source. Questions ask for a node voltage, a branch current or a power.
  - 6 circuits that need more than one solve: a Thevenin equivalent, maximum power transfer, the resistor value that gives a target voltage, one source's contribution by superposition, equivalent resistance, and a comparison of two branch powers. These show the solver agent doing more than one tool call.
  - 4 graphs: value at x, slope, area, maximum. The series are piecewise-linear through grid points, so the known answers are exact.
- **Images:** generated by `eval/render.ts` from each problem's ground truth, drawn as SVG and rasterized to PNG. No third-party images, so there is no licence to track. Drawing style varies across problems: zigzag and box resistor symbols, label formats (`4.7 kΩ`, `4k7`, `4700 Ω`), and rotated components.
- **Known answers:** each problem file holds a closed-form formula written by hand.
- **Metrics:**
  - *Parse accuracy:* the share of ground-truth components the reader returns with the right type, value and connections. Node names are arbitrary, so scoring finds the node mapping that matches the most components before counting. Source polarity counts. Reported with precision, so extra components count against it. For graphs: the share of key points within 2% of the axis range.
  - *Final-answer accuracy:* the share of problems within 1% of the known answer (5% for graphs), with the reader's output approved unedited.
  - *Solver-only accuracy:* the same, with the ground-truth structure fed in. The gap between this and final-answer accuracy is what the human review is worth.
  - *Checker:* the share of deliberately corrupted claims it rejects. Runs without a key.
- **Samples:** one run per problem by default, and `--samples 3` for a steadier number. The README states the sample count next to the results, because model output varies between runs.
- **Spend guard:** the live eval prints its cost estimate and does not start without `--yes`. `--max-usd` stops it at a ceiling. It reports measured tokens and cost at the end.
- **Limits:** generated images are cleaner than photos. The numbers show the pipeline works on clean drawings. They do not predict accuracy on hand-drawn or photographed circuits. A few photographed problems can be added later as a separate, clearly labelled row.

## Costs (estimates)

Opus 5.5 lists at $4 per million input tokens and $20 per million output tokens. A reader call is about 3,000 input and 4,000 output tokens. A solver run is 3 to 8 turns. That puts one problem at roughly $0.15 to $0.35 and the full 18-problem eval at roughly $3 to $6 per sample. The first measured run replaces these estimates.

## What needs David

| Item | Needed for | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` in `.env` | M6 live run, M7 live run, M8 | Needed. Never paste it in chat. |
| A yes to spend about $3 to $6 of API credit | The M8 eval run | Needed before M8. |
| A yes to host a live server | A public demo that calls the model | Optional. Costs money for hosting and for API use. |

M2 to M5 need nothing from you.

## Risks

| Risk | Plan |
|---|---|
| The redrawn schematic looks messy for unusual layouts | The marker overlay on the original image is the main check. The redraw is secondary, with a ladder-layout fallback. |
| Structured output and `fallbacks` may not combine on one call | Checked at the start of M6. The fallback is plain JSON validated with zod. |
| Clean generated images inflate parse accuracy | Vary drawing styles. State the limit next to the number. |
| The scripted replay solver could be mistaken for a model run | Label it in the UI and the README. Replace it with a recorded live run at M8. |

## Out of scope

AC analysis, capacitors and inductors in transient mode, dependent sources, hand-drawn or photographed input in the main eval, multi-image problems, accounts, and storage of user uploads.

## Changes in revision 2

1. **Build order.** Everything that runs without a key now comes first (core, renderer, server, UI), and the agents come after. Revision 1 started with the reader, which cannot be verified without a key.
2. **Review screen.** The reader now returns each component's position. The review shows numbered markers on the original image and draws the schematic from those positions. Revision 1 assumed a schematic could be laid out from the netlist alone.
3. **Label cross-check.** The reader returns the printed label as well as the number, and code compares them.
4. **Typed claims.** The solver submits a typed claim and the checker has one check per kind, through a code path separate from the solver tools. Revision 1 had the checker re-run the same solver.
5. **Failed checks.** One retry, then a visible "not verified" result. Revision 1 did not say what happens.
6. **Multi-step problems.** Six eval circuits need more than one solve, so the solver agent is tested on planning and not only on one tool call.
7. **Parse scoring.** Scoring matches netlists up to node renaming. A name-by-name comparison would mark a correct reading wrong.
8. **Replay mode.** The math and the check run for real on the netlist you approve, and only the model is scripted. Revision 1 replayed a fixed list of events, which would ignore your edits.
9. **One pipeline, three hosts.** The session code runs on the server, in tests and in the browser, which allows a free static demo.
10. **Spend guard and a new yes.** The live eval spends your API credit, so it needs your yes and has a cost ceiling.
11. **Graphs moved later.** Graphs get their own milestone after the circuit path works end to end.
