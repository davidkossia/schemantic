# M8 and M9: live eval and hosting (WP-30 to WP-33)

Read [README.md](README.md) first.

---

## WP-30: Live eval runner

**Goal.** Measure the reader and the solver on the 18 problems, with a hard limit on spend.

**Read.** PLAN.md ("Eval design"). `eval/report.ts`, `eval/smoke.ts`, `eval/cost.ts`.

**Files.**
- `eval/run.ts` (add the live mode)
- `eval/live.ts` (new)
- `eval/report.ts` (add the live tables)
- `test/eval-live.test.ts` (new)
- `.gitignore` is already set: `eval/results/raw/` is ignored.

**Spec.**

Flags for `npm run eval -- --live`:

| Flag | Default | Meaning |
|---|---|---|
| `--yes` | off | Without it, print the estimate and exit with code 1. Nothing is called. |
| `--max-usd N` | 12 | Stop starting new model calls once the measured cost reaches N. |
| `--samples N` | 1 | Runs per problem. |
| `--only a,b` | all | Problem ids to run. |

For each problem and each sample, three runs:

| Run | Input | Records |
|---|---|---|
| **Read** | The PNG and the question, through `model.read`. | The reading, `scoreNetlist` or `scoreGraph`, and usage. |
| **End to end** | The reading from the read run, unedited, through `model.solve` and `checkClaim`, with one retry on a failed check, exactly as the session does. | The claim, verified or not, the grade, and usage. If `canSolve` is false for the reading, record a wrong answer and make no solver call. |
| **Solver only** | The problem's `truth`, through the same solve and check. | The same fields. |

Run them through `createSession` with the live client where that is simpler, or call the client directly. Either way the retry rule must match the session's.

Grading: `gradeClaim(expected, got, tolerance)` in `eval/report.ts` is true when `got` is not null, the kinds are equal, and every claimed number of `expected` has a number of the same name in `got` within the tolerance. The tolerance is 1% for circuits and 5% for graphs. It uses the same `max(tol × |reference|, 1e-9)` rule as `closeTo`.

Cost control:
- The estimate before the run is `problems × samples × (0.09 + 2 × 0.18)` dollars. Print it with the number of calls.
- After every model call, add `costUsd(usage)` to a running total. Before every model call, compare the total with `--max-usd`. Once it is reached, skip the remaining calls, mark those runs as `skipped`, and finish the report.
- Print the measured total at the end.

Output:
- `eval/results/<YYYY-MM-DD>.json`: the date, the model id, the sample count, every run's record, and the totals. No images and no API key.
- `eval/results/raw/`: full transcripts, not committed.
- `liveTable(results): string` gives this Markdown, with one row per problem and a totals row:

| Problem | Parse recall | Parse precision | End to end | Solver only | Verified by checker |
|---|---|---|---|---|---|

- `summaryTable(results): string` gives the headline numbers: parse accuracy (micro-averaged recall and precision over circuits, and over graphs), readings that are exact (n of 18), end-to-end accuracy (n of 18), solver-only accuracy (n of 18), samples per problem, total tokens, and total cost.
- `--write-readme` replaces the text between `<!-- eval:start -->` and `<!-- eval:end -->` in README.md with the summary table, the per-problem table, the date, the model id and the limits paragraph from PLAN.md.

**Tests** (no key, with a fake model client):
- Without `--yes`, no client call is made and the exit code is 1.
- With a fake client that answers everything correctly: every row grades right, and the tables have 18 rows plus totals.
- With `--max-usd 0.5` and a fake client that reports 100,000 output tokens per call: the run stops early, and the remaining runs are `skipped`.
- A fake reading that cannot be solved: the end-to-end run is wrong and makes no solver call.
- `gradeClaim`: a right claim; a claim 0.5% off (right); 2% off (wrong for a circuit, right for a graph); a different kind (wrong); null (wrong); `thevenin` with a right `vth` and a wrong `rth` (wrong).
- `--write-readme` on a temporary README with the two markers replaces only the text between them.

**Done when.** The tests pass with no key set, and `npm run eval -- --live` without `--yes` prints the estimate.

---

## WP-31: Run the eval and publish results

