/**
 * Eval runner. Only the core mode (no API key) exists so far.
 *
 * Usage: npm run eval -- --core
 */
import { PROBLEMS } from "./problems/index";
import { coreTable, runCore } from "./report";

const args = process.argv.slice(2);
const other = args.filter((a) => a !== "--core");

if (other.length > 0) {
  console.log("Live modes arrive in WP-30.");
  process.exit(2);
}

if (!args.includes("--core")) {
  console.log("Usage: npm run eval -- --core");
  process.exit(2);
}

const result = runCore(PROBLEMS);
console.log(coreTable(result));

const allVerified = result.verified === result.rows.length;
const allRejected = result.mutationsRejected === result.mutationsTotal;
process.exit(allVerified && allRejected ? 0 : 1);
