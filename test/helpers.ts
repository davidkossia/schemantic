import type { Circuit, Component, Setup } from "../src/core/schema";

export function resistor(id: string, value: number, a: string, b: string): Component {
  return { id, type: "resistor", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function vsource(id: string, value: number, a: string, b: string): Component {
  return { id, type: "voltage_source", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function isource(id: string, value: number, a: string, b: string): Component {
  return { id, type: "current_source", label: "", value, a, b, pa: null, pb: null, uncertain: null };
}

export function circuit(components: Component[], ground = "gnd"): Circuit {
  return {
    kind: "circuit",
    components,
    ground,
    asked: { summary: "", target: null },
    notes: null,
  };
}

export const NO_SETUP: Setup = { remove: [], zero: [] };
