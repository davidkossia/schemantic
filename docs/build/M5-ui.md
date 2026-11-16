# M5: the browser client (WP-17 to WP-22)

Read [README.md](README.md) first.

## Rules for every UI package

- React 19 function components, Tailwind 4 utility classes, no component library, no CSS files besides `web/src/index.css`, no web fonts, no CDN.
- Named exports. One component per file in `web/src/components/`.
- Light and dark mode with Tailwind's `dark:` variants (they follow the system setting).
- One column on a phone (375 px wide). Two columns for the review at 1024 px and up. No horizontal page scroll at any width.
- Text is minimal. No subtitles or helper text unless it changes what the reader does next. Sentence case. No exclamation marks.
- Every input has a label. Every button is a `<button>`. Focus is visible. A status that changes is in an `aria-live="polite"` region.
- Components take props and call callbacks. Only `App.tsx` talks to the session hook.

---

## WP-17: Client state, transport and shell

**Goal.** The client's state logic as a pure reducer, the WebSocket transport, and an app shell that the panel packages fill in.

**Read.** CONTRACTS.md sections 2 and 6.

**Files.**
- `web/src/transport.ts`, `web/src/state.ts`, `web/src/useSession.ts`, `web/src/App.tsx` (new)
- `web/src/main.tsx` (render `App`)
- `web/src/components/StartPanel.tsx`, `ReviewPanel.tsx`, `SolvePanel.tsx`, `CheckReportView.tsx`, `AnswerCard.tsx`, `ModeBadge.tsx` (new stubs)
- `test/web-state.test.ts` (new)

**Spec.**

```ts
// transport.ts
export type Transport = {
  send(message: ClientMessage): void;
  subscribe(listener: (message: ServerMessage) => void): () => void;
  close(): void;
};
export function wsTransport(url: string): Transport;
```

`wsTransport` queues messages sent before the socket opens. It parses each frame with `parseServerMessage` and drops frames that fail. When the socket closes, it delivers `{ type: "error", code: "internal", message: "Connection lost." }` to its listeners.

```ts
// state.ts
export type UiState = {
  connected: boolean;
  mode: "live" | "replay" | null;
  samples: Sample[];
  phase: SessionState;
  question: string;
  imageUrl: string | null;          // what the review shows: a sample URL or an object URL
  structure: Structure | null;      // the editable copy
  warnings: Warning[];
  attempt: 1 | 2 | null;
  steps: { index: number; tool: string; input: unknown; output: ToolOutput }[];
  text: string;                     // tokens of the current attempt
  reports: CheckReport[];
  result: { claim: Claim | null; text: string; verified: boolean; usage: Usage } | null;
  error: { code: ErrorCode; message: string } | null;
};
export type UiAction =
  | { type: "server"; message: ServerMessage }
  | { type: "started"; question: string; imageUrl: string }
  | { type: "edited"; structure: Structure }
  | { type: "dismissed_error" };
export const initialState: UiState;
export function reduce(state: UiState, action: UiAction): UiState;
```

Reducer rules:

| Action | Effect |
|---|---|
| server `hello` | Set `connected`, `mode`, `samples`. |
| `started` | Set `question` and `imageUrl`. Clear `structure`, `warnings`, `steps`, `text`, `reports`, `result`, `error`, `attempt`. |
| server `reading` | `phase: "reading"`. |
| server `parsed` | Set `structure` and `warnings` from the message. |
| server `awaiting_review` | `phase: "awaiting_review"`. Clear `result`. |
| `edited` | Set `structure`. Set `warnings` to `validate(structure)`, computed in the reducer. |
| server `solving` | `phase: "solving"`, set `attempt`, clear `text`. On attempt 1, also clear `steps` and `reports`. |
| server `token` | Append to `text`. |
| server `step` | Append to `steps`. |
| server `checking` | `phase: "checking"`. |
| server `check` | Append the report to `reports`. |
| server `done` | `phase: "done"`, set `result`. |
| server `error` | Set `error`. For `cannot_solve`, `bad_message` and `bad_state`, keep `phase`. For every other code, `phase: "idle"`. For `internal` with the message "Connection lost.", also set `connected: false`. |
| `dismissed_error` | Clear `error`. |

The reducer never mutates its input.

