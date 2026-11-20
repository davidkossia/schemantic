export type ModeBadgeProps = { mode: "live" | "replay" | null; connected: boolean };

export function ModeBadge({ mode, connected }: ModeBadgeProps) {
  const label = !connected ? "Disconnected" : mode === "live" ? "Live" : mode === "replay" ? "Replay" : "Connecting";
  return <span role="status" className="rounded border px-2 py-0.5 text-sm">{label}</span>;
}
