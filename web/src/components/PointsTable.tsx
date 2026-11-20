import type { Graph } from "../../../src/core/schema";
import { LIMITS } from "../../../src/shared/limits";
import { addPoint, removePoint, setPoint, type PointField } from "../edit";

export type PointsTableProps = { graph: Graph; onChange(g: Graph): void };

const input =
  "w-full min-w-20 rounded border border-slate-400 bg-transparent px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600";
const small =
  "rounded border border-slate-400 px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600";

export function PointsTable({ graph, onChange }: PointsTableProps) {
  const commit = (seriesId: string, index: number, field: PointField, text: string): void => {
    const next = setPoint(graph, seriesId, index, field, text);
    if (next !== graph) onChange(next);
  };

  return (
    <div className="space-y-4">
      {graph.series.map((s) => {
        const full = s.points.length >= LIMITS.maxPoints;
        return (
          <section key={s.id} aria-label={`Series ${s.name}`} className="space-y-2">
            <h3 className="text-sm font-semibold">
              {s.name} <span className="font-normal">({s.kind})</span>
            </h3>
            <div className="relative overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-1 py-1">#</th>
                    <th className="px-1 py-1">x</th>
                    <th className="px-1 py-1">y</th>
                    <th className="px-1 py-1"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {s.points.map((p, i) => (
                    <tr key={`${i}-${p.x}-${p.y}`}>
                      <td className="px-1 py-1">{i + 1}</td>
                      {(["x", "y"] as const).map((f) => (
                        <td key={f} className="px-1 py-1">
                          <input
                            aria-label={`${f} of point ${i + 1} in ${s.name}`}
                            className={input}
                            inputMode="decimal"
                            defaultValue={String(p[f])}
                            onBlur={(e) => commit(s.id, i, f, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit(s.id, i, f, e.currentTarget.value);
                            }}
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          aria-label={`Remove point ${i + 1} from ${s.name}`}
                          onClick={() => onChange(removePoint(graph, s.id, i))}
                          className={small}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={full}
                onClick={() => onChange(addPoint(graph, s.id))}
                className={`${small} px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Add point
              </button>
              {full ? <span className="text-sm">At the limit of {LIMITS.maxPoints} points.</span> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
