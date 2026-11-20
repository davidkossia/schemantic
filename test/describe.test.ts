import { describe, expect, it } from "vitest";
import { describeClaim } from "../src/core/describe";
import type { Claim } from "../src/core/schema";
import { NO_SETUP } from "./helpers";

const rows: [string, Claim, string][] = [
  ["node_voltage", { kind: "node_voltage", node: "B", setup: NO_SETUP, value: 8 }, "V(B) = 8 V"],
  ["branch_current", { kind: "branch_current", component: "R2", setup: NO_SETUP, value: 0.02 }, "I(R2) = 20 mA"],
  ["power absorbed", { kind: "power", component: "R2", sense: "absorbed", setup: NO_SETUP, value: 0.25 }, "P(R2) = 250 mW"],
  [
    "power delivered",
    { kind: "power", component: "V1", sense: "delivered", setup: NO_SETUP, value: 0.05333 },
    "P delivered by V1 = 53.33 mW",
  ],
  ["equivalent_resistance", { kind: "equivalent_resistance", a: "A", b: "gnd", remove: [], value: 4000 }, "R(A, gnd) = 4 kΩ"],
  ["thevenin", { kind: "thevenin", a: "C", b: "gnd", remove: ["RL"], vth: 9, rth: 4000 }, "Vth = 9 V, Rth = 4 kΩ"],
  ["max_power_transfer", { kind: "max_power_transfer", load: "RL", resistance: 2000, power: 0.005556 }, "RL = 2 kΩ, P = 5.556 mW"],
  [
    "component_value_for_condition",
    {
      kind: "component_value_for_condition",
      component: "R2",
      condition: { kind: "node_voltage", target: "B", value: 6 },
      value: 30000,
    },
    "R2 = 30 kΩ",
  ],
  [
    "component_value_for_condition on a source",
    {
      kind: "component_value_for_condition",
      component: "V1",
      condition: { kind: "node_voltage", target: "B", value: 6 },
      value: 12,
    },
    "V1 = 12 V",
  ],
  ["graph_value", { kind: "graph_value", series: "s1", x: 4, value: 8 }, "y(4) = 8"],
  ["graph_slope", { kind: "graph_slope", series: "s1", x1: 0, x2: 2, value: -2 }, "slope = -2"],
  ["graph_area", { kind: "graph_area", series: "s1", x1: 0, x2: 6, value: 36 }, "area = 36"],
  ["graph_extremum", { kind: "graph_extremum", series: "s1", which: "max", x: 4, value: 31 }, "max = 31 at x = 4"],
];

describe("describeClaim", () => {
  it.each(rows)("%s", (_name, claim, text) => {
    expect(describeClaim(claim)).toBe(text);
  });
});
