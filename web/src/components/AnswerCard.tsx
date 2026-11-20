import { describeClaim } from "../../../src/core/describe";
import type { UiState } from "../state";

export type AnswerCardProps = {
  result: NonNullable<UiState["result"]>;
  onReopen(): void;
  onNew(): void;
};

export function AnswerCard({ result, onReopen, onNew }: AnswerCardProps) {
  const { claim, text, verified, usage } = result;
  const showUsage = usage.inputTokens > 0 || usage.outputTokens > 0;
  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <p className="break-words text-2xl font-semibold">{claim ? describeClaim(claim) : text}</p>
      <p className="font-medium">{verified ? "Verified" : "Not verified"}</p>
      {claim && text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
      {showUsage ? (
        <p className="text-sm">{`${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens`}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {verified ? null : (
          <button type="button" onClick={onReopen} className="rounded border px-3 py-1">
            Reopen review
          </button>
        )}
        <button type="button" onClick={onNew} className="rounded border px-3 py-1">
          New problem
        </button>
      </div>
    </section>
  );
}
