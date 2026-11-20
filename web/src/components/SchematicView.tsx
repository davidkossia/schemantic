import { useId, useMemo } from "react";
import { autoDrawing } from "../../../src/core/layout";
import type { Circuit } from "../../../src/core/schema";
import { DEFAULT_STYLE, renderDrawing } from "../../../src/core/schematic";

export type SchematicViewProps = { circuit: Circuit; highlightId: string | null };

const HIGHLIGHT = "#d97706";

export function SchematicView({ circuit, highlightId }: SchematicViewProps) {
  const scope = `schematic-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useMemo(() => renderDrawing(autoDrawing(circuit), DEFAULT_STYLE), [circuit]);
  const highlight =
    highlightId === null
      ? ""
      : `#${scope} [data-id="${CSS.escape(highlightId)}"]{stroke:${HIGHLIGHT};stroke-width:4}` +
        `#${scope} [data-id="${CSS.escape(highlightId)}"] text{fill:${HIGHLIGHT}}`;

  return (
    <figure className="w-full">
      {highlight !== "" && <style>{highlight}</style>}
      <div
        id={scope}
        role="img"
        aria-label="Schematic redrawn from the netlist"
        className="w-full overflow-hidden rounded border border-slate-300 dark:border-slate-700 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        // Safe: renderDrawing escapes every piece of text it writes (ids, labels and node names).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </figure>
  );
}
