/**
 * INERTNESS AUDIT — capabilities with no caller.
 *
 * Five thumbnail features were dead in production for weeks because the call
 * site never passed their optional arguments. Everything typechecked, every
 * test passed, and the code did nothing. That failure is invisible to every
 * tool the repo already runs, and it is not the kind of thing to re-check by
 * memory on twenty more modules.
 *
 * Two questions, both answered from the TypeScript AST rather than by grepping
 * text — a regex over `import` lines cannot tell a type-only import from a
 * value one, and would report working code as dead:
 *
 *   1. Which exported symbols is nothing importing?
 *   2. Which optional parameters does no call site ever pass?
 *
 * (2) is the one that matters. An unimported export is often merely tidy-up;
 * an optional argument that nobody passes is a FEATURE THAT DOES NOT RUN, and
 * it looks identical to a working one in review.
 *
 * Entry points are excluded by path, because a Next.js page or a Trigger task
 * is invoked by a framework and would otherwise dominate the report with false
 * positives — the fastest way to make an audit worthless is to let noise bury
 * the real findings.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion"]);

/** Invoked by a framework, not by our code. Absence of callers proves nothing. */
const ENTRY_POINT = /(^|\/)(page|layout|route|middleware|instrumentation)\.tsx?$|^src\/trigger\/|^convex\//;
const TEST_FILE = /\.test\.tsx?$|__tests__/;

interface GatingParam {
  name: string;
  /** Positional index, or null when it is a member of an options object. */
  index: number | null;
}

interface ExportedFn {
  name: string;
  file: string;
  /** Optional params that GUARD a branch — see gatingParams. */
  optionalParams: GatingParam[];
}

/**
 * Incidental knobs. An unpassed `log` or `contentType` is a default working as
 * intended, not a dead feature, and reporting them buries the findings that
 * matter. The first version of this audit emitted 440 rows for exactly this
 * reason and was therefore useless.
 */
const INCIDENTAL = new Set([
  "log", "logger", "now", "opts", "options", "signal", "timeout", "contentType",
  "limit", "maxTokens", "temperature", "model", "retries", "maxAttempts", "seed",
  "cwd", "env", "headers", "fetch", "abort", "debug", "verbose", "dryRun",
  "maxAttemptsPerProvider", "reasoningEffort", "thumbWidth", "policy", "access",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

/**
 * Optional parameters that GUARD A BRANCH, i.e. ones whose absence leaves a
 * block of code permanently unexecuted.
 *
 * The distinction matters more than it looks. `foo ?? "default"` used in a
 * straight-line expression is a default doing its job — and if it collapses a
 * range onto one value that is the CONVERGENCE audit's problem, not this one.
 * But `if (foo) { ...work... }` where no caller ever passes `foo` is a feature
 * that has never run once in production. Only the second is reported here.
 */
function gatingParams(node: ts.FunctionLikeDeclaration): GatingParam[] {
  // WHERE a parameter lives decides how "was it passed?" can be answered at
  // all. A positional argument is supplied by arity — `f(a, 20)` passes the
  // second parameter without naming it — so checking object keys would report
  // every positional optional as dead. That false-positive flood is what made
  // the first two versions of this audit unusable.
  const optional = new Map<string, number | null>();
  node.parameters.forEach((param, index) => {
    if (!ts.isIdentifier(param.name)) return;
    if (param.questionToken || param.initializer) optional.set(param.name.text, index);
    const type = param.type;
    if (type && ts.isTypeLiteralNode(type)) {
      for (const member of type.members) {
        if (ts.isPropertySignature(member) && member.questionToken && member.name && ts.isIdentifier(member.name)) {
          optional.set(member.name.text, null);
        }
      }
    }
  });
  if (!optional.size || !node.body) return [];

  // Which of those appear in a condition that guards statements?
  const gating = new Set<string>();
  const namesIn = (n: ts.Node): string[] => {
    const found: string[] = [];
    const walkNode = (x: ts.Node): void => {
      if (ts.isIdentifier(x) && optional.has(x.text)) found.push(x.text);
      x.forEachChild(walkNode);
    };
    walkNode(n);
    return found;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) for (const name of namesIn(n.expression)) gating.add(name);
    if (ts.isConditionalExpression(n)) for (const name of namesIn(n.condition)) gating.add(name);
    n.forEachChild(visit);
  };
  visit(node.body);
  return [...gating]
    .filter((n) => !INCIDENTAL.has(n))
    .map((name) => ({ name, index: optional.get(name) ?? null }));
}

function collectExports(files: string[]): { fns: ExportedFn[]; names: Map<string, string> } {
  const fns: ExportedFn[] = [];
  const names = new Map<string, string>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (TEST_FILE.test(rel)) continue;
    const sf = parse(file);
    sf.forEachChild((node) => {
      const exported = ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return;
      if (ts.isFunctionDeclaration(node) && node.name) {
        names.set(node.name.text, rel);
        const optionalParams = gatingParams(node);
        if (optionalParams.length) fns.push({ name: node.name.text, file: rel, optionalParams });
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) names.set(decl.name.text, rel);
        }
      } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        names.set(node.name.text, rel);
      }
    });
  }
  return { fns, names };
}

