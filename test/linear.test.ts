import { describe, expect, it } from "vitest";
import { solveLinear } from "../src/core/linear";

describe("solveLinear", () => {
  it("solves a 2x2 system", () => {
    const x = solveLinear([[2, 1], [1, 3]], [5, 10]);
    expect(x).not.toBeNull();
    expect(x?.[0]).toBeCloseTo(1, 12);
    expect(x?.[1]).toBeCloseTo(3, 12);
  });

  it("swaps rows when the first pivot is zero", () => {
    const x = solveLinear([[0, 1], [2, 0]], [3, 4]);
    expect(x).not.toBeNull();
    expect(x?.[0]).toBeCloseTo(2, 12);
    expect(x?.[1]).toBeCloseTo(3, 12);
  });

  it("returns null for a singular matrix", () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  it("returns [] for the empty system", () => {
    expect(solveLinear([], [])).toEqual([]);
  });

  it("does not change its inputs", () => {
    const A = [[0, 1], [2, 0]];
    const b = [3, 4];
    solveLinear(A, b);
    expect(A).toEqual([[0, 1], [2, 0]]);
    expect(b).toEqual([3, 4]);
  });
});
