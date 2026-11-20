import { ComponentType, type Circuit, type Component } from "../../src/core/schema";
import { formatQuantity, parseQuantity, unitFor } from "../../src/core/units";

export type EditableField = "type" | "value" | "a" | "b" | "label";

function mapComponent(circuit: Circuit, id: string, change: (k: Component) => Component): Circuit {
  if (!circuit.components.some((k) => k.id === id)) return circuit;
  return { ...circuit, components: circuit.components.map((k) => (k.id === id ? change(k) : k)) };
}

/** Return a new circuit with one field of one component changed. Invalid text leaves the circuit unchanged. */
export function setField(circuit: Circuit, id: string, field: EditableField, text: string): Circuit {
  switch (field) {
    case "value": {
      const q = parseQuantity(text);
      if (q === null) return circuit;
      return mapComponent(circuit, id, (k) => ({
        ...k,
        value: q.value,
        label: formatQuantity(q.value, unitFor(k.type)),
        uncertain: null,
      }));
    }
    case "a":
    case "b": {
      const node = text.trim();
      if (node === "") return circuit;
      return mapComponent(circuit, id, (k) => ({ ...k, [field]: node }));
    }
    case "type": {
      const parsed = ComponentType.safeParse(text);
      if (!parsed.success) return circuit;
      const type = parsed.data;
      return mapComponent(circuit, id, (k) => ({ ...k, type, label: formatQuantity(k.value, unitFor(type)) }));
    }
    case "label":
      return mapComponent(circuit, id, (k) => ({ ...k, label: text }));
  }
}

/** Add a 1 kΩ resistor between ground and ground, with the first unused id R1, R2, ... */
export function addComponent(circuit: Circuit): Circuit {
  const used = new Set(circuit.components.map((k) => k.id));
  let n = 1;
  while (used.has(`R${n}`)) n += 1;
  const added: Component = {
    id: `R${n}`,
    type: "resistor",
    label: formatQuantity(1000, "ohm"),
    value: 1000,
    a: circuit.ground,
    b: circuit.ground,
    pa: null,
    pb: null,
    uncertain: null,
  };
  return { ...circuit, components: [...circuit.components, added] };
}

export function removeComponent(circuit: Circuit, id: string): Circuit {
  return { ...circuit, components: circuit.components.filter((k) => k.id !== id) };
}

export function setGround(circuit: Circuit, node: string): Circuit {
  return { ...circuit, ground: node };
}
