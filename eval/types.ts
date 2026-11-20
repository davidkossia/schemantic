import type { Circuit, Claim, Component, ComponentType, Point, Structure } from "../src/core/schema";
import type { Drawing, GridPoint, Style } from "../src/core/schematic";

/** One eval problem: the question, the ground truth, the expected answer and, for circuits, the drawing. */
export type Problem = {
  id: string;
  title: string; // short: "Voltage divider"
  question: string; // exact text from PROBLEMS.md
  truth: Structure; // ground truth, with pa and pb filled from the drawing
  expected: Claim; // exact claim from PROBLEMS.md
  multiStep: boolean; // c09 to c14 are true
  drawing: Drawing | null; // circuits only
  style: Style;
  formula: string; // the closed form from PROBLEMS.md
};

/** Every circuit drawing uses this grid. WP-20 inverts the position mapping with these numbers. */
export const GRID_COLS = 12;
export const GRID_ROWS = 8;

/**
 * Where a grid point sits in the image, as a fraction of it.
 * The renderer adds a one-unit margin on every side, so the image is (cols + 2) by (rows + 2) units.
 */
export function gridToPoint(d: Pick<Drawing, "cols" | "rows">, p: GridPoint): Point {
  return { x: (p[0] + 1) / (d.cols + 2), y: (p[1] + 1) / (d.rows + 2) };
}

/** A component as the reader would print it, with no positions yet. */
export function part(
  id: string,
  type: ComponentType,
  label: string,
  value: number,
  a: string,
  b: string,
): Component {
  return { id, type, label, value, a, b, pa: null, pb: null, uncertain: null };
}

/** Copy a circuit and fill `pa` and `pb` of every component from the drawing. Throws when a component is not drawn. */
export function positioned(circuit: Circuit, drawing: Drawing): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      const drawn = drawing.components.find((k) => k.id === c.id);
      if (!drawn) throw new Error(`Component ${c.id} is not in the drawing`);
      return { ...c, pa: gridToPoint(drawing, drawn.a), pb: gridToPoint(drawing, drawn.b) };
    }),
  };
}
