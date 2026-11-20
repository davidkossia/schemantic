import { useId, useState } from "react";
import type { Structure, Warning } from "../../../src/core/schema";
import { canSolve } from "../../../src/core/validate";
import { ImageMarkers } from "./ImageMarkers";
import { NetlistTable } from "./NetlistTable";
import { SchematicView } from "./SchematicView";
import { WarningsList } from "./WarningsList";

export type ReviewPanelProps = {
  imageUrl: string | null;
  structure: Structure;
  warnings: Warning[];
  onEdit(s: Structure): void;
  onApprove(): void;
  onCancel(): void;
};

const button =
  "rounded border border-slate-400 px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-600";

export function ReviewPanel({ imageUrl, structure, warnings, onEdit, onApprove, onCancel }: ReviewPanelProps) {
  const [hover, setHover] = useState<string | null>(null);
  const solvable = canSolve(warnings);
  const firstError = warnings.find((w) => w.severity === "error");

  const reasonId = useId();
  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!solvable}
        aria-describedby={!solvable && firstError ? reasonId : undefined}
        onClick={onApprove}
        className={`${button} bg-blue-700 text-white disabled:cursor-not-allowed disabled:opacity-50`}
      >
        Approve and solve
      </button>
      <button type="button" onClick={onCancel} className={button}>
        Cancel
      </button>
      <span id={reasonId} aria-live="polite" className="text-sm text-red-700 dark:text-red-300">
        {!solvable && firstError ? firstError.message : ""}
      </span>
    </div>
  );

  if (structure.kind === "graph") {
    return (
      <section className="space-y-4">
        <ImageMarkers imageUrl={imageUrl} components={[]} highlightId={null} />
        <p>Graph review arrives in WP-28.</p>
        {actions}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <ImageMarkers imageUrl={imageUrl} components={structure.components} highlightId={hover} />
          <SchematicView circuit={structure} highlightId={hover} />
        </div>
        <div className="min-w-0 space-y-4">
          <WarningsList warnings={warnings} />
          <NetlistTable circuit={structure} warnings={warnings} onChange={onEdit} onHover={setHover} />
        </div>
      </div>
      {actions}
    </section>
  );
}
