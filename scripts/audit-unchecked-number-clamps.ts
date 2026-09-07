/**
 * UNCHECKED-NUMBER-CLAMP AUDIT — a clamp written around Number() is not a clamp.
 *
 * `Math.max(0, Math.min(6, Number(value)))` looks like it bounds a value and does
 * not. NaN loses every comparison it takes part in, so both Math calls pass it
 * through untouched, and so does the `if (k <= 0) return` guard underneath,
 * because `NaN <= 0` is false as well. See src/engine/boundedNumber.ts for the
 * three production defects this shape caused.
 *
 * A grep cannot find these. The pattern is written at least five different ways:
 *
 *   Math.max(a, Math.min(b, Number(x)))          nested, one line
 *   Math.min(b, Math.max(a, Number(x)))          nested, other order
 *   Math.max(a, Math.min(b, Number(x)))          split across lines by the formatter
 *   const n = Number(x); Math.max(a, Math.min(b, n))   via a local
 *   Math.round(Number(x))                        rounded, then compared
 *
 * so this walks the AST and asks the structural question instead: does a Number()
 * call, or a local bound to one, reach a Math.max/min/round/floor/ceil without
 * passing a finiteness check first?
 *
 * WHAT COUNTS AS CHECKED
 *
 *   Number.isFinite(...) / isFinite(...) / Number.isNaN / isNaN in the same
 *   function, or the value flowing through boundedNumber/boundedInteger/
 *   isUsableNumber, or a `|| fallback` / `?? fallback` guard applied to the
 *   Number() result — because `Number("abc") || 5` IS 5. (`||` catches NaN and
 *   also 0, which is usually wrong for a different reason, but it is not THIS
 *   defect and the audit does not claim it.)
 *
 * NaN IS NOT ALWAYS A BUG. Reported findings are questions:
 *
 *   loud   NaN reaches something that fails visibly — ffmpeg geometry, a throw,
 *          a required arg. The failure announces itself; a fallback here would
 *          HIDE a misconfiguration rather than fix one.
 *   silent NaN produces a plausible-looking wrong result — a loop that runs zero
 *          times, a threshold nothing can pass, a guard that does not fire.
 *
 * Only the silent ones are worth converting, and telling them apart needs the
 * call site, so the audit prints where the value goes.
 *
 * THE FIRST RUN FOUND 24. Eight were converted (see
 * src/trigger/__tests__/nanClampSites.test.ts, which proves each against its
 * original expression); the rest were verified safe. THREE REMAIN REPORTED and
 * are correct as they stand — the baseline holds them, and the audit's job is
 * to catch the next one:
 *
 *   families.ts:516            familyEpisodeLengthError() throws on a non-finite
 *                              value before this line runs. The guard is real;
 *                              it is in another function, which this audit
 *                              cannot follow.
 *   selfContainedStoryQualityEvidence.ts:266
 *                              completionSampleMs is validated upstream by zod
 *                              as z.number().finite().nonnegative().
 *   selfLoopAudio.test.ts:46   the value is a `(\d+)` capture group, so it
 *                              cannot be non-numeric.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "coverage"]);

/**
 * Files whose whole purpose is to demonstrate the defect.
 *
 * nanClampSites.test.ts runs each ORIGINAL expression beside its replacement, so
 * it necessarily contains the broken shape — the audit found three of its own
 * proof cases and called them findings. This is the third time an audit in this
 * repo has matched the thing that describes what it audits (inert-consumes on
 * its own `consumes` array, inert-produces on its own `produces` array). The
 * exemption is named file by file rather than "skip tests", because a test can
 * hold a real one.
 *
 * build-defect-proof-site.ts is here for the same reason and was caught the same
 * way: it RUNS each original broken expression to prove the defect, so adding it
 * pushed this audit from 3 to 13 and failed the gate. Four times now an audit in
 * this repo has flagged the artifact that documents what it audits — which is
 * the argument for the gate, not against it. It found a real new occurrence of
 * the shape it hunts; it simply could not know why that occurrence was there.
 */
const EXEMPT =
  /boundedNumber\.(ts|test\.ts)$|audit-unchecked-number-clamps\.ts$|nanClampSites\.test\.ts$|build-defect-proof-site\.ts$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const CLAMPS = new Set(["max", "min", "round", "floor", "ceil", "trunc", "abs"]);

function isNumberCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Number";
}

function isMathClamp(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Math" &&
    CLAMPS.has(node.expression.name.text)
  );
}

