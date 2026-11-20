import { Claim } from "../../../src/core/schema";
import { describeClaim } from "../../../src/core/describe";
import type { UiState } from "../state";

export type SolvePanelProps = {
  attempt: 1 | 2 | null;
  steps: UiState["steps"];
  text: string;
  busy: boolean;
  onCancel(): void;
};

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function summarize(step: UiState["steps"][number]): string {
  const { tool, input, output } = step;
  switch (tool) {
    case "solve_circuit": {
      const changes = field(input, "changes");
      const count = Array.isArray(changes) ? changes.length : 0;
      const label = `${count} ${count === 1 ? "change" : "changes"}`;
      return output.ok ? `${label}, solved` : `${label}, ${output.error}`;
    }
    case "evaluate": {
      const expression = field(input, "expression");
      const expr = typeof expression === "string" ? expression : "";
      if (!output.ok) return `${expr}: ${output.error}`;
      const value = output["value"];
      return `${expr} = ${typeof value === "number" ? String(Number(value.toPrecision(6))) : String(value)}`;
    }
    case "submit_answer": {
      const parsed = Claim.safeParse(field(input, "claim"));
      const text = parsed.success ? describeClaim(parsed.data) : "answer";
      return output.ok ? text : `${text}, ${output.error}`;
    }
    default:
      return output.ok ? "done" : output.error;
  }
}

export function SolvePanel({ attempt, steps, text, busy, onCancel }: SolvePanelProps) {
  return (
    <section className="flex flex-col gap-3">
      {attempt === 2 ? <p>The first answer failed the check. Trying again.</p> : null}
      <ol className="flex list-decimal flex-col gap-2 pl-6">
        {steps.map((step) => (
          <li key={step.index}>
            <span className="font-medium">{step.tool}</span>
            <span>{`: ${summarize(step)}`}</span>
            <details className="mt-1">
              <summary className="cursor-pointer">Details</summary>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm">
                {JSON.stringify({ input: step.input, output: step.output }, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="whitespace-pre-wrap break-words">
        {text}
      </div>
      {busy ? (
        <div>
          <button type="button" onClick={onCancel} className="rounded border px-3 py-1">
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}
