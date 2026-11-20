import { all, create, type MathNode } from "mathjs";
import { z } from "zod";
import { applyChanges, solveCircuit } from "./mna";
import { Claim, ComponentType } from "./schema";
import type { Circuit, Structure } from "./schema";

export const Change = z.object({
  op: z.enum(["set_value", "remove", "zero", "add"]),
  id: z.string(),
  type: ComponentType.nullable(), // for "add"
  value: z.number().nullable(), // for "set_value" and "add"
  a: z.string().nullable(), // for "add"
  b: z.string().nullable(), // for "add"
});
export type Change = z.infer<typeof Change>;

export type ToolOutput = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export type ToolRunner = {
  run(name: string, input: unknown): ToolOutput;   // validates input with zod; never throws
  claim(): { claim: Claim; explanation: string } | null;  // the last accepted submit_answer
};

const SolveInput = z.object({ changes: z.array(Change) });
const EvaluateInput = z.object({ expression: z.string() });
const GraphQueryInput = z.object({
  op: z.enum(["value", "slope", "area", "extremum"]),
  series: z.string(),
  x1: z.number().nullable(),
  x2: z.number().nullable(),
  which: z.enum(["max", "min"]).nullable(),
});
const SubmitInput = z.object({ claim: Claim, explanation: z.string() });

export const TOOL_SPECS: { name: string; description: string; input: z.ZodType }[] = [
  {
    name: "solve_circuit",
    description:
      "Solves the approved circuit, optionally with changes applied, and returns every node voltage in volts and every component's voltage, current and power. " +
      "The approved circuit never changes between calls: each call starts from the original, so list every change you want each time. " +
      "Current is in amps and flows from terminal a to terminal b through the component. Power is in watts and is absorbed power, so a source that delivers power has negative power.",
    input: SolveInput,
  },
  {
    name: "evaluate",
    description:
      "Evaluates one arithmetic expression such as \"12 * 2000 / (1000 + 2000)\" and returns a plain number. " +
      "Use it for arithmetic instead of computing by hand. It supports operators, parentheses and math functions such as sqrt, and takes no variables or units.",
    input: EvaluateInput,
  },
  {
    name: "graph_query",
    description:
      "Reads a value from a series of the approved graph. Use op value with x1 for y at x1, slope or area with x1 and x2, and extremum with which. " +
      "Values use the graph's own axis units. Set the fields an op does not use to null.",
    input: GraphQueryInput,
  },
  {
    name: "submit_answer",
    description:
      "Submits your final answer as a claim: the quantity you computed plus its number or numbers. Use it once you have worked the answer out. " +
      "Give values in SI base units (volts, amps, watts, ohms). A later accepted call replaces an earlier one.",
    input: SubmitInput,
  },
];

if (!all) throw new Error("mathjs factories are missing.");
const math = create(all);
const mathParse = math.parse.bind(math);
{
  const blocked = (): never => {
    throw new Error("This function is disabled.");
  };
  math.import(
    {
      import: blocked,
      createUnit: blocked,
      evaluate: blocked,
      parse: blocked,
      simplify: blocked,
      derivative: blocked,
      resolve: blocked,
      config: blocked,
    },
    { override: true },
  );
}

// `evaluate` takes model output, so it accepts scalar arithmetic only. Anything else (matrices, units,
// assignments, property access, strings, config) is rejected before it runs. This keeps every call
// O(1) in its 200 characters and stops one call from changing the shared instance for later calls.
const ALLOWED_FUNCTIONS = new Set([
  "sqrt", "cbrt", "abs", "exp", "log", "log10", "log2", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "pow", "min", "max", "round", "floor", "ceil", "sign", "nthRoot", "hypot", "mod",
]);
const ALLOWED_SYMBOLS = new Set(["pi", "e", "tau"]);
// A tree parsed from 200 characters has far fewer nodes; more means a shared subtree.
const MAX_NODES = 400;
const ALLOWED_OPERATORS = new Set(["add", "subtract", "multiply", "divide", "pow", "unaryMinus", "unaryPlus", "mod"]);

/** Counts nodes depth first and stops as soon as the count passes MAX_NODES, so a shared subtree costs O(MAX_NODES). */
function withinNodeLimit(root: MathNode): boolean {
  let count = 0;
  const stack: MathNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    count += 1;
    if (count > MAX_NODES) return false;
    node.forEach((child) => {
      stack.push(child);
    });
  }
  return true;
}

function disallowed(node: MathNode): string | null {
  if (math.isConstantNode(node)) {
    return typeof node.value === "number" ? null : "Only numbers are allowed.";
  }
  if (math.isParenthesisNode(node)) return disallowed(node.content);
  if (math.isSymbolNode(node)) {
    return ALLOWED_SYMBOLS.has(node.name) ? null : `Unknown name "${node.name}". Variables and units are not supported.`;
  }
  let args: MathNode[];
  if (math.isOperatorNode(node)) {
    if (!ALLOWED_OPERATORS.has(node.fn)) return `The operator "${node.op}" is not allowed.`;
    args = node.args;
  } else if (math.isFunctionNode(node)) {
    if (!math.isSymbolNode(node.fn) || !ALLOWED_FUNCTIONS.has(node.fn.name)) {
      return "That function is not allowed. Use plain arithmetic and functions such as sqrt, abs, exp, log and sin.";
    }
    args = node.args;
  } else {
    return "Only arithmetic on numbers is allowed.";
  }
  for (const arg of args) {
    const reason = disallowed(arg);
    if (reason) return reason;
  }
  return null;
}

