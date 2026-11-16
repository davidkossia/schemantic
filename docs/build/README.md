# Build guide

This folder turns [PLAN.md](../../PLAN.md) into work packages. Each package is small enough to build and check on its own, and names the exact files, signatures and tests.

| File | Contents |
|---|---|
| [CONTRACTS.md](CONTRACTS.md) | Every shared type, signature and convention. The source of truth. |
| [PROBLEMS.md](PROBLEMS.md) | The 18 eval problems with netlists and checked answers. |
| [M2-core.md](M2-core.md) | WP-01 to WP-07: schemas, units, solver, validator, checker, tools. |
| [M3-renderer-eval.md](M3-renderer-eval.md) | WP-08 to WP-12: schematic renderer, problem files, images, scoring. |
| [M4-pipeline-server.md](M4-pipeline-server.md) | WP-13 to WP-16: protocol, scripted client, session, server. |
| [M5-ui.md](M5-ui.md) | WP-17 to WP-22: the browser client. |
| [M6-agents.md](M6-agents.md) | WP-23 to WP-25: reader, solver loop, live wiring. |
| [M7-graphs.md](M7-graphs.md) | WP-26 to WP-29: graph support. |
| [M8-M9-eval-hosting.md](M8-M9-eval-hosting.md) | WP-30 to WP-33: live eval, static demo, optional live host. |

## Rules for every package

1. **Read first:** this file, the sections of CONTRACTS.md your package names, and your package. Read nothing else unless the package says so.
2. **Touch only the files your package lists.** If you need a change elsewhere, stop and report it. Do not edit CONTRACTS.md or PROBLEMS.md.
3. **Follow the contracts exactly.** Names, field order and sign conventions are fixed. If a contract looks wrong, report it and do not work around it.
4. **Write the tests the package lists.** Every test has at least one `expect`. Compare numbers with `closeTo` from `src/core/units.ts` or with `toBeCloseTo`.
5. **No new dependencies** unless the package names one.
6. **TypeScript:** `strict` is on, with `noUncheckedIndexedAccess`. No `any`, no `as` casts to silence an error, no default exports, no file extensions in relative imports.
7. **Purity:** see "Purity" in CONTRACTS.md section 1.
8. **Done means** `npm run typecheck && npm test && npm run build:web` pass, run one after another, and every line under the package's "Done when" is true.
9. **Report back** with: files changed, the test count, and anything in the spec you could not follow, with the reason.
10. **Public repo:** no secrets, no real names, no customer data, nothing about any employer.

## Package list

"Needs" lists packages that must be merged first. Packages with the same needs can be built at the same time, because their file lists do not overlap. "Serial" means the package edits `package.json` or `tsconfig.json`, so no other package may run alongside it.

| WP | Title | Needs | Size | Judgement | Key |
|---|---|---|---|---|---|
| 01 | Schemas and test helpers | none | S | low | no |
| 02 | Unit parser and formatter | 01 | S | low | no |
| 03 | Linear solver and MNA | 01 | M | medium | no |
| 04 | Validator | 02, 03 | S | low | no |
| 05 | Measurement and certificate | 03 | M | high | no |
| 06 | Checker | 05 | S | medium | no |
| 07 | Solver tools | 03 | M | medium | no |
| 08 | Schematic renderer | 01 | M | medium | no |
| 09 | Circuit problem files | 05, 06, 08 | M | medium | no |
| 10 | Image rendering (serial) | 09 | S | low | no |
| 11 | Parse scoring | 02 | M | medium | no |
| 12 | Core eval runner | 06, 09 | S | low | no |
| 13 | Message protocol | 01 | S | low | no |
| 14 | Scripted client and replay fixtures (serial) | 07, 09 | M | medium | no |
| 15 | Session state machine | 04, 06, 07, 13 | M | high | no |
| 16 | WebSocket server | 14, 15 | M | medium | no |
| 17 | Client state, transport and shell | 04, 13 | M | medium | no |
| 18 | Start panel | 17 | S | low | no |
| 19 | Review panel | 17 | M | medium | no |
| 20 | Automatic layout | 08 | M | high | no |
| 21 | Solve, check and answer panels | 14, 17 | S | low | no |
| 22 | Browser check and README | 16, 18 to 21 | S | medium | no |
| 23 | Reader agent | 13 | M | high | tests no, live yes |
| 24 | Solver agent loop | 07, 23 | M | high | tests no, live yes |
| 25 | Live wiring and smoke run | 16, 24 | S | medium | yes |
| 26 | Graph core | 06, 07 | M | medium | no |
| 27 | Chart renderer and graph problems | 11, 12, 26 | M | medium | no |
| 28 | Graph review UI | 19, 27 | M | medium | no |
| 29 | Graph reading and replay sample | 25, 28 | S | high | yes |
| 30 | Live eval runner | 25, 27 | M | medium | tests no |
| 31 | Run the eval and publish results | 29, 30 | S | medium | yes, plus a yes to spend |
| 32 | Static replay demo | 22 | M | medium | no |
| 33 | Live host (optional) | 25 | M | high | yes, plus a yes to host |

## Build order

```
01 ─┬─ 02 ─┬─ 04 ──────────────┐
    │      └─ 11               │
    ├─ 03 ─┬─ 05 ── 06 ─┬─ 09 ─┼─ 10
    │      └─ 07 ───────┤      ├─ 12
    ├─ 08 ── 20         │      └─ 14 ─┐
    └─ 13 ──────────────┴─ 15 ────────┴─ 16
                 17 ─┬─ 18
                     ├─ 19          22 ── 32
                     └─ 21
    23 ── 24 ── 25        26 ── 27 ── 28 ── 29 ── 30 ── 31
```

## Gates

| Gate | Before | Who decides |
|---|---|---|
| The whole build | WP-01 | The repository owner says "start". |
| API key in `.env` | WP-25, WP-29, WP-31 | The owner adds it. Nobody pastes a key into a chat or a file in git. |
| Eval spend, about $5 to $10 | WP-31 | The owner says yes. |
| Paid hosting | WP-33 | The owner says yes. |

## After each milestone

1. Run the full check chain on `main`.
2. Update "Status" in the repository README and the milestone table in PLAN.md.
3. Commit with a conventional message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and push.