**Gate.** The API key is in `.env`, and the repository owner has said yes to the spend. Do not run this package without both.

**Steps.**
1. Run `npm run eval -- --core`. It must pass.
2. Run `npm run eval -- --live --yes --max-usd 12 --write-readme`.
3. Read the per-problem table. For every wrong row, open the raw transcript and write one line on the cause: a misread, a wrong tool call, a wrong claim kind, or a harness defect.
4. A harness defect (a bug in the eval, the scoring or a problem file) is fixed, and only the affected problems are rerun with `--only`. Say so in the README. Do not rerun to get a better number, and do not change a prompt after seeing eval results without saying so in the README.
5. Re-record the replay samples: replace each fixture's `reading` with the live reading of that image from this run, then re-apply the deliberate misread from PROBLEMS.md. Add a comment with the date and the model id. The WP-14 tests must still pass.
6. Update the README: remove "not measured yet" wording, keep the limits paragraph next to the numbers, and state the sample count.
7. Update the milestone table in PLAN.md and replace the cost estimates with the measured cost.
8. Commit `eval/results/<date>.json` and push.

**Done when.** The README shows measured numbers with their date, model, sample count and limits, and every wrong row has a stated cause.

---

## WP-32: Static replay demo

**Goal.** A free public demo that runs in the browser with no server and no key.

**Files.**
- `web/src/localTransport.ts` (new)
- `web/src/useSession.ts` (choose the transport)
- `web/vite.config.ts` (`base: "./"`)
- `.github/workflows/pages.yml` (new)
- `package.json`: add the script `"build:pages": "VITE_TRANSPORT=local vite build --config web/vite.config.ts"` (serial)
- `test/local-transport.test.ts` (new)
- `README.md` (the demo link)

**Spec.**
1. `localTransport(): Transport` creates a session in the page with `createSession`, `createScriptedClient({ fixtures: REPLAY_FIXTURES, tokenDelayMs: 15 })`, and the fixtures' samples. `send` passes `JSON.stringify(message)` to `session.receive` on the next microtask. Session messages go to the subscribers.
2. `useSession` uses `localTransport` when `import.meta.env.VITE_TRANSPORT === "local"`, and `wsTransport` otherwise.
3. The build must contain no Node built-in. If the bundler reports one, find the import and report it. Do not add a polyfill.
4. `pages.yml`: on a push to `main`, install, run the check chain, run `npm run build:pages`, and deploy `web/dist` with `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. Set the permissions `pages: write` and `id-token: write`.
5. The README links the demo and says: "The demo runs in replay mode in your browser. No model is called. The math and the check are real."
6. The repository's Pages source must be set to "GitHub Actions" once. This is a repository setting. Report it as a step for whoever runs the build. Do not change repository settings from this package.

**Tests.** `localTransport` runs a full `c01` session to `done` with `verified: true` under vitest.

**Done when.** The tests pass. `npm run build:pages` succeeds. Serving `web/dist` from a sub-path with a plain static file server runs both circuit samples from start to done, with images loading and no console errors.

---

## WP-33: Live host (optional)

WP-33 starts only after the four "Required before live traffic" fixes in WP-25 (M6-agents.md) are merged and reviewed.

**Gate.** The repository owner has said yes to paid hosting and to public API spend. Without that, do not start.

This package is specified only as requirements, because the host is not chosen. Write a short design note first and get it approved.

**Requirements.**
1. A passcode on the WebSocket upgrade, compared in constant time, read from the environment. Without the right passcode the server offers replay mode only.
2. A daily spend cap in dollars, read from the environment. The server adds up `costUsd` for every session, and refuses new live sessions once the cap is reached until the next UTC day. The total survives a restart.
3. A cap on concurrent live sessions and on sessions per IP address per hour.
4. `ALLOWED_ORIGINS` set to the site's origin.
5. No logging of images, questions, structures or the key. Logs hold timestamps, session ids, token counts and error codes.
6. A `Dockerfile` that builds the client, runs the server as a user without root rights, and exposes one port.
7. A `/healthz` check, and a README section on running costs.

**Review.** This package handles money and untrusted input. It gets two independent reviews before it goes live, and one final check of the fix diff.
