import type { Claim } from "./schema";
import { formatQuantity } from "./units";

/** One plain line that says what a claim states, such as `V(B) = 8 V`. */
function unitForId(id: string): "V" | "A" | "ohm" {
  const first = id.trim().charAt(0).toUpperCase();
  if (first === "V") return "V";
  if (first === "I") return "A";
  return "ohm";
}

export function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "node_voltage":
      return `V(${claim.node}) = ${formatQuantity(claim.value, "V")}`;
    case "branch_current":
      return `I(${claim.component}) = ${formatQuantity(claim.value, "A")}`;
    case "power":
      return claim.sense === "absorbed"
        ? `P(${claim.component}) = ${formatQuantity(claim.value, "W")}`
        : `P delivered by ${claim.component} = ${formatQuantity(claim.value, "W")}`;
    case "equivalent_resistance":
      return `R(${claim.a}, ${claim.b}) = ${formatQuantity(claim.value, "ohm")}`;
    case "thevenin":
      return `Vth = ${formatQuantity(claim.vth, "V")}, Rth = ${formatQuantity(claim.rth, "ohm")}`;
    case "max_power_transfer":
      return `RL = ${formatQuantity(claim.resistance, "ohm")}, P = ${formatQuantity(claim.power, "W")}`;
    case "component_value_for_condition":
      // The claim carries no component type, so the unit comes from the printed id: V1 is a voltage
      // source, I1 a current source, anything else a resistor.
      return `${claim.component} = ${formatQuantity(claim.value, unitForId(claim.component))}`;
    case "graph_value":
      return `y(${formatQuantity(claim.x, "")}) = ${formatQuantity(claim.value, "")}`;
    case "graph_slope":
      return `slope = ${formatQuantity(claim.value, "")}`;
    case "graph_area":
      return `area = ${formatQuantity(claim.value, "")}`;
    case "graph_extremum":
      return `${claim.which} = ${formatQuantity(claim.value, "")} at x = ${formatQuantity(claim.x, "")}`;
  }
}