function evaluateExpression(expression: string): ToolOutput {
  if (expression.length > 200) return { ok: false, error: "The expression is longer than 200 characters." };
  // mathjs parses "%" by parsing the next term twice (exponential in nesting) and turns "x + y%" into
  // a tree that shares x (exponential to compile). Both run before or past the allowlist, so reject "%".
  if (expression.includes("%")) {
    return { ok: false, error: "Use mod(a, b) for remainders and decimals for percentages." };
  }
  let value: unknown;
  try {
    const node = mathParse(expression);
    if (!withinNodeLimit(node)) return { ok: false, error: "The expression is too complex." };
    const reason = disallowed(node);
    if (reason) return { ok: false, error: reason };
    value = node.compile().evaluate({});
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The expression could not be evaluated." };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "The expression must evaluate to a finite number." };
  }
  return { ok: true, value };
}

function circuitNodes(c: Circuit): Set<string> {
  const nodes = new Set<string>([c.ground]);
  for (const comp of c.components) {
    nodes.add(comp.a);
    nodes.add(comp.b);
  }
  return nodes;
}

/** Returns an error message when the claim names something the structure does not have. */
function checkNames(structure: Structure, claim: Claim): string | null {
  if (structure.kind === "circuit") {
    const nodes = circuitNodes(structure);
    const ids = new Set(structure.components.map((comp) => comp.id));
    const node = (n: string): string | null => (nodes.has(n) ? null : `Node ${n} does not exist.`);
    const comp = (id: string): string | null => (ids.has(id) ? null : `Component ${id} does not exist.`);
    const allComps = (list: string[]): string | null => {
      for (const id of list) {
        const m = comp(id);
        if (m) return m;
      }
      return null;
    };
    switch (claim.kind) {
      case "node_voltage":
        return node(claim.node) ?? allComps(claim.setup.remove) ?? allComps(claim.setup.zero);
      case "branch_current":
      case "power":
        return comp(claim.component) ?? allComps(claim.setup.remove) ?? allComps(claim.setup.zero);
      case "equivalent_resistance":
      case "thevenin":
        return node(claim.a) ?? node(claim.b) ?? allComps(claim.remove);
      case "max_power_transfer":
        return comp(claim.load);
      case "component_value_for_condition": {
        const t = claim.condition.kind === "node_voltage" ? node(claim.condition.target) : comp(claim.condition.target);
        return comp(claim.component) ?? t;
      }
      default:
        return "This claim is about a graph, but the approved structure is a circuit.";
    }
  }
  const series = new Set(structure.series.map((s) => s.id));
  switch (claim.kind) {
    case "graph_value":
    case "graph_slope":
    case "graph_area":
    case "graph_extremum":
      return series.has(claim.series) ? null : `Series ${claim.series} does not exist.`;
    default:
      return "This claim is about a circuit, but the approved structure is a graph.";
  }
}

export function createToolRunner(structure: Structure): ToolRunner {
  let stored: { claim: Claim; explanation: string } | null = null;

  function dispatch(name: string, input: unknown): ToolOutput {
    const spec = TOOL_SPECS.find((s) => s.name === name);
    if (!spec) return { ok: false, error: `Unknown tool: ${name}.` };
    const parsed = spec.input.safeParse(input);
    if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.message}` };
    switch (name) {
      case "solve_circuit": {
        if (structure.kind !== "circuit") return { ok: false, error: "solve_circuit needs a circuit, but the approved structure is a graph." };
        const { changes } = SolveInput.parse(parsed.data);
        const applied = applyChanges(structure, changes);
        if (!applied.ok) return { ok: false, error: applied.error.message };
        const solved = solveCircuit(applied.value);
        if (!solved.ok) return { ok: false, error: solved.error.message };
        return { ok: true, nodeVoltages: solved.value.nodeVoltages, components: solved.value.components };
      }
      case "evaluate":
        return evaluateExpression(EvaluateInput.parse(parsed.data).expression);
      case "graph_query":
        if (structure.kind !== "graph") return { ok: false, error: "graph_query needs a graph, but the approved structure is a circuit." };
        return { ok: false, error: "not implemented" };
      default: {
        const { claim, explanation } = SubmitInput.parse(parsed.data);
        const problem = checkNames(structure, claim);
        if (problem) return { ok: false, error: problem };
        stored = { claim, explanation };
        return { ok: true };
      }
    }
  }

  return {
    run(name, input) {
      try {
        return dispatch(name, input);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "The tool failed." };
      }
    },
    claim() {
      return stored;
    },
  };
}
