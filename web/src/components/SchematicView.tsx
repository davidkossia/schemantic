import type { Circuit } from "../../../src/core/schema";

export type SchematicViewProps = { circuit: Circuit; highlightId: string | null };

export function SchematicView(_props: SchematicViewProps) {
  return (
    <div className="flex aspect-[3/2] w-full items-center justify-center rounded border border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      Schematic
    </div>
  );
}
