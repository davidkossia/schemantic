import type { Circuit } from "../../src/core/schema";
import { circuit, isource, resistor, vsource } from "../helpers";

export const CIRCUITS: Record<string, Circuit> = {
  c01: circuit([vsource("V1", 12, "A", "gnd"), resistor("R1", 1000, "A", "B"), resistor("R2", 2000, "B", "gnd")]),
  c02: circuit([
    vsource("V1", 9, "A", "gnd"),
    resistor("R1", 100, "A", "B"),
    resistor("R2", 220, "B", "C"),
    resistor("R3", 130, "C", "gnd"),
  ]),
  c03: circuit([
    vsource("V1", 10, "A", "gnd"),
    resistor("R1", 50, "A", "B"),
    resistor("R2", 100, "B", "gnd"),
    resistor("R3", 100, "B", "gnd"),
  ]),
  c04: circuit([isource("I1", 0.002, "A", "gnd"), resistor("R1", 1000, "A", "gnd"), resistor("R2", 3000, "A", "gnd")]),
  c05: circuit([
    vsource("V1", 16, "A", "gnd"),
    resistor("R1", 1000, "A", "B"),
    resistor("R2", 2000, "B", "gnd"),
    resistor("R3", 1000, "B", "C"),
    resistor("R4", 1000, "C", "gnd"),
  ]),
  c06: circuit([
    vsource("V1", 10, "A", "gnd"),
    resistor("R1", 1000, "A", "B"),
    resistor("R2", 2000, "B", "gnd"),
    resistor("R3", 2000, "A", "C"),
    resistor("R4", 1000, "C", "gnd"),
    resistor("R5", 1000, "B", "C"),
  ]),
  c07: circuit([
    vsource("V1", 12, "A", "gnd"),
    resistor("R1", 2000, "A", "B"),
    resistor("R2", 2000, "B", "gnd"),
    isource("I1", 0.003, "B", "gnd"),
  ]),
  c08: circuit([
    vsource("V1", 10, "A", "gnd"),
    resistor("R1", 1000, "A", "B"),
    resistor("R3", 1000, "B", "gnd"),
    resistor("R2", 1000, "B", "C"),
    vsource("V2", 4, "C", "gnd"),
  ]),
  c09: circuit([
    vsource("V1", 12, "A", "gnd"),
    resistor("R1", 4000, "A", "B"),
    resistor("R2", 12000, "B", "gnd"),
    resistor("R3", 1000, "B", "C"),
    resistor("RL", 2000, "C", "gnd"),
  ]),
  c10: circuit([
    vsource("V1", 20, "A", "gnd"),
    resistor("R1", 6000, "A", "B"),
    resistor("R2", 3000, "B", "gnd"),
    resistor("RL", 1000, "B", "gnd"),
  ]),
  c11: circuit([
    vsource("V1", 15, "A", "gnd"),
    resistor("R1", 10000, "A", "B"),
    resistor("R2", 10000, "B", "gnd"),
    resistor("R3", 30000, "B", "gnd"),
  ]),
  c12: circuit([
    vsource("V1", 18, "A", "gnd"),
    resistor("R1", 3000, "A", "B"),
    resistor("R2", 6000, "B", "gnd"),
    isource("I1", 0.002, "B", "gnd"),
  ]),
  c13: circuit([
    vsource("V1", 8, "A", "gnd"),
    resistor("R1", 1000, "A", "B"),
    resistor("R2", 6000, "B", "gnd"),
    resistor("R3", 2000, "B", "C"),
    resistor("R4", 4000, "C", "gnd"),
  ]),
  c14: circuit([
    vsource("V1", 24, "A", "gnd"),
    resistor("R1", 2000, "A", "B"),
    resistor("R2", 4000, "B", "gnd"),
    resistor("R3", 1000, "B", "gnd"),
  ]),
};
