/**
 * Session state machine: reading, review gate, solving, checking. Takes a model client and a transport. No Node APIs.
 */
import { checkClaim } from "../core/checker";
import type { CheckReport, Claim, Structure } from "../core/schema";
import { createToolRunner } from "../core/tools";
import { canSolve, validate } from "../core/validate";
import { LIMITS } from "../shared/limits";
import {
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type Sample,
  type ServerMessage,
  type SessionState,
} from "../shared/protocol";
import { ModelError, type ModelClient, type SolveOutput, type Usage } from "./model";

/** The limits a session reads. Numbers, so a caller can pass any value, not only the defaults. */
export type SessionLimits = { [K in keyof typeof LIMITS]: number };

export type SessionDeps = {
  model: ModelClient;
  send: (message: ServerMessage) => void;
  samples: Sample[];
  limits?: Partial<SessionLimits>;
};
export type Session = { receive(raw: string): void; close(): void; state(): SessionState };

type StartMessage = Extract<ClientMessage, { type: "start" }>;

const VALID_IN: Record<ClientMessage["type"], readonly SessionState[]> = {
  start: ["idle", "done"],
  approve: ["awaiting_review"],
  reopen: ["done"],
  cancel: ["idle", "reading", "awaiting_review", "solving", "checking", "done"],
};

