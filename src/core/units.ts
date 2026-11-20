/**
 * Parse and format SI values and units (4.7k, 10 mA).
 *
 * Every number in code is in SI base units. Prefixes exist only in labels
 * and in formatQuantity output.
 */
import type { ComponentType, Unit } from "./schema";

type ParsedUnit = "ohm" | "V" | "A" | "W";

/** RKM code: 4k7, 4R7, 2M2. The letter is the decimal point and the multiplier. */
const RKM = /^(\d+)([RkKM])(\d+)$/;

/** General form: number, optional prefix, optional unit. */
const GENERAL =
  /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([pnuµμmkKMG]?)\s*(Ω|Ω|ohms?|Ohms?|R|V|A|W)?$/;

const PREFIX_SCALE: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "µ": 1e-6,
  "μ": 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

const UNIT_OF: Record<string, ParsedUnit> = {
  "Ω": "ohm",
  "Ω": "ohm",
  ohm: "ohm",
  ohms: "ohm",
  Ohm: "ohm",
  Ohms: "ohm",
  R: "ohm",
  V: "V",
  A: "A",
  W: "W",
};

/** Output prefixes, smallest first. The empty prefix is 1. */
const PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["p", 1e-12],
  ["n", 1e-9],
  ["µ", 1e-6],
  ["m", 1e-3],
  ["", 1],
  ["k", 1e3],
  ["M", 1e6],
  ["G", 1e9],
];

const SYMBOL: Record<Unit, string> = {
  ohm: "Ω",
  V: "V",
  A: "A",
  W: "W",
  "": "",
};

const UNIT_FOR: Record<ComponentType, Unit> = {
  resistor: "ohm",
  voltage_source: "V",
  current_source: "A",
  unknown: "",
};

/** Parse a printed value such as "4k7", "4.7 kΩ" or "10 mA". Returns null when the text does not match. */
export function parseQuantity(
  text: string,
): { value: number; unit: ParsedUnit | null } | null {
  const t = text.trim();

  const rkm = RKM.exec(t);
  if (rkm) {
    const whole = rkm[1] ?? "";
    const letter = rkm[2] ?? "";
    const frac = rkm[3] ?? "";
    const mult = letter === "M" ? 1e6 : letter === "R" ? 1 : 1e3;
    return { value: Number(`${whole}.${frac}`) * mult, unit: "ohm" };
  }

  const m = GENERAL.exec(t);
  if (!m) return null;
  const num = m[1] ?? "";
  const prefix = m[2] ?? "";
  const unitText = m[3] ?? "";

  const scale = prefix === "" ? 1 : PREFIX_SCALE[prefix];
  if (scale === undefined) return null;
  const unit = unitText === "" ? null : (UNIT_OF[unitText] ?? null);
  return { value: Number(num) * scale, unit };
}

/** Format an SI value with a prefix and 4 significant digits (4700 ohm gives "4.7 kΩ"). */
export function formatQuantity(value: number, unit: Unit): string {
  const symbol = SYMBOL[unit];
  const suffix = unit === "" ? "" : ` ${symbol}`;

  if (value === 0) return `0${suffix}`;

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (unit === "") {
    return sign + String(Number(abs.toPrecision(4)));
  }

  if (abs < 1e-12 || abs >= 1e12) {
    return `${value.toExponential(3)}${suffix}`;
  }

  // Pick the largest prefix whose scale does not exceed the value.
  let index = 0;
  PREFIXES.forEach(([, scale], j) => {
    if (scale <= abs) index = j;
  });
  const entry = PREFIXES[index];
  if (!entry) return `${value.toExponential(3)}${suffix}`;
  let [prefix, scale] = entry;
  let mantissa = Number((abs / scale).toPrecision(4));

  // Rounding can reach 1000 (999.96 gives "1000"). Move up one prefix in that case.
  const next = PREFIXES[index + 1];
  if (mantissa >= 1000 && next) {
    [prefix, scale] = next;
    mantissa = Number((abs / scale).toPrecision(4));
  }

  return `${sign}${mantissa} ${prefix}${symbol}`;
}

/** The unit a component type is printed in. */
export function unitFor(type: ComponentType): Unit {
  return UNIT_FOR[type];
}

/** True when x matches the reference within 1% or 1e-9, whichever is larger. */
export function closeTo(x: number, reference: number): boolean {
  return Math.abs(x - reference) <= Math.max(0.01 * Math.abs(reference), 1e-9);
}
