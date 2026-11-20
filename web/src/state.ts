import type { CheckReport, Claim, Structure, Warning } from "../../src/core/schema";
import type { ToolOutput } from "../../src/core/tools";
import { validate } from "../../src/core/validate";
import type { Usage } from "../../src/pipeline/model";
import type { ErrorCode, Sample, ServerMessage, SessionState } from "../../src/shared/protocol";

export type UiState = {
  connected: boolean;
  mode: "live" | "replay" | null;
  samples: Sample[];
  phase: SessionState;
  question: string;
  imageUrl: string | null; // what the review shows: a sample URL or an object URL
  structure: Structure | null; // the editable copy
  warnings: Warning[];
  attempt: 1 | 2 | null;
  steps: { index: number; tool: string; input: unknown; output: ToolOutput }[];
  text: string; // tokens of the current attempt
  reports: CheckReport[];
  result: { claim: Claim | null; text: string; verified: boolean; usage: Usage } | null;
  error: { code: ErrorCode; message: string } | null;
};

export type UiAction =
  | { type: "server"; message: ServerMessage }
  | { type: "started"; question: string; imageUrl: string }
  | { type: "edited"; structure: Structure }
  | { type: "dismissed_error" };

export const initialState: UiState = {
  connected: false,
  mode: null,
  samples: [],
  phase: "idle",
  question: "",
  imageUrl: null,
  structure: null,
  warnings: [],
  attempt: null,
  steps: [],
  text: "",
  reports: [],
  result: null,
  error: null,
};

const KEEP_PHASE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(["cannot_solve", "bad_message", "bad_state"]);

function toToolOutput(output: { ok: boolean; [key: string]: unknown }): ToolOutput {
  if (output.ok) return { ...output, ok: true };
  const error = output.error;
  return { ok: false, error: typeof error === "string" ? error : "Tool failed." };
}

function reduceServer(state: UiState, message: ServerMessage): UiState {
  switch (message.type) {
    case "hello":
      return { ...state, connected: true, mode: message.mode, samples: message.samples };
    case "reading":
      return { ...state, phase: "reading" };
    case "parsed":
      return { ...state, structure: message.structure, warnings: message.warnings };
    case "awaiting_review":
      return { ...state, phase: "awaiting_review", result: null };
    case "solving":
      return message.attempt === 1
        ? { ...state, phase: "solving", attempt: 1, text: "", steps: [], reports: [] }
        : { ...state, phase: "solving", attempt: message.attempt, text: "" };
    case "token":
      return { ...state, text: state.text + message.text };
    case "step":
      return {
        ...state,
        steps: [
          ...state.steps,
          { index: message.index, tool: message.tool, input: message.input, output: toToolOutput(message.output) },
        ],
      };
    case "checking":
      return { ...state, phase: "checking" };
    case "check":
      return { ...state, reports: [...state.reports, message.report] };
    case "done":
      return {
        ...state,
        phase: "done",
        result: { claim: message.claim, text: message.text, verified: message.verified, usage: message.usage },
      };
    case "error": {
      // The server sends "cancelled" only in reply to this client's own cancel (Cancel or New problem),
      // so it is not an error to show: go back to the start without a banner.
      if (message.code === "cancelled") return { ...state, phase: "idle", error: null };
      const next: UiState = { ...state, error: { code: message.code, message: message.message } };
      if (!KEEP_PHASE.has(message.code)) next.phase = "idle";
      if (message.code === "internal" && message.message === "Connection lost.") next.connected = false;
      return next;
    }
  }
}

export function reduce(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "server":
      return reduceServer(state, action.message);
    case "started":
      return {
        ...state,
        question: action.question,
        imageUrl: action.imageUrl,
        structure: null,
        warnings: [],
        steps: [],
        text: "",
        reports: [],
        result: null,
        error: null,
        attempt: null,
      };
    case "edited":
      return { ...state, structure: action.structure, warnings: validate(action.structure) };
    case "dismissed_error":
      return { ...state, error: null };
  }
}
