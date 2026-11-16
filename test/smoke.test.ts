import { describe, expect, it } from "vitest";
import { evaluate } from "mathjs";

describe("toolchain", () => {
  it("runs vitest and resolves mathjs", () => {
    expect(evaluate("2 + 2")).toBe(4);
  });
});