/**
 * The enclosing function-ish scope, which is where a finiteness check has to
 * live to count. A check in a different function does not protect this one.
 */
function enclosingScope(node: ts.Node): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) || ts.isConstructorDeclaration(cur) || ts.isSourceFile(cur)
    ) return cur;
    cur = cur.parent;
  }
  return node.getSourceFile();
}

/**
 * Checks that make a Number() safe, when they appear in the same function.
 *
 * `Number.isInteger` belongs here for the same reason as isFinite: it is false
 * for NaN. A digits-only regex test (`/^\d+$/.test(x)`) is also sufficient — it
 * proves the string parses — and youtube.ts's retry-after handling uses exactly
 * that, so without it the audit reports a site that is already correct.
 *
 * KNOWN BLIND SPOT: a guard in a DIFFERENT function is invisible here.
 * families.ts calls familyEpisodeLengthError() first, which throws on a
 * non-finite value, so its `Math.round(Number(value) * 60)` is safe — but this
 * audit cannot follow the call and will keep reporting it. That is the honest
 * trade: teaching it to follow calls means a type-checker, and a gate nobody can
 * explain is worse than one with a documented residue. The baseline holds the
 * residue; the audit's job is to catch the NEXT one.
 */
const GUARDED =
  /Number\.isFinite|Number\.isNaN|Number\.isInteger|\bisFinite\s*\(|\bisNaN\s*\(|boundedNumber|boundedInteger|isUsableNumber|\/\^\\d\+?\$\/[a-z]*\s*\.test/;

interface Finding {
  file: string;
  line: number;
  snippet: string;
  /** The identifier the clamped value is assigned to, when there is one. */
  target: string;
}

function main(): void {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "convex")), ...walk(join(ROOT, "scripts"))];
  const findings: Finding[] = [];

  for (const file of files) {
    if (EXEMPT.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("Number(")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    // `Math.max(0, Math.min(6, Number(x)))` is ONE site, not two. Reporting the
    // inner clamp as well doubles the count and makes the number meaningless as
    // a baseline — the same self-inflicted noise the produces audit had.
    const inner = new Set<ts.Node>();
    const markInner = (n: ts.Node): void => {
      if (isMathClamp(n)) for (const arg of n.arguments) {
        const claim = (c: ts.Node): void => { if (isMathClamp(c)) inner.add(c); c.forEachChild(claim); };
        claim(arg);
      }
      n.forEachChild(markInner);
    };
    markInner(sf);

    const visit = (node: ts.Node): void => {
      if (isMathClamp(node) && !inner.has(node)) {
        // Does a raw Number() reach this clamp, directly or through a local?
        let reached: ts.Node | undefined;
        const scan = (n: ts.Node): void => {
          if (isNumberCall(n)) { reached ??= n; return; }
          n.forEachChild(scan);
        };
        for (const arg of node.arguments) scan(arg);

        if (reached) {
          const scope = enclosingScope(node);
          const scopeText = scope.getText(sf);
          // A `|| fallback` or `?? fallback` on the Number() result already
          // handles NaN — `Number("abc") || 5` is 5.
          const parent = reached.parent;
          const coalesced =
            ts.isBinaryExpression(parent) &&
            (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
            parent.left === reached;

          if (!coalesced && !GUARDED.test(scopeText)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            let target = "";
            let p: ts.Node | undefined = node.parent;
            while (p && !target) {
              if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) target = p.name.text;
              else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) target = p.name.text;
              p = p.parent;
            }
            findings.push({
              file: relative(ROOT, file),
              line: line + 1,
              snippet: node.getText(sf).replace(/\s+/g, " ").slice(0, 110),
              target,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  console.log(`clamps built on an unchecked Number(): ${findings.length}\n`);
  let lastFile = "";
  for (const f of findings) {
    if (f.file !== lastFile) { console.log(`\n${f.file}`); lastFile = f.file; }
    console.log(`  ${String(f.line).padStart(5)}  ${f.target ? `${f.target} = ` : ""}${f.snippet}`);
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nNaN is not always a bug: where it reaches ffmpeg or a throw the failure is LOUD,\n` +
      `and a fallback there would hide a misconfiguration. Convert the SILENT ones — a\n` +
      `loop that runs zero times, a threshold nothing passes, a guard that never fires.`,
  );
  console.log(`AUDIT_FINDINGS ${findings.length}`);
}

main();