`useSession()` creates the transport once, subscribes, and dispatches. It returns `{ state, start(input), approve(), edit(structure), reopen(), cancel(), dismissError() }`. The WebSocket URL is the page's origin with `http` replaced by `ws`, plus `/ws`. `start` with a file reads it as base64, makes an object URL for the review, and dispatches `started` before sending.

`App.tsx` shows the header (the name "Schemantic" and `ModeBadge`), an error banner when `state.error` is set, and one panel by phase:

| Phase | Panel |
|---|---|
| `idle` | `StartPanel` |
| `reading` | `StartPanel`, disabled, with a "Reading the image" status and a Cancel button |
| `awaiting_review` | `ReviewPanel` |
| `solving`, `checking` | `SolvePanel`, plus `CheckReportView` for each report |
| `done` | `SolvePanel`, the reports, and `AnswerCard` |

Each stub component exports the component with its final props type and renders its own name. The props:

```ts
StartPanel:       { samples: Sample[]; mode: "live" | "replay" | null; busy: boolean; onStart(input: { file: File | null; sampleId: string | null; question: string }): void; onCancel(): void }
ReviewPanel:      { imageUrl: string | null; structure: Structure; warnings: Warning[]; onEdit(s: Structure): void; onApprove(): void; onCancel(): void }
SolvePanel:       { attempt: 1 | 2 | null; steps: UiState["steps"]; text: string; busy: boolean; onCancel(): void }
CheckReportView:  { report: CheckReport; attempt: number }
AnswerCard:       { result: NonNullable<UiState["result"]>; onReopen(): void; onNew(): void }
ModeBadge:        { mode: "live" | "replay" | null; connected: boolean }
```

**Tests** (`test/web-state.test.ts`, plain TypeScript, no DOM):
- One test per row of the reducer table.
- A full message sequence from a `c01` replay session ends in `phase: "done"` with two steps and one report.
- `edited` with a structure whose ground is missing gives a `no_ground` warning in `warnings`.
- The retry: `solving` attempt 2 keeps `steps` and `reports` and clears `text`.
- `reduce` returns a new object and leaves the old state deep-equal to a copy taken before.

**Done when.** The tests pass, `npm run build:web` succeeds, and with the server running in replay mode the page shows the mode badge and the stub panel names as the phase changes.

---

## WP-18: Start panel

**Files.** `web/src/components/StartPanel.tsx`, `web/src/components/ModeBadge.tsx`.

**Spec.**
1. A list of sample problems from `samples`. Each is a button that shows the image thumbnail and the title. Choosing one fills the question field with the sample's question and selects the sample.
2. A file input that accepts PNG, JPEG and WebP. It is disabled in replay mode, with one line next to it: "Uploads need live mode."
3. A question field (a `textarea`, 1,000 characters at most) with the label "Question".
4. A "Read image" button. It is disabled until a sample or a file is chosen and the question is not empty. A file over 5 MB shows "The image is larger than 5 MB." and does not call `onStart`.
5. While `busy`, every control is disabled and a Cancel button shows.
6. `ModeBadge` shows "Live" or "Replay mode. No model is called." It shows "Disconnected" when `connected` is false.

**Done when.** In the browser, in replay mode: choosing a sample and pressing "Read image" moves the app to the review. The panel works with the keyboard alone. No horizontal scroll at 375 px.

---

## WP-19: Review panel

**Goal.** The human check: the image with markers, the editable table, and the warnings.

**Read.** CONTRACTS.md section 2. PLAN.md ("The review screen").

**Files.**
- `web/src/components/ReviewPanel.tsx`
- `web/src/components/ImageMarkers.tsx`, `NetlistTable.tsx`, `WarningsList.tsx`, `SchematicView.tsx` (new)
- `web/src/edit.ts` (new), `test/web-edit.test.ts` (new)

**Spec.**

`web/src/edit.ts` holds pure functions, all returning a new `Circuit`:
- `setField(circuit, id, field, text)` for the fields `type`, `value`, `a`, `b`, `label`.
  - `value`: parse the text with `parseQuantity`. If it parses, set `value`, set `label` to `formatQuantity(value, unitFor(type))`, and set `uncertain` to null. If it does not parse, return the circuit unchanged.
  - `a`, `b`: trim the text. An empty string leaves the circuit unchanged.
  - `type`: set it, and re-format the label for the new unit.
