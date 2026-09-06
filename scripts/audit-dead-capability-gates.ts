/**
 * DEAD-CAPABILITY AUDIT — find features gated on a capability that is always off.
 *
 * `hasGeminiKey()` returns `false` unconditionally: "Generic Gemini is
 * intentionally unavailable." That is a legitimate policy decision. What was not
 * legitimate is that thirteen sites still branched on it, and nobody had gone
 * back to see what those branches now did:
 *
 *   gateClip           returned {relevant:true, score:8} for EVERY b-roll clip,
 *                      on every run, without judging one — a complete, working
 *                      relevance gate whose body already ran on the sanctioned
 *                      vision route, disabled by a stale guard above it.
 *   buildFootageQueries lost its whole generation branch, so the script's SECTION
 *                      HEADINGS went to stock search as queries.
 *   distillScriptPlaybook threw on every call, blocking Channel Inception for ten
 *                      of the eleven families.
 *   hasFootagecraft    returned false always, so anything gating on it would have
 *                      silently disabled stock footage entirely.
 *
 * None of that failed a test. A dead capability gate is invisible: the code
 * compiles, the branch is taken every time, and the taken branch is usually a
 * polite fallback.
 *
 * WHAT THIS FINDS
 *
 * 1. Capability predicates whose body is a single unconditional `return true` or
 *    `return false` — the shape of a policy switch that has been thrown.
 * 2. Every site that branches on one, classified by what the dead branch DOES:
 *
 *      THROWS            the feature is not degraded, it is broken. Anything
 *                        reaching it fails the run.
 *      RETURNS CONSTANT  a fallback verdict. If the function is a GATE, this is
 *                        the dangerous one: it passes without judging.
 *      SKIPS             an early return with no work done.
 *      BRANCH DEAD       the guarded block simply never executes.
 *
 * A finding is not automatically a defect. seoReoptimize's gate sits behind an
 * unconditional attribution containment and is unreachable on purpose — the
 * right answer there was to document it, not to port it. The output is a list of
 * questions, and the question is: given this capability is off forever, is the
 * branch that always runs the one you would have chosen?
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Predicates whose body is exactly `return true;` or `return false;`. */
function constantPredicates(files: readonly string[]): Map<string, { value: boolean; where: string }> {
  const found = new Map<string, { value: boolean; where: string }>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!/:\s*boolean\s*\{/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const statements = node.body.statements;
        const only = statements.length === 1 ? statements[0] : undefined;
        if (only && ts.isReturnStatement(only) && only.expression) {
          const kind = only.expression.kind;
          if (kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword) {
            found.set(node.name.getText(sf), {
              value: kind === ts.SyntaxKind.TrueKeyword,
              where: `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return found;
}

type Effect = "THROWS" | "RETURNS CONSTANT" | "SKIPS" | "BRANCH DEAD";

interface Finding { file: string; line: number; predicate: string; effect: Effect; detail: string }

/**
 * What the branch that ALWAYS runs actually does.
 *
 * `!hasX()` with the predicate false means the guarded block always runs;
 * a bare `hasX()` means the guarded block never does.
 */
function classify(guarded: ts.Statement | undefined, sf: ts.SourceFile, negated: boolean, always: boolean): { effect: Effect; detail: string } {
  if (!always) return { effect: "BRANCH DEAD", detail: "the guarded block never executes" };
  const text = guarded?.getText(sf) ?? "";
  const compact = text.replace(/\s+/g, " ").slice(0, 96);
  if (/\bthrow\b/.test(text)) return { effect: "THROWS", detail: compact };
  const returned = /return\s+([^;]+);/.exec(text);
  if (returned) {
    return {
      effect: /^\s*(\{|true|false|null|undefined|\[\])/.test(returned[1]!) ? "RETURNS CONSTANT" : "SKIPS",
      detail: compact,
    };
  }
  void negated;
  return { effect: "SKIPS", detail: compact || "(empty)" };
}

function main(): void {
  const files = walk(join(ROOT, "src"));
  const predicates = constantPredicates(files);
  const findings: Finding[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (![...predicates.keys()].some((name) => text.includes(`${name}(`))) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIfStatement(node)) {
        let expression = node.expression;
        let negated = false;
        if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
          negated = true;
          expression = expression.operand;
        }
        // `!hasX() || !hasY()` — take the first constant predicate in the chain.
        const names: string[] = [];
        const gather = (current: ts.Node): void => {
          if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) names.push(current.expression.text);
          current.forEachChild(gather);
        };
        gather(node.expression);
        const name = names.find((candidate) => predicates.has(candidate));
        if (name) {
          const predicate = predicates.get(name)!;
          // The guarded block always runs when the predicate's constant value,
          // after any negation, is true.
          const always = negated ? !predicate.value : predicate.value;
          const { effect, detail } = classify(node.thenStatement, sf, negated, always);
          findings.push({
            file: relative(ROOT, file),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            predicate: `${name}() === ${predicate.value}`,
            effect,
            detail,
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }

  const order: Effect[] = ["THROWS", "RETURNS CONSTANT", "SKIPS", "BRANCH DEAD"];
  findings.sort((a, b) => order.indexOf(a.effect) - order.indexOf(b.effect) || a.file.localeCompare(b.file));

  console.log("capability predicates hard-wired to a constant:");
  for (const [name, meta] of predicates) console.log(`  ${name}() === ${meta.value}   (${meta.where})`);
  console.log(`\nbranches decided by one of them: ${findings.length}\n`);
  let current = "";
  for (const f of findings) {
    if (f.effect !== current) {
      current = f.effect;
      console.log(`  --- ${f.effect} ---`);
    }
    console.log(`  ${f.file}:${f.line}  [${f.predicate}]\n        ${f.detail}`);
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nTRIAGE of the current 13, so the next reader starts from here:\n` +
      `  FIXED     gateClip (returned relevant:true score:8 for every clip ever cast; its\n` +
      `            body already ran on the sanctioned vision route, only the guard was stale),\n` +
      `            buildFootageQueries (section headings were going to stock search as\n` +
      `            queries), hasFootagecraft (always false; anything gating on it would have\n` +
      `            silently disabled stock footage).\n` +
      `  BLOCKED   scriptLab.distillScriptPlaybook — a real capability gap, not a missing\n` +
      `            key: it must WATCH reference video. Blocks Channel Inception for ten of\n` +
      `            eleven families. Documented at the site; needs a product decision.\n` +
      `  CORRECT   seoReoptimize sits behind an unconditional attribution containment and is\n` +
      `            unreachable ON PURPOSE — titleCtrSwap.ts says "this must not route around\n` +
      `            it". The right action there was to document, not to port.\n` +
      `  CORRECT   cinecraft (5 sites), embeddings, mastra, clipAnalysis, renderWatch,\n` +
      `            speechSource, speechThumbnail — deliberate compatibility surfaces, each\n` +
      `            explained at its predicate. None of their functions has a live caller.\n` +
      `\nTHROWS is the one to read first: that feature is not degraded, it is broken\n` +
      `for anything that reaches it. RETURNS CONSTANT matters most when the function\n` +
      `is a GATE — gateClip returned "relevant, score 8" for every clip ever cast.\n` +
      `A finding is a question: given this capability is off for good, is the branch\n` +
      `that always runs the one you would have chosen?`,
  );
}

main();
