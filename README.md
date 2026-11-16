# Schemantic

Schemantic reads a photo of a circuit or a graph, turns it into structured data you can check and correct, and has a team of agents solve the problem with you, step by step.

Schemantic is a 2026 rebuild of NexusAgents, an earlier project of mine whose repository was lost.

## What it does

1. You upload an image of a DC circuit or a graph and type a question.
2. A **reader** agent (Claude with vision) converts the image into a typed structure: a netlist for a circuit, or axes, series and annotations for a graph.
3. You see the structure as an editable table, as numbered markers on your image, and as a schematic redrawn from it. You fix any misread and approve it.
4. A **solver** agent (Claude with tools) plans the solution. Deterministic code does the math: modified nodal analysis for circuits, interpolation and integration for graphs.
5. A **checker** verifies the answer against the approved data with element laws: Ohm's law, current balance at every node (KCL), power balance and units. An answer that fails is shown as not verified.
6. Every phase and token streams to the browser over WebSockets.

## Status

Rebuild in progress. See [PLAN.md](PLAN.md) for milestones, architecture, the eval design, costs and what needs an API key.

## Stack

TypeScript end to end. Node with `ws` on the server. React, Tailwind and Vite on the client. The official `@anthropic-ai/sdk` with `claude-opus-5-5`, zod for structured outputs, and `mathjs` for the linear solve and expressions.

## License

MIT

## Layout

| Path | Contents |
|---|---|
| `src/core` | Schemas, unit parser, validator, MNA solver, graph tools, schematic renderer, checker. No model calls. |
| `src/pipeline` | Session state machine shared by the server, the tests and the in-browser demo. |
| `src/agents` | Anthropic client, reader agent, solver agent, scripted client for replay. |
| `src/server` | HTTP and WebSocket server. |
| `src/shared` | Message types shared by server and client. |
| `web` | React, Tailwind and Vite client. |
| `eval` | Problem set, image renderer, scoring, eval runner. |
| `fixtures` | Recorded model responses for replay mode. |
| `test` | Vitest tests. |

The folders hold placeholders. The project itself is not built yet.

## Develop

```bash
npm install
npm run typecheck
npm test
npm run build:web
```
