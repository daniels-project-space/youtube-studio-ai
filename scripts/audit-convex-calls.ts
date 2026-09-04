/**
 * CONVEX CALL AUDIT — find per-item calls that could be one call.
 *
 * Reducing provider and database traffic is worth doing and easy to do badly.
 * The dangerous version is batching a claim: several call sites in this
 * codebase issue one mutation per item precisely BECAUSE each one is a lease
 * protecting at-most-once paid work, and collapsing those would trade
 * correctness for a smaller bill. Sequencing there is the feature.
 *
 * So this reports rather than prescribes, and separates the two cases:
 *
 *   QUERY IN A LOOP      almost always safe to hoist or batch. A read has no
 *                        durability semantics, and N reads of the same shape
 *                        are the classic N+1.
 *   MUTATION IN A LOOP   look before touching. Named claim/complete/fail/record
 *                        mutations are lease boundaries; anything else may
 *                        genuinely be a batch waiting to happen.
 *
 * Counting is static and deliberately conservative: a call is "in a loop" only
 * when it is lexically inside a for/while/forEach/map body in the same
 * function. That misses calls hidden behind a helper, which is the right
 * direction to be wrong in — a report that overstates gets ignored, and this
 * one is meant to be acted on.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

/** Mutation names whose per-item shape is a durability boundary, not waste. */
const LEASE = /(claim|complete|fail|reserve|record|mark|release|heartbeat|lease|ambiguous)/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Finding { file: string; line: number; kind: "query" | "mutation"; name: string; lease: boolean }

function main(): void {
  const findings: Finding[] = [];

  for (const file of walk(join(ROOT, "src"))) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    if (!text.includes(".query(") && !text.includes(".mutation(")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node, loopDepth: number): void => {
      const isLoop =
        ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) ||
        ts.isWhileStatement(node) || ts.isDoStatement(node);
      // .map/.forEach callbacks are loops in every sense that matters here.
      const isIterCallback =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        /^(map|forEach|flatMap)$/.test(node.expression.name.text);

      const depth = loopDepth + (isLoop || isIterCallback ? 1 : 0);

      if (depth > 0 && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "query" || method === "mutation") {
          // The Convex function reference is the first argument, e.g.
          // api.contentPlan.claimPlanItem — take its last segment as the name.
          const first = node.arguments[0];
          const name = first ? first.getText(sf).split(".").pop() ?? "?" : "?";
          findings.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            kind: method as "query" | "mutation",
            name,
            lease: LEASE.test(name),
          });
        }
      }
      node.forEachChild((child) => visit(child, depth));
    };
    visit(sf, 0);
  }

  const queries = findings.filter((f) => f.kind === "query");
  const batchable = findings.filter((f) => f.kind === "mutation" && !f.lease);
  const leases = findings.filter((f) => f.kind === "mutation" && f.lease);

  console.log("=== QUERIES INSIDE A LOOP — usually safe to hoist or batch ===");
  for (const f of queries) console.log(`  ${f.file}:${f.line}  ${f.name}`);
  console.log(`  (${queries.length})\n`);

  console.log("=== MUTATIONS INSIDE A LOOP, NOT LEASE-SHAPED — look here first ===");
  for (const f of batchable) console.log(`  ${f.file}:${f.line}  ${f.name}`);
  console.log(`  (${batchable.length})\n`);

  console.log("=== LEASE-SHAPED MUTATIONS IN A LOOP — leave alone unless proven safe ===");
  const byName = new Map<string, number>();
  for (const f of leases) byName.set(f.name, (byName.get(f.name) ?? 0) + 1);
  for (const [name, count] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${name}`);
  }
  console.log(`  (${leases.length} — these protect at-most-once paid work)`);
}

main();
