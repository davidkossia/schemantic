import { useState } from "react";
import type { Circuit, ComponentType, Warning } from "../../../src/core/schema";
import { formatQuantity, unitFor } from "../../../src/core/units";
import { addComponent, removeComponent, setField, setGround, type EditableField } from "../edit";

export type NetlistTableProps = {
  circuit: Circuit;
  warnings: Warning[];
  onChange(c: Circuit): void;
  onHover(id: string | null): void;
};

const TYPES: ComponentType[] = ["resistor", "voltage_source", "current_source", "unknown"];
const input =
  "w-full min-w-16 rounded border border-slate-400 bg-transparent px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600";

function ValueInput({ id, value, type, onCommit }: { id: string; value: number; type: ComponentType; onCommit(text: string): void }) {
  const shown = formatQuantity(value, unitFor(type));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      aria-label={`Value of ${id}`}
      className={input}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function NetlistTable({ circuit, warnings, onChange, onHover }: NetlistTableProps) {
  const edit = (id: string, field: EditableField, text: string): void => onChange(setField(circuit, id, field, text));
  const [ground, setGroundDraft] = useState<string | null>(null);
  const commitGround = (): void => {
    if (ground !== null && ground.trim() !== "") onChange(setGround(circuit, ground.trim()));
    setGroundDraft(null);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="px-1 py-1">#</th>
              <th className="px-1 py-1">Id</th>
              <th className="px-1 py-1">Type</th>
              <th className="px-1 py-1">Value</th>
              <th className="px-1 py-1">A</th>
              <th className="px-1 py-1">B</th>
              <th className="px-1 py-1"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {circuit.components.map((k, i) => {
              const own = warnings.filter((w) => w.componentId === k.id);
              return (
                <RowGroup key={`${k.id}-${i}`}>
                  <tr
                    onMouseEnter={() => onHover(k.id)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(k.id)}
                    onBlur={() => onHover(null)}
                  >
                    <td className="px-1 py-1">{i + 1}</td>
                    <td className="px-1 py-1">{k.id}</td>
                    <td className="px-1 py-1">
                      <select
                        aria-label={`Type of ${k.id}`}
                        className={input}
                        value={k.type}
                        onChange={(e) => edit(k.id, "type", e.target.value)}
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t}>{t.replace("_", " ")}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <ValueInput key={k.value} id={k.id} value={k.value} type={k.type} onCommit={(t) => edit(k.id, "value", t)} />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        key={k.a}
                        aria-label={`Node a of ${k.id}`}
                        className={input}
                        defaultValue={k.a}
                        onBlur={(e) => edit(k.id, "a", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") edit(k.id, "a", e.currentTarget.value);
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        key={k.b}
                        aria-label={`Node b of ${k.id}`}
                        className={input}
                        defaultValue={k.b}
                        onBlur={(e) => edit(k.id, "b", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") edit(k.id, "b", e.currentTarget.value);
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        aria-label={`Remove ${k.id}`}
                        onClick={() => onChange(removeComponent(circuit, k.id))}
                        className="rounded border border-slate-400 px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  {own.map((w, j) => (
                    <tr key={`${w.code}-${j}`}>
                      <td />
                      <td
                        colSpan={6}
                        className={`px-1 pb-1 text-xs ${w.severity === "error" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}
                      >
                        {w.message}
                      </td>
                    </tr>
                  ))}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(addComponent(circuit))}
          className="rounded border border-slate-400 px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-slate-600"
        >
          Add component
        </button>
        <label className="flex items-center gap-2 text-sm">
          Ground
          <input
            className={`${input} w-24`}
            value={ground ?? circuit.ground}
            onChange={(e) => setGroundDraft(e.target.value)}
            onBlur={commitGround}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitGround();
            }}
          />
        </label>
      </div>
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
