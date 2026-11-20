import { useMemo, useState } from "react";
import type { Graph, Warning } from "../../../src/core/schema";
import { renderChart } from "../../../src/core/chart";
import { LIMITS } from "../../../src/shared/limits";
import { setAxis, type AxisField, type AxisName } from "../edit";
import { PointsTable } from "./PointsTable";
import { WarningsList } from "./WarningsList";

export type GraphReviewProps = {
  imageUrl: string | null;
  graph: Graph;
  warnings: Warning[];
  onEdit(g: Graph): void;
};

const input =
  "w-full min-w-20 rounded border border-slate-400 bg-transparent px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600";
const frame = "block w-full rounded border border-slate-300 bg-white dark:border-slate-700";

function AxisInput({
  label,
  value,
  limit,
  onCommit,
}: {
  label: string;
  value: string;
  limit: number | null;
  onCommit(text: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = (): void => {
    if (draft !== null) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className="block text-sm">
      {label}
      <input
        className={input}
        value={shown}
        maxLength={limit ?? undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {limit !== null && shown.length >= limit ? <span className="text-xs">Limit: {limit} characters.</span> : null}
    </label>
  );
}

export function GraphReview({ imageUrl, graph, warnings, onEdit }: GraphReviewProps) {
  // The replot is an <img> with a data URL, so its text is never parsed as page HTML.
  const replot = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderChart(graph, { width: 1200, height: 800 }))}`,
    [graph],
  );
  const edit = (axis: AxisName, field: AxisField, text: string): void => {
    const next = setAxis(graph, axis, field, text);
    if (next !== graph) onEdit(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          {imageUrl === null ? null : <img src={imageUrl} alt="The uploaded problem" className={frame} />}
        </div>
        <div className="min-w-0">
          <img src={replot} alt="Replot of the graph as read" className={frame} />
        </div>
      </div>
      <WarningsList warnings={warnings} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(["x", "y"] as const).map((axis) => {
          const a = graph[axis];
          return (
            <fieldset key={axis} className="space-y-2 rounded border border-slate-300 p-3 dark:border-slate-700">
              <legend className="px-1 text-sm font-semibold">{axis === "x" ? "X axis" : "Y axis"}</legend>
              <AxisInput label="Label" value={a.label} limit={LIMITS.maxFieldChars} onCommit={(t) => edit(axis, "label", t)} />
              <AxisInput label="Unit" value={a.unit ?? ""} limit={LIMITS.maxFieldChars} onCommit={(t) => edit(axis, "unit", t)} />
              <div className="grid grid-cols-2 gap-2">
                <AxisInput label="Min" value={String(a.min)} limit={null} onCommit={(t) => edit(axis, "min", t)} />
                <AxisInput label="Max" value={String(a.max)} limit={null} onCommit={(t) => edit(axis, "max", t)} />
              </div>
            </fieldset>
          );
        })}
      </div>
      <PointsTable graph={graph} onChange={onEdit} />
    </div>
  );
}
