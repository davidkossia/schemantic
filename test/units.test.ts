import { describe, expect, it } from "vitest";
import type { Unit } from "../src/core/schema";
import { closeTo, formatQuantity, parseQuantity, unitFor } from "../src/core/units";

const PARSE_CASES: Array<[string, number, "ohm" | "V" | "A" | "W" | null]> = [
  ["4.7k", 4700, null],
  ["4.7 kΩ", 4700, "ohm"],
  ["4k7", 4700, "ohm"],
  ["1k0", 1000, "ohm"],
  ["4R7", 4.7, "ohm"],
  ["2M2", 2200000, "ohm"],
  ["4700", 4700, null],
  ["220 Ω", 220, "ohm"],
  ["220 Ω", 220, "ohm"],
  ["100R", 100, "ohm"],
  ["10 mA", 0.01, "A"],
  ["2mA", 0.002, "A"],
  ["12 V", 12, "V"],
  ["12V", 12, "V"],
  ["500 mW", 0.5, "W"],
  ["2.2 MΩ", 2200000, "ohm"],
  ["1e3", 1000, null],
  ["-5 V", -5, "V"],
  ["3 µA", 0.000003, "A"],
  ["  1 kΩ  ", 1000, "ohm"],
];

const NULL_CASES = ["", "RL", "abc", "4.7 kX", "k", "1 2"];

const FORMAT_CASES: Array<[number, Unit, string]> = [
  [4700, "ohm", "4.7 kΩ"],
  [30000, "ohm", "30 kΩ"],
  [1000000, "ohm", "1 MΩ"],
  [0.002, "A", "2 mA"],
  [0.00142857, "A", "1.429 mA"],
  [0.0533333, "W", "53.33 mW"],
  [12, "V", "12 V"],
  [0, "V", "0 V"],
  [-2, "", "-2"],
  [8, "", "8"],
];

describe("parseQuantity", () => {
  it.each(PARSE_CASES)("parses %s", (text, value, unit) => {
    const r = parseQuantity(text);
    expect(r).not.toBeNull();
    expect((r?.value ?? NaN) / value).toBeCloseTo(1, 9);
    expect(r?.unit).toBe(unit);
  });

  it.each(NULL_CASES)("returns null for %j", (text) => {
    expect(parseQuantity(text)).toBeNull();
  });
});

describe("formatQuantity", () => {
  it.each(FORMAT_CASES)("formats %s %s as %j", (value, unit, out) => {
    expect(formatQuantity(value, unit)).toBe(out);
  });

  it.each(FORMAT_CASES.filter(([, unit]) => unit !== ""))(
    "round-trips %s %s through parseQuantity",
    (value, unit) => {
      const r = parseQuantity(formatQuantity(value, unit));
      expect(r).not.toBeNull();
      expect(closeTo(r?.value ?? NaN, value)).toBe(true);
    },
  );

  it("uses exponent form below the prefix range", () => {
    expect(formatQuantity(1e-13, "A")).toBe("1.000e-13 A");
  });

  it("uses exponent form above the prefix range", () => {
    expect(formatQuantity(3e12, "V")).toBe("3.000e+12 V");
  });
});

describe("unitFor", () => {
  it("maps each component type to its unit", () => {
    expect(unitFor("resistor")).toBe("ohm");
    expect(unitFor("voltage_source")).toBe("V");
    expect(unitFor("current_source")).toBe("A");
    expect(unitFor("unknown")).toBe("");
  });
});

describe("closeTo", () => {
  it("accepts a value within 1% of the reference", () => {
    expect(closeTo(8.05, 8)).toBe(true);
  });

  it("rejects a value more than 1% away", () => {
    expect(closeTo(8.1, 8)).toBe(false);
  });

  it("accepts zero against zero", () => {
    expect(closeTo(0, 0)).toBe(true);
  });

  it("accepts a tiny value against zero within 1e-9", () => {
    expect(closeTo(1e-10, 0)).toBe(true);
  });
});
