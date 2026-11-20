import { describe, expect, it } from "vitest";
import { coreTable, runCore } from "../eval/report";
import { PROBLEMS } from "../eval/problems/index";

describe("core eval", () => {
  const result = runCore(PROBLEMS);

  it("verifies every problem", () => {
    expect(result.verified).toBe(14);
    expect(result.rows.length).toBe(14);
  });

  it("rejects every mutated claim", () => {
    expect(result.mutationsTotal).toBeGreaterThan(0);
    expect(result.mutationsRejected).toBe(result.mutationsTotal);
  });

  it("prints one row per problem and the expected answer for c01", () => {
    const table = coreTable(result);
    const rows = table.split("\n").filter((line) => /^\| c\d{2} /.test(line));
    expect(rows.length).toBe(14);
    const c01 = rows.find((line) => line.startsWith("| c01 "));
    expect(c01).toBeDefined();
    expect(c01).toContain("8 V");
  });
});