- `addComponent(circuit)`: adds a resistor of 1000 Ω between ground and ground with the first unused id of the form `R1`, `R2`, and null positions.
- `removeComponent(circuit, id)`.
- `setGround(circuit, node)`.

`ImageMarkers`: the image with a numbered circle over each component, at the midpoint of `pa` and `pb`, positioned in percent so it scales with the image. Numbers follow table order, starting at 1. A component without positions gets no marker. The marker of the hovered or focused row is highlighted. With `imageUrl` null, render nothing.

`NetlistTable`: one row per component with the columns #, id, type (a select), value (a text input showing `formatQuantity`, committed on blur or Enter), a, b, and a remove button. Under the table: an "Add component" button and a ground field. A row with a warning shows the warning's message under it. Hovering or focusing a row reports its id through `onHover`. On a phone, the table scrolls sideways inside its own container.

`WarningsList`: the warnings that have no `componentId`, errors first.

`SchematicView`: for now, a box with the text "Schematic" and the same size it will have later (a 3:2 aspect ratio). WP-20 fills it. Its props are `{ circuit: Circuit; highlightId: string | null }`.

`ReviewPanel`:
- For a circuit: `ImageMarkers` and `SchematicView` in the first column, `WarningsList` and `NetlistTable` in the second. On a phone they stack in that order.
- For a graph: the image and the text "Graph review arrives in WP-28."
- An "Approve and solve" button, disabled when `canSolve(warnings)` is false. When disabled, the first error's message shows next to it.
- A Cancel button.

**Tests** (`test/web-edit.test.ts`):
- `setField` value `"2k"` on R2 of the `c01` replay reading sets 2000, sets the label to `2 kΩ`, and `validate` then gives no warnings.
- `setField` value `"abc"` returns the circuit unchanged.
- `setField` type from `resistor` to `voltage_source` with value 12 gives the label `12 V`.
- `addComponent` twice gives ids that are unused and distinct.
- `removeComponent` removes exactly one. `setGround` changes `ground`.
- No function mutates its input.

**Done when.** The tests pass. In the browser, in replay mode with sample `c01`: the warning shows on R2; changing R2 to `2k` clears it; markers sit on the right components; hovering a row highlights its marker; Approve starts the solve.

---

## WP-20: Automatic layout

**Goal.** Turn any circuit into a drawing for the review screen.

**Read.** `src/core/schematic.ts`. PLAN.md ("The review screen").

**Files.**
- `src/core/layout.ts` (new)
- `web/src/components/SchematicView.tsx`
- `test/layout.test.ts` (new)

**Spec.** `autoDrawing(circuit): Drawing` tries the positioned layout first and falls back to the bus layout.

**Positioned layout.** Use it only when every component has `pa` and `pb`.
1. Use a grid of 12 by 8 units. Snap each terminal: `gx = round(x × 14 − 1)`, `gy = round(y × 10 − 1)`, clamped to the grid. This inverts the mapping in WP-09.
2. A component is horizontal when its snapped terminals differ more in x than in y. Otherwise it is vertical. Re-centre it on the rounded midpoint so its terminals are exactly 2 units apart on that axis, with `a` on the side it was on.
3. For each node, connect its terminals with a minimum spanning tree by Manhattan distance. Draw each tree edge as an L: horizontal first, then vertical. Give every wire a vertex wherever another wire of the same node or a terminal touches it.
4. Reject the result and use the bus layout when: two components overlap; a wire passes through a component's body; two wires of different nodes share a grid point or cross; or any terminal is off the grid.
5. `groundAt` is the lowest ground terminal. On a tie, the leftmost.

**Bus layout.** It always works, for any connected or unconnected netlist.
1. Order the nodes other than ground by first appearance. Ground is a horizontal wire along the bottom.
2. Each node is a horizontal wire (a bus) on the top row. A component between a node and ground stands vertically under that node's bus, in its own column. A node's bus is as wide as the columns it needs, with one empty column between neighbouring buses.
3. A component between two nodes other than ground lies horizontally on its own row above the top row. Vertical wires drop from its terminals to the two buses. Each such component gets its own row and its own two columns, so no two wires share a point.
4. A component with `a === b` is drawn as a vertical component under its node with both terminals wired to that node.

Both layouts set `nodeLabels` for every node other than ground, at the left end of the node's first wire.

