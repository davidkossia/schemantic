import { queryOf } from "../../src/core/schema";
import type { Structure } from "../../src/core/schema";
import { problem } from "../../eval/problems/c09";
import type { ReplayFixture } from "./index";

/** The truth with one misread: R2 is printed 12 kΩ and read as 1.2 kΩ. */
function reading(): Structure {
  const truth = problem.truth;
  if (truth.kind !== "circuit") throw new Error("c09 is a circuit");
  return {
    ...truth,
    components: truth.components.map((c) => (c.id === "R2" ? { ...c, label: "1.2 kΩ", value: 1200 } : c)),
  };
}

export const c09Fixture: ReplayFixture = {
  sample: { id: problem.id, title: problem.title, question: problem.question, imageUrl: "samples/c09.png" },
  reading: reading(),
  query: queryOf(problem.expected),
};
