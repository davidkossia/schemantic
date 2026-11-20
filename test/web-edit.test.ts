import { describe, expect, it } from "vitest";
import { addComponent, removeComponent, setField, setGround } from "../web/src/edit";
import { validate } from "../src/core/validate";
import { circuit, resistor, vsource } from "./helpers";
import type { Circuit } from "../src/core/schema";

// The c01 replay reading: R2 printed as "2 kΩ" but read as 200.
function c01Reading(): Circuit {
  return circuit([
    { ...vsource("V1", 12, "A", "gnd"), label: "12 V" },
    { ...resistor("R1", 1000, "A", "B"), label: "1 kΩ" },
    { ...resistor("R2", 200, "B", "gnd"), label: "2 kΩ", uncertain: "digit unclear" },
  ]);
}

const copy = <T,>(x: T): T => structuredClone(x);

describe("setField", () => {
  it("fixes R2 with 2k and clears the warning", () => {
    const c = c01Reading();
    expect(validate(c).some((w) => w.componentId === "R2")).toBe(true);
    const next = setField(c, "R2", "value", "2k");
    const r2 = next.components.find((k) => k.id === "R2");
    expect(r2?.value).toBe(2000);
    expect(r2?.label).toBe("2 kΩ");
    expect(r2?.uncertain).toBeNull();
    expect(validate(next)).toEqual([]);
  });

  it("returns the circuit unchanged for unparsable text", () => {
    const c = c01Reading();
    expect(setField(c, "R2", "value", "abc")).toBe(c);
  });

  it("re-formats the label when the type changes", () => {
    const c = circuit([resistor("R1", 12, "A", "gnd")]);
    const next = setField(c, "R1", "type", "voltage_source");
    expect(next.components[0]).toMatchObject({ type: "voltage_source", label: "12 V" });
  });

  it("trims node names and ignores empty ones", () => {
    const c = c01Reading();
    expect(setField(c, "R1", "b", "  N2 ").components[1]?.b).toBe("N2");
    expect(setField(c, "R1", "a", "   ")).toBe(c);
  });

  it("sets the label text", () => {
    expect(setField(c01Reading(), "R1", "label", "1k").components[1]?.label).toBe("1k");
  });
});

describe("structure edits", () => {
  it("addComponent twice gives unused, distinct ids", () => {
    const c = circuit([resistor("R1", 1, "A", "gnd"), resistor("R3", 1, "A", "gnd")]);
    const next = addComponent(addComponent(c));
    const ids = next.components.map((k) => k.id);
    expect(ids).toEqual(["R1", "R3", "R2", "R4"]);
    expect(next.components[2]).toMatchObject({ value: 1000, a: "gnd", b: "gnd", pa: null, pb: null });
  });

  it("removeComponent removes exactly one", () => {
    const next = removeComponent(c01Reading(), "R1");
    expect(next.components.map((k) => k.id)).toEqual(["V1", "R2"]);
  });

  it("setGround changes ground", () => {
    expect(setGround(c01Reading(), "B").ground).toBe("B");
  });

  it("no function mutates its input", () => {
    const c = c01Reading();
    const before = copy(c);
    setField(c, "R2", "value", "2k");
    setField(c, "R2", "type", "current_source");
    setField(c, "R2", "a", "X");
    addComponent(c);
    removeComponent(c, "R1");
    setGround(c, "B");
    expect(c).toEqual(before);
  });
});