/** Every identifier referenced anywhere, and the property keys of every object literal. */
function collectUsage(files: string[]) {
  const referenced = new Map<string, Set<string>>();
  const propertyKeysNear = new Map<string, Set<string>>();
  const maxArity = new Map<string, number>();
  /** A spread or a variable argument could supply anything; never claim "dead". */
  const opaqueCall = new Set<string>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        if (!referenced.has(node.text)) referenced.set(node.text, new Set());
        referenced.get(node.text)!.add(rel);
      }
      // Record which property names are passed at each call, so an optional
      // parameter can be checked against what callers actually supply.
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
        if (callee) {
          maxArity.set(callee, Math.max(maxArity.get(callee) ?? 0, node.arguments.length));
          const keys = propertyKeysNear.get(callee) ?? new Set<string>();
          for (const arg of node.arguments) {
            if (!ts.isObjectLiteralExpression(arg)) continue;
            for (const prop of arg.properties) {
              if (prop.name && ts.isIdentifier(prop.name)) keys.add(prop.name.text);
              // `...spread` could supply anything; record it so a spread call
              // is never reported as "never passes X".
              if (ts.isSpreadAssignment(prop)) opaqueCall.add(callee);
            }
          }
          // An options object handed over as a variable hides its keys.
          for (const arg of node.arguments) {
            if (ts.isIdentifier(arg) || ts.isSpreadElement(arg)) opaqueCall.add(callee);
          }
          propertyKeysNear.set(callee, keys);
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return { referenced, propertyKeysNear, maxArity, opaqueCall };
}

function main(): void {
  const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "convex")));
  const { fns, names } = collectExports(files);
  const { referenced, propertyKeysNear, maxArity, opaqueCall } = collectUsage(files);

  const onlyProd = (set: Set<string> | undefined, self: string) =>
    [...(set ?? [])].filter((f) => f !== self && !TEST_FILE.test(f));

  console.log("=== EXPORTS WITH NO PRODUCTION CALLER ===");
  let deadCount = 0;
  for (const [name, file] of names) {
    if (ENTRY_POINT.test(file)) continue;
    const users = onlyProd(referenced.get(name), file);
    if (users.length === 0) {
      deadCount += 1;
      console.log(`  ${file.padEnd(52)} ${name}`);
    }
  }
  console.log(`  (${deadCount} symbols)\n`);

  console.log("=== OPTIONAL PARAMETERS NO CALLER EVER PASSES ===");
  console.log("  a feature that cannot be switched on is not a feature\n");
  let inert = 0;
  for (const fn of fns) {
    if (ENTRY_POINT.test(fn.file)) continue;
    const passed = propertyKeysNear.get(fn.name);
    if (!passed) continue;                    // never called at all
    if (opaqueCall.has(fn.name)) continue;    // a caller hides its arguments
    const arity = maxArity.get(fn.name) ?? 0;
    const never = fn.optionalParams.filter((p) =>
      p.index === null ? !passed.has(p.name) : arity <= p.index,
    );
    if (!never.length) continue;
    inert += never.length;
    console.log(`  ${fn.file}  ${fn.name}()`);
    console.log(`      never passed: ${never.map((p) => p.name).join(", ")}`);
  }
  console.log(`\n  (${inert} optional parameters never supplied)`);
}

main();