/** Decoded size of a base64 string in bytes, without decoding it. */
function decodedBytes(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** Run `call`, and reject with `onTimeout` (after aborting) when it takes longer than `ms`. */
function withTimeout<T>(controller: AbortController, ms: number, onTimeout: ModelError, call: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout);
      controller.abort();
    }, ms);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    let pending: Promise<T>;
    try {
      pending = call();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createSession(deps: SessionDeps): Session {
  const limits: SessionLimits = { ...LIMITS, ...deps.limits };

  let state: SessionState = "idle";
  let closed = false;
  // Bumped by cancel, close and start. A promise that settles under an older run is ignored.
  let run = 0;
  let inFlight: AbortController | null = null;

  // Data of the current run. `start` clears it.
  let question = "";
  let sampleId: string | null = null;
  let approved: Structure | null = null;
  let stepIndex = 0;
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }; // this run's usage, reported in `done`

  // Tokens spent over the whole session (the WebSocket connection). Never reset; the token budget applies to it.
  let total: Usage = { inputTokens: 0, outputTokens: 0 };
  // Model calls that have not settled, including ones that were cancelled or timed out. Until they
  // settle, `total` is missing their tokens, so a new `start` is refused.
  let unsettled = 0;

  function send(message: ServerMessage): void {
    if (!closed) deps.send(message);
  }

  function sendError(code: ErrorCode, message: string): void {
    send({ type: "error", code, message });
  }

  function isCurrent(myRun: number): boolean {
    return !closed && run === myRun;
  }

  function addUsage(u: Usage): void {
    usage = { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens };
  }

  function tokensLeft(): number {
    return limits.maxSessionTokens - (total.inputTokens + total.outputTokens);
  }

  /**
   * Add a model call's usage to the session total when the call settles: its output's usage on
   * success, the `ModelError`'s usage on failure. This runs even when the result is ignored
   * (cancel, close, a new start, a timeout), because those tokens were still spent.
   */
  function track<T extends { usage: Usage }>(call: Promise<T>): Promise<T> {
    const count = (u: Usage) => {
      total = { inputTokens: total.inputTokens + u.inputTokens, outputTokens: total.outputTokens + u.outputTokens };
    };
    unsettled += 1;
    return call.then(
      (out) => {
        unsettled -= 1;
        count(out.usage);
        return out;
      },
      (e: unknown) => {
        unsettled -= 1;
        if (e instanceof ModelError && e.usage !== undefined) count(e.usage);
        throw e;
      },
    );
  }

  function abortInFlight(): void {
    const controller = inFlight;
    inFlight = null;
    controller?.abort();
  }

  /** A failed model call or an unexpected throw: report it and go back to idle. */
  function fail(e: unknown): void {
    inFlight = null;
    state = "idle";
    if (e instanceof ModelError) sendError(e.code, e.message);
    else sendError("internal", "Something went wrong.");
  }

  function finish(claim: Claim | null, text: string, verified: boolean): void {
    state = "done";
    send({ type: "done", claim, text, verified, usage: { ...usage } });
  }

  async function read(myRun: number, message: StartMessage): Promise<void> {
    const controller = new AbortController();
    inFlight = controller;
    try {
      const out = await withTimeout(
        controller,
        limits.readTimeoutMs,
        new ModelError("read_failed", "Reading the problem took too long."),
        () =>
          track(
            deps.model.read({
              image: message.image,
              sampleId: message.sampleId,
              question: message.question,
              tokenBudget: tokensLeft(),
              signal: controller.signal,
            }),
          ),
      );
      if (!isCurrent(myRun)) return;
      inFlight = null;
      addUsage(out.usage);
      const warnings = validate(out.structure);
      state = "awaiting_review";
      send({ type: "parsed", structure: out.structure, warnings });
      send({ type: "awaiting_review" });
    } catch (e) {
      if (isCurrent(myRun)) fail(e);
    }
  }

  async function solveAttempt(myRun: number, attempt: 1 | 2, feedback: CheckReport | null): Promise<void> {
    const structure = approved;
    if (structure === null) {
      fail(new Error("No approved structure."));
      return;
    }
    if (tokensLeft() <= 0) {
      state = "idle";
      sendError("limit_reached", "This session has used its token budget.");
      return;
    }
    state = "solving";
    send({ type: "solving", attempt });

    const controller = new AbortController();
    inFlight = controller;
    let out: SolveOutput;
    try {
      const tools = createToolRunner(structure);
      out = await withTimeout(
        controller,
        limits.solveTimeoutMs,
        new ModelError("solve_failed", "Solving took too long."),
        () =>
          track(
            deps.model.solve({
              structure: structuredClone(structure),
              question,
              sampleId,
              tools,
              feedback,
              tokenBudget: tokensLeft(),
              signal: controller.signal,
              onEvent: (event) => {
                if (!isCurrent(myRun)) return;
                if (event.type === "token") {
                  send({ type: "token", text: event.text });
                } else {
                  send({ type: "step", index: stepIndex, tool: event.tool, input: event.input, output: event.output });
                  stepIndex += 1;
                }
              },
            }),
          ),
      );
    } catch (e) {
      if (isCurrent(myRun)) fail(e);
      return;
    }
    if (!isCurrent(myRun)) return;
    inFlight = null;
    addUsage(out.usage);

    if (out.claim === null) {
      finish(null, out.text, false);
      return;
    }
    state = "checking";
    send({ type: "checking" });
    const report = checkClaim(structure, out.claim);
    send({ type: "check", report, attempt });
    if (report.verified) finish(out.claim, out.text, true);
    else if (attempt === 1) await solveAttempt(myRun, 2, report);
    else finish(out.claim, out.text, false);
  }

  /** Start async work and make sure nothing it throws goes unhandled. */
  function launch(work: Promise<void>, myRun: number): void {
    work.catch((e: unknown) => {
      if (isCurrent(myRun)) fail(e);
    });
  }

  function onStart(message: StartMessage): void {
    if (message.image !== null) {
      if (decodedBytes(message.image.base64) > limits.maxImageBytes) {
        sendError("image_too_large", "The image is too large.");
        return;
      }
      if (deps.model.mode === "replay") {
        sendError("unsupported_image", "Replay mode reads only the sample problems.");
        return;
      }
    }
    if (message.sampleId !== null && !deps.samples.some((s) => s.id === message.sampleId)) {
      sendError("bad_message", "That sample does not exist.");
      return;
    }
    if (unsettled > 0) {
      sendError("bad_state", "The last request is still stopping. Try again in a moment.");
      return;
    }
    if (tokensLeft() <= 0) {
      sendError("limit_reached", "This session has used its token budget.");
      return;
    }

    run += 1;
    abortInFlight();
    question = message.question;
    sampleId = message.sampleId;
    approved = null;
    stepIndex = 0;
    usage = { inputTokens: 0, outputTokens: 0 };

    state = "reading";
    send({ type: "reading" });
    launch(read(run, message), run);
  }

  function onApprove(structure: Structure): void {
    // Size checks come first: `validate` solves the circuit, and its cost grows with the square of the node count.
    if (JSON.stringify(structure).length > limits.maxStructureChars) {
      sendError("bad_message", "The structure is too large to solve.");
      return;
    }
    if (structure.kind === "circuit" && structure.components.length > limits.maxComponents) {
      sendError("cannot_solve", `The circuit has more than ${limits.maxComponents} components.`);
      return;
    }
    const warnings = validate(structure);
    if (!canSolve(warnings)) {
      const firstError = warnings.find((w) => w.severity === "error");
      sendError("cannot_solve", firstError?.message ?? "The structure cannot be solved.");
      return;
    }
    approved = structure;
    launch(solveAttempt(run, 1, null), run);
  }

  function onReopen(): void {
    if (approved === null) {
      sendError("bad_state", "There is no approved structure to reopen.");
      return;
    }
    state = "awaiting_review";
    send({ type: "parsed", structure: approved, warnings: validate(approved) });
    send({ type: "awaiting_review" });
  }

  function onCancel(): void {
    if (state === "idle") return;
    run += 1;
    abortInFlight();
    state = "idle";
    sendError("cancelled", "Cancelled.");
  }

  send({ type: "hello", mode: deps.model.mode, samples: deps.samples });

  return {
    receive(raw: string): void {
      if (closed) return;
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        sendError("bad_message", parsed.error);
        return;
      }
      const message = parsed.value;
      if (!VALID_IN[message.type].includes(state)) {
        sendError("bad_state", `A ${message.type} message is not allowed now.`);
        return;
      }
      try {
        switch (message.type) {
          case "start":
            onStart(message);
            break;
          case "approve":
            onApprove(message.structure);
            break;
          case "reopen":
            onReopen();
            break;
          case "cancel":
            onCancel();
            break;
        }
      } catch (e) {
        run += 1;
        abortInFlight();
        fail(e);
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      run += 1;
      abortInFlight();
      state = "idle";
    },
    state(): SessionState {
      return state;
    },
  };
}
