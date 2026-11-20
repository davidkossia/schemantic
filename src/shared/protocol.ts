/**
 * WebSocket message types shared by server and client. Every message is one JSON text frame.
 */
import { z } from "zod";
import { Claim, Structure, err, ok, type CheckReport, type Result, type Warning } from "../core/schema";
import { ImageInput, Usage } from "../pipeline/model";
import { LIMITS } from "./limits";

export const Sample = z.object({ id: z.string(), title: z.string(), question: z.string(), imageUrl: z.string() });
export type Sample = z.infer<typeof Sample>;

export const ErrorCode = z.enum([
  "bad_message", "bad_state", "image_too_large", "unsupported_image",
  "cannot_solve", "read_failed", "refused", "solve_failed", "limit_reached", "cancelled", "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const SessionState = z.enum(["idle", "reading", "awaiting_review", "solving", "checking", "done"]);
export type SessionState = z.infer<typeof SessionState>;

const WarningSchema = z.object({
  code: z.enum([
    "empty", "no_ground", "duplicate_id", "unknown_component", "invalid_value", "shorted_source",
    "disconnected", "singular", "dangling_node", "label_mismatch", "unit_mismatch", "uncertain",
    "empty_series", "unsorted_points", "bad_axis",
  ]),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  componentId: z.string().nullable(),
  node: z.string().nullable(),
});

const CheckReportSchema = z.object({
  verified: z.boolean(),
  items: z.array(z.object({
    name: z.string(),
    claimed: z.number(),
    measured: z.number(),
    unit: z.string(),
    ok: z.boolean(),
  })),
  residuals: z.object({ kclMax: z.number(), sourceMax: z.number(), powerBalance: z.number() }).nullable(),
  notes: z.array(z.string()),
});

// The two schemas above copy plain types from schema.ts. These lines fail the type check if they drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const warningMatches: Same<z.infer<typeof WarningSchema>, Warning> = true;
const checkReportMatches: Same<z.infer<typeof CheckReportSchema>, CheckReport> = true;
void warningMatches;
void checkReportMatches;

const Attempt = z.union([z.literal(1), z.literal(2)]);

const StartMessage = z.object({
  type: z.literal("start"),
  image: ImageInput.nullable(),
  sampleId: z.string().nullable(),
  question: z.string().trim().min(1).max(LIMITS.maxQuestionChars),
}).refine((m) => (m.image === null) !== (m.sampleId === null), {
  message: "Set exactly one of image and sampleId.",
});

export const ClientMessage = z.discriminatedUnion("type", [
  StartMessage,
  z.object({ type: z.literal("approve"), structure: Structure }),
  z.object({ type: z.literal("reopen") }),
  z.object({ type: z.literal("cancel") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), mode: z.enum(["live", "replay"]), samples: z.array(Sample) }),
  z.object({ type: z.literal("reading") }),
  z.object({ type: z.literal("parsed"), structure: Structure, warnings: z.array(WarningSchema) }),
  z.object({ type: z.literal("awaiting_review") }),
  z.object({ type: z.literal("solving"), attempt: Attempt }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("step"),
    index: z.number(),
    tool: z.string(),
    input: z.unknown(),
    output: z.object({ ok: z.boolean() }).loose(),
  }),
  z.object({ type: z.literal("checking") }),
  z.object({ type: z.literal("check"), report: CheckReportSchema, attempt: Attempt }),
  z.object({
    type: z.literal("done"),
    claim: Claim.nullable(),
    text: z.string(),
    verified: z.boolean(),
    usage: Usage,
  }),
  z.object({ type: z.literal("error"), code: ErrorCode, message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

function parseWith<T>(schema: z.ZodType<T>, raw: string): Result<T, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err("Message is not JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Message does not match the protocol.");
  }
  return ok(parsed.data);
}

export function parseClientMessage(raw: string): Result<ClientMessage, string> {
  return parseWith(ClientMessage, raw);
}

export function parseServerMessage(raw: string): Result<ServerMessage, string> {
  return parseWith(ServerMessage, raw);
}
