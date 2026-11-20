import type { Warning } from "../../../src/core/schema";

export type WarningsListProps = { warnings: Warning[] };

export function WarningsList({ warnings }: WarningsListProps) {
  const general = warnings.filter((w) => w.componentId === null);
  const sorted = [...general.filter((w) => w.severity === "error"), ...general.filter((w) => w.severity !== "error")];
  if (sorted.length === 0) return null;
  return (
    <ul className="space-y-1">
      {sorted.map((w, i) => (
        <li
          key={`${w.code}-${i}`}
          className={`rounded border px-3 py-2 text-sm ${
            w.severity === "error"
              ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
              : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          }`}
        >
          <span className="font-semibold">{w.severity === "error" ? "Error: " : "Warning: "}</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}
