import { queryOf } from "../../src/core/schema";
import type { Structure } from "../../src/core/schema";
import { problem } from "../../eval/problems/c01";
import type { ReplayFixture } from "./index";

/** The truth with one misread: R2 keeps its "2 kΩ" label but reads as 20000 ohms. */
function reading(): Structure {
  const truth = problem.truth;
  if (truth.kind !== "circuit") throw new Error("c01 is a circuit");
  return {
    ...truth,
    components: truth.components.map((c) => (c.id === "R2" ? { ...c, value: 20000 } : c)),
  };
}

export const c01Fixture: ReplayFixture = {
  sample: { id: problem.id, title: problem.title, question: problem.question, imageUrl: "samples/c01.png" },
  reading: reading(),
  query: queryOf(problem.expected),
};