`SchematicView` renders `renderDrawing(autoDrawing(circuit), DEFAULT_STYLE)` with `dangerouslySetInnerHTML`. This is safe only because `renderDrawing` escapes all text. State that in a comment. It adds a CSS highlight for `[data-id="…"]` matching `highlightId`. The SVG scales to the container's width.

**Tests.**
- For each of the 14 problems, `autoDrawing(problem.truth)` returns a drawing whose connectivity equals the netlist's nodes. Reuse the connectivity check from `test/problems.test.ts` by moving it to `test/helpers.ts`. (This one edit to `test/helpers.ts` and `test/problems.test.ts` is allowed.)
- For each of the 14, the positioned layout is used (export a second function `positionedDrawing(circuit): Drawing | null` and assert it is not null).
- With every position set to null, each of the 14 still gives a drawing with correct connectivity.
- A circuit with 6 parallel resistors between the same two nodes gives a valid drawing with 6 distinct components.
- A circuit whose positions put two components on the same spot falls back to the bus layout.
- No drawing has a wire through a component body or two nodes sharing a grid point.
- `renderDrawing` of every result contains no `NaN`.

**Done when.** The tests pass. In the browser, the redrawn `c01`, `c06` and `c09` resemble their images, and editing a node name in the table redraws at once.

---

## WP-21: Solve, check and answer panels

**Files.** `web/src/components/SolvePanel.tsx`, `CheckReportView.tsx`, `AnswerCard.tsx`.

**Spec.**

`SolvePanel`:
- A numbered list of steps. Each shows the tool name and a one-line summary: for `solve_circuit`, the number of changes and "solved" or the error; for `evaluate`, the expression and the value; for `submit_answer`, `describeClaim(claim)`. A `<details>` element under each holds the input and output as formatted JSON.
- The streamed `text` under the steps, in an `aria-live="polite"` region.
- On attempt 2, a line above the steps: "The first answer failed the check. Trying again."
- While `busy`, a Cancel button.

`CheckReportView`:
- A heading: "Check passed" or "Check failed", with the attempt number when it is 2.
- A table of the items: name, claimed, measured, and a pass or fail mark. Format numbers with `formatQuantity` and the item's unit.
- The `notes` as a list.
- The residuals inside a `<details>` labelled "Residuals", in exponent notation.

`AnswerCard`:
- The answer from `describeClaim(result.claim)`, large. With `claim` null, show `result.text` alone.
- A "Verified" or "Not verified" label. The colour is not the only signal: the text says it.
- The explanation text.
- When not verified: a "Reopen review" button.
- Always: a "New problem" button.
- In live mode, one line with the token counts from `usage`. Omit it when both are 0.

**Done when.** In the browser, in replay mode: a `c01` session shows two steps, the streamed explanation, a passed check with one item, and the answer `V(B) = 8 V` marked verified. Approving `c01` without fixing R2 still verifies, with the answer `V(B) = 11.43 V`. "Reopen review" and "New problem" both work.

---

## WP-22: Browser check and README

**Goal.** Prove the client works, and document how to run it.

**Files.**
- `README.md`
- `docs/screenshot-review.png`, `docs/screenshot-answer.png` (new)
- Fixes in any `web/src` file for defects found here.

**Spec.**
1. Build the client and start the server in replay mode. Run both samples from start to done.
2. At 375 px and at 1280 px wide, in light and dark mode, check each phase: no horizontal page scroll, no overlapping text, readable contrast, and visible focus when tabbing.
3. Check the keyboard path: choose a sample, read, edit a value, approve, and reach the answer without a mouse.
4. Check the failure paths: stop the server mid-session (the page shows "Connection lost." and the badge shows "Disconnected"); cancel during reading; delete every component in the review (Approve is disabled and says why).
5. Check the browser console: no errors or warnings during a full session.
6. Fix what fails. Report each defect and its fix.
7. Save two screenshots at 1280 px, light mode: the review of `c01` with the warning showing, and the verified answer.
8. Update the README: status, a "Run it" section (install, `npm run build:web`, `npm run dev:server`, open `http://localhost:8787`, and the two-terminal dev setup with `npm run dev:web`), the two screenshots, and a line that replay mode calls no model. Keep the rebuild note unchanged.

**Done when.** Every check in steps 2 to 5 passes and the README's run steps work from a fresh clone.
