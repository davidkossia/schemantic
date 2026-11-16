# Schemantic

Schemantic reads a photo of a circuit or a graph, turns it into structured data you can check and correct, and has a team of agents solve the problem with you, step by step.

Schemantic is a 2026 rebuild of NexusAgents, an earlier project of mine whose repository was lost.

## What it does

1. You upload an image of a DC circuit or a graph and type a question.
2. A **reader** agent (Claude with vision) converts the image into a typed structure: a netlist for a circuit, or axes, series and annotations for a graph.
3. You see the structure as an editable table and as a schematic redrawn from it. You fix any misread and approve it.
4. A **solver** agent (Claude with tools) plans the solution. Deterministic code does the math: modified nodal analysis for circuits, interpolation and integration for graphs.
5. A **checker** re-solves the problem independently and compares the numbers. It checks KCL residuals (current balance at every node) and units before the answer appears.
6. Every phase and token streams to the browser over WebSockets.

## Status

Rebuild in progress. See [PLAN.md](PLAN.md) for milestones, architecture, the eval design, costs and what needs an API key.

## Stack

TypeScript end to end. Node with `ws` on the server. React, Tailwind and Vite on the client. The official `@anthropic-ai/sdk` with `claude-opus-5-5`, zod for structured outputs, and `mathjs` for the linear solve and expressions.

## License

MIT
