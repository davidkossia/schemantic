import { describe, expect, it } from "vitest";
import { checkClaim } from "../src/core/checker";
import { Claim, Structure } from "../src/core/schema";
import { renderDrawing } from "../src/core/schematic";
import { validate } from "../src/core/validate";
import { gridToPoint } from "../eval/types";
import { PROBLEMS } from "../eval/problems/index";
import { canonical, key, netlistGroups, terminalGroups, wirePoints } from "./helpers";

describe("problem set", () => {
  it("has 14 problems in id order, 8 single-step and 6 multi-step", () => {
    expect(PROBLEMS.map((p) => p.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`),
    );
    expect(PROBLEMS.filter((p) => !p.multiStep)).toHaveLength(8);
    expect(PROBLEMS.filter((p) => p.multiStep).map((p) => p.id)).toEqual([
      "c09",
      "c10",
      "c11",
      "c12",
      "c13",
      "c14",
    ]);
  });

  for (const p of PROBLEMS) {
    describe(p.id, () => {
      const d = p.drawing;
      if (!d) throw new Error(`${p.id} has no drawing`);
      if (p.truth.kind !== "circuit") throw new Error(`${p.id} is not a circuit`);
      const truth = p.truth;

      it("parses, validates and checks out", () => {
        expect(Structure.safeParse(p.truth).success).toBe(true);
        expect(Claim.safeParse(p.expected).success).toBe(true);
        expect(validate(p.truth)).toEqual([]);
        expect(checkClaim(p.truth, p.expected).verified).toBe(true);
        expect(truth.asked.summary).toBe(p.question);
      });

      it("draws every component once, 2 units long on one axis, with positions from the drawing", () => {
        expect(d.cols).toBe(12);
        expect(d.rows).toBe(8);
        expect(d.components.map((c) => c.id).sort()).toEqual(truth.components.map((c) => c.id).sort());
        for (const c of truth.components) {
          const drawn = d.components.filter((k) => k.id === c.id);
          expect(drawn).toHaveLength(1);
          const k = drawn[0];
          if (!k) throw new Error("missing");
          const dx = Math.abs(k.a[0] - k.b[0]);
          const dy = Math.abs(k.a[1] - k.b[1]);
          expect(dx + dy).toBe(2);
          expect(dx === 0 || dy === 0).toBe(true);
          expect(k.type).toBe(c.type);
          expect(k.label).toBe(c.label);
          expect(c.pa).toEqual(gridToPoint(d, k.a));
          expect(c.pb).toEqual(gridToPoint(d, k.b));
        }
      });

      it("uses only horizontal and vertical wire segments", () => {
        for (const w of d.wires) {
          expect(w.points.length).toBeGreaterThanOrEqual(2);
          w.points.forEach((q, i) => {
            const prev = w.points[i - 1];
            if (prev) expect(prev[0] === q[0] || prev[1] === q[1]).toBe(true);
          });
        }
      });

      it("starts and ends every wire at a component terminal", () => {
        const terminals = new Set(d.components.flatMap((c) => [key(c.a), key(c.b)]));
        for (const w of d.wires) {
          const first = w.points[0];
          const last = w.points[w.points.length - 1];
          if (!first || !last) throw new Error("empty wire");
          expect(terminals.has(key(first))).toBe(true);
          expect(terminals.has(key(last))).toBe(true);
        }
      });

      it("ends a wire at every terminal it reaches and draws a dot where three ends meet", () => {
        const terminals = new Set(d.components.flatMap((c) => [key(c.a), key(c.b)]));
        const ends = new Map<string, number>();
        const add = (k: string, n: number): void => {
          ends.set(k, (ends.get(k) ?? 0) + n);
        };
        for (const w of d.wires) {
          const last = w.points.length - 1;
          w.points.forEach((q, i) => {
            if (i > 0 && i < last) expect(terminals.has(key(q))).toBe(false);
            add(key(q), i === 0 || i === last ? 1 : 2);
          });
          // A wire must not run straight over a terminal it does not end at.
          wirePoints(w.points).forEach((q) => {
            if (terminals.has(key(q))) expect(w.points.map(key)).toContain(key(q));
          });
        }
        for (const c of d.components) {
          add(key(c.a), 1);
          add(key(c.b), 1);
        }
        const dots = [...ends.values()].filter((n) => n >= 3).length;
        const svg = renderDrawing(d, p.style);
        expect(svg.split("data-junction").length - 1).toBe(dots);
      });

      it("joins the same terminals as the netlist", () => {
        expect(canonical(terminalGroups(d))).toEqual(canonical(netlistGroups(truth)));
      });

      it("names each wire for the node of the terminals it touches", () => {
        for (const w of d.wires) {
          const onWire = new Set(wirePoints(w.points).map(key));
          const names: string[] = [];
          for (const c of truth.components) {
            const drawn = d.components.find((k) => k.id === c.id);
            if (!drawn) continue;
            if (onWire.has(key(drawn.a))) names.push(c.a);
            if (onWire.has(key(drawn.b))) names.push(c.b);
          }
          expect(names.length).toBeGreaterThan(0);
          for (const n of names) expect(n).toBe(w.node);
        }
      });

      it("keeps wires out of component bodies and apart from other nodes", () => {
        for (const c of d.components) {
          const mid = key([(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2]);
          for (const w of d.wires) {
            expect(wirePoints(w.points).map(key)).not.toContain(mid);
          }
        }
        for (const [i, w1] of d.wires.entries()) {
          const first = new Set(wirePoints(w1.points).map(key));
          for (const w2 of d.wires.slice(i + 1)) {
            if (w1.node === w2.node) continue;
            const shared = wirePoints(w2.points).map(key).filter((k) => first.has(k));
            expect(shared).toEqual([]);
          }
        }
      });

      it("labels every node and hangs the ground on the bottom wire", () => {
        const nodes = new Set(truth.components.flatMap((c) => [c.a, c.b]));
        nodes.delete(truth.ground);
        expect(d.nodeLabels.map((l) => l.node).sort()).toEqual([...nodes].sort());
        const ground = d.groundAt;
        expect(ground).not.toBeNull();
        if (!ground) return;
        const onGround = d.wires
          .filter((w) => w.node === truth.ground)
          .flatMap((w) => wirePoints(w.points).map(key));
        expect(onGround).toContain(key(ground));
      });

      it("renders without NaN", () => {
        const svg = renderDrawing(d, p.style);
        expect(svg).not.toContain("NaN");
        expect(svg).not.toContain("undefined");
        expect(svg).not.toContain("Infinity");
      });
    });
  }
});
