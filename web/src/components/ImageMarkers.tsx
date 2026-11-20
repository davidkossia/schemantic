import type { Component } from "../../../src/core/schema";

export type ImageMarkersProps = { imageUrl: string | null; components: Component[]; highlightId: string | null };

export function ImageMarkers({ imageUrl, components, highlightId }: ImageMarkersProps) {
  if (imageUrl === null) return null;
  return (
    <div className="relative w-full">
      <img src={imageUrl} alt="The uploaded problem" className="block w-full rounded border border-slate-300 dark:border-slate-700" />
      {components.map((k, i) => {
        if (k.pa === null || k.pb === null) return null;
        const x = ((k.pa.x + k.pb.x) / 2) * 100;
        const y = ((k.pa.y + k.pb.y) / 2) * 100;
        const on = k.id === highlightId;
        return (
          <span
            key={`${k.id}-${i}`}
            data-marker={k.id}
            title={k.id}
            style={{ left: `${x}%`, top: `${y}%` }}
            className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-semibold ${
              on
                ? "z-10 scale-125 border-amber-500 bg-amber-300 text-black"
                : "border-blue-700 bg-white/90 text-blue-900 dark:border-blue-300 dark:bg-slate-900/90 dark:text-blue-100"
            }`}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}
