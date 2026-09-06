/**
 * INERT-CONSUMES AUDIT — find store keys a block declares it needs and never reads.
 *
 * The store contract is not documentation. `consumes` is what the pipeline
 * compiler uses to decide ordering and to refuse a pipeline where a consumer
 * runs before its producer, so a key declared and never read buys a real
 * ordering constraint for nothing — and, worse, makes the block's actual
 * dependencies harder to see than if it declared nothing at all.
 *
 * Found by hand on `captions`, which declares consumes
 * ["narrationDurationSec", "videoDurationSec"] and reads only the first, and
 * optionalConsumes [..., "chapterPlan"] while chapterPlan is read by assembly,
 * inserts and the retention analyst but never by captions. Two dead
 * declarations on one small block is the kind of ratio that justifies checking
 * all of them mechanically.
 *
 * HOW A "READ" IS RECOGNISED, and why the rule is deliberately generous:
 *
 * The scope is the block's own object literal — from its `id:` through the end
 * of `run` — NOT the file, because narratedBlocks.ts alone holds dozens of
 * blocks and a key read by one would excuse it in all of them. Inside that
 * scope, the key counts as read if its name appears as a string literal
 * anywhere at all: `ctx.store["k"]`, `opt(ctx, "k")`, a helper called with the
 * name, a log line that mentions it. Over-approximating "read" means this can
 * MISS a dead declaration; it cannot invent one. That is the right direction
 * for a list meant to be acted on.
 *
 * A declared key that is genuinely unread is not automatically a defect: a
 * block may declare a key to force ordering it needs for a side effect. Where
 * that is the intent, say so at the declaration — a comment there costs
 * nothing and is the only thing that separates the two cases for the next
 * reader.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

import { registerAllBlocks } from "@/engine/blocks";
import { allManifests } from "@/engine/registry";

const ROOT = process.cwd();
const BLOCK_DIR = join(ROOT, "src/trigger/blocks");

function blockFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) blockFiles(full, out);
    else if (/\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The source text of each block's own object literal, keyed by block id.
 *
 * A block is an object literal with a string `id` and a `run` property. Taking
 * that node's text — rather than the file's — is what makes a per-block answer
 * possible in a file that holds thirty of them.
 */
/**
 * Every store key a node actually READS, by AST rather than by regex.
 *
 * `ctx.store["k"]`, a bare `store["k"]` (helpers take the store directly), and
 * the `opt(ctx, "k")` / `str(ctx, "k")` accessors. Unlike the analyzer in
 * moduleContracts.test.ts this does NOT stop at nested functions: a read inside
 * a `.map()` or a local closure is still a read, and stopping there would
 * invent findings.
 */
function storeReads(
  node: ts.Node,
  sf: ts.SourceFile,
  into = new Set<string>(),
  constants: ReadonlyMap<string, string> = new Map(),
): Set<string> {
  const keyOf = (expression: ts.Expression): string | null => {
    if (ts.isStringLiteral(expression)) return expression.text;
    // A key held in a constant is still a literal read. shorts_spinoff reads
    // ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY], and treating that as
    // "not a read" would have had this audit recommend deleting a declaration
    // the runtime Proxy enforces — an undeclared read THROWS in production.
    if (ts.isIdentifier(expression)) return constants.get(expression.text) ?? null;
    return null;
  };
  const visit = (current: ts.Node): void => {
    if (ts.isElementAccessExpression(current) && current.argumentExpression) {
      const target = current.expression;
      const isStore =
        (ts.isPropertyAccessExpression(target) && target.name.text === "store") ||
        (ts.isIdentifier(target) && /^(store|s)$/.test(target.text));
      const key = isStore ? keyOf(current.argumentExpression) : null;
      if (key) into.add(key);
    }
    if (
      ts.isCallExpression(current) && ts.isIdentifier(current.expression) &&
      ["str", "opt", "num", "bool"].includes(current.expression.text) &&
      current.arguments.length >= 2
    ) {
      const key = keyOf(current.arguments[1]!);
      if (key) into.add(key);
    }
    current.forEachChild(visit);
  };
  visit(node);
  return into;
}

function blockScopes(): Map<string, { file: string; line: number; text: string; reads: Set<string> }> {
  const scopes = new Map<string, { file: string; line: number; text: string; reads: Set<string> }>();
  const constants = stringConstants();
  for (const file of blockFiles(BLOCK_DIR)) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        let id: string | null = null;
        let hasRun = false;
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !property.name) continue;
          const name = property.name.getText(sf);
          if (name === "id" && ts.isStringLiteral(property.initializer)) id = property.initializer.text;
          if (name === "run") hasRun = true;
        }
        if (id && hasRun && !scopes.has(id)) {
          // Drop the block's OWN declaration arrays before scanning. They sit
          // inside this very node, so every `consumes` entry matched itself and
          // the audit could only ever report keys declared elsewhere (in
          // MODULE_CONTRACTS) — it reported captions' chapterPlan and was
          // structurally blind to its videoDurationSec.
          let text = "";
          for (const property of node.properties) {
            if (
              ts.isPropertyAssignment(property) && property.name &&
              ["id", "consumes", "produces", "optionalProduces"].includes(property.name.getText(sf))
            ) continue;
            text += `\n${property.getText(sf)}`;
          }
          const helpers = helperBodies(text, file, sf);
          const reads = storeReads(node, sf, new Set<string>(), constants);
          // Helper bodies are text by the time they come back, so re-parse them
          // once to collect their reads too. storySpineFromStore(store) is the
          // shape that makes this necessary.
          if (helpers.trim()) {
            const helperSf = ts.createSourceFile("helpers.ts", helpers, ts.ScriptTarget.Latest, true);
            storeReads(helperSf, helperSf, reads, constants);
          }
          scopes.set(id, {
            file: relative(ROOT, file),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: text + helpers,
            reads,
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return scopes;
}

/**
 * Bodies of same-file functions the block calls, appended to its scope.
 *
 * Without this the audit was badly wrong in the other direction: every crew
 * block routes the store through shared helpers (loadGrounding, crewCtx,
 * roleProfile), so channelName, niche, styleDNA and
 * serializedProgramEpisodeContext looked unread on all five of them at once.
 * Five identical findings across sibling blocks is what a missing indirection
 * looks like, not five bugs.
 *
 * Four levels deep. The count settles there — 111 findings at two levels, 103
 * at three, 96 at four, and 96 at five — so four is where following the chain
 * stops changing the answer. Deeper indirection
 * would be missed, and that is the safe direction: a missed dead declaration
 * costs nothing, an invented one costs the reader's trust.
 */
const sourceCache = new Map<string, ts.SourceFile | null>();

function sourceOf(path: string): ts.SourceFile | null {
  if (sourceCache.has(path)) return sourceCache.get(path)!;
  let resolved: string | null = null;
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, join(path, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) { resolved = candidate; break; }
    } catch { /* not this candidate */ }
  }
  const sf = resolved ? ts.createSourceFile(resolved, readFileSync(resolved, "utf8"), ts.ScriptTarget.Latest, true) : null;
  sourceCache.set(path, sf);
  return sf;
}

/**
 * Where an imported name lives, for the local `@/` and relative specifiers that
 * make up this repo. Package imports are ignored: nothing in node_modules reads
 * this store.
 */
function importedFrom(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const path = specifier.startsWith("@/")
      ? join(ROOT, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? join(sf.fileName, "..", specifier)
        : null;
    if (!path) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) out.set(element.name.getText(sf), path);
    }
  }
  return out;
}

function helperBodies(scopeText: string, file: string, sf: ts.SourceFile, depth = 0): string {
  if (depth >= 4) return "";
  const declared = new Map<string, ts.Node>();
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declared.set(node.name.getText(sf), node.body);
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) declared.set(node.name.getText(sf), node.initializer);
    node.forEachChild(collect);
  };
  collect(sf);
  let out = "";
  for (const [name, body] of declared) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(scopeText)) continue;
    const text = body.getText(sf);
    out += `\n${text}${helperBodies(text, file, sf, depth + 1)}`;
  }
  // Same-file resolution alone still reported serializedProgramEpisodeContext
  // as unread on all five crew blocks plus gen_footage and metadata — the same
  // "one missing indirection, N identical findings" signature as before, this
  // time an IMPORTED helper
  // (serializedProgramEpisodeContextForStage) that reads the key.
  for (const [name, path] of importedFrom(sf)) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(scopeText)) continue;
    const imported = sourceOf(path);
    if (!imported) continue;
    const importedDeclared = new Map<string, ts.Node>();
    const collectImported = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) importedDeclared.set(node.name.getText(imported), node.body);
      if (
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) importedDeclared.set(node.name.getText(imported), node.initializer);
      node.forEachChild(collectImported);
    };
    collectImported(imported);
    const body = importedDeclared.get(name);
    if (!body) continue;
    const text = body.getText(imported);
    out += `\n${text}${helperBodies(text, path, imported, depth + 1)}`;
  }
  return out;
}

/**
 * `const NAME = "literal"` across the repo, so a store key held in a constant
 * resolves to the key it actually is.
 */
function stringConstants(): Map<string, string> {
  const out = new Map<string, string>();
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".next", ".git", "__tests__"].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { scan(full); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=\s*["'`]([^"'`\n]{1,80})["'`]/g)) {
        out.set(match[1]!, match[2]!);
      }
    }
  };
  scan(join(ROOT, "src"));
  return out;
}

interface Finding { block: string; file: string; line: number; key: string; kind: "consumes" | "optionalConsumes" }

function main(): void {
  registerAllBlocks();
  const scopes = blockScopes();
  const findings: Finding[] = [];
  let blocksChecked = 0;
  let keysChecked = 0;
  const noScope: string[] = [];
  let mentionedOnly = 0;

  for (const manifest of allManifests()) {
    const scope = scopes.get(manifest.id);
    if (!scope) {
      noScope.push(manifest.id);
      continue;
    }
    blocksChecked++;
    const declared: Array<[string, Finding["kind"]]> = [
      ...Object.keys(manifest.consumes ?? {}).map((k): [string, Finding["kind"]] => [k, "consumes"]),
      ...Object.keys(manifest.optionalConsumes ?? {}).map((k): [string, Finding["kind"]] => [k, "optionalConsumes"]),
    ];
    for (const [key, kind] of declared) {
      keysChecked++;
      if (scope.reads.has(key)) continue;
      // A key can also be named in a string the block passes onward (a log, a
      // receipt field). That is not a READ, but it is enough ambiguity that
      // reporting it would waste the reader's time, so it is still excused —
      // just recorded separately so the two are not confused.
      if (new RegExp(`["'\`]${key}["'\`]`).test(scope.text)) { mentionedOnly++; continue; }
      findings.push({ block: manifest.id, file: scope.file, line: scope.line, key, kind });
    }
  }

  findings.sort((a, b) => a.block.localeCompare(b.block) || a.key.localeCompare(b.key));
  console.log(`blocks with a locatable definition: ${blocksChecked}${noScope.length ? ` (${noScope.length} not found: ${noScope.slice(0, 6).join(", ")}${noScope.length > 6 ? " …" : ""})` : ""}`);
  console.log(`declared store keys checked: ${keysChecked}`);
  console.log(`named in a string but never read (excused): ${mentionedOnly}`);
  console.log(`declared but never read in the block: ${findings.length}\n`);
  let current = "";
  for (const f of findings) {
    if (f.block !== current) {
      current = f.block;
      console.log(`  ${f.block}  (${f.file}:${f.line})`);
    }
    console.log(`        ${f.kind.padEnd(16)} ${f.key}`);
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\n"consumes" is what the compiler orders the pipeline by, so a dead entry buys\n` +
      `a real constraint for nothing and hides the block's true dependencies. Where a\n` +
      `key is declared to force ordering for a side effect, say so at the declaration.`,
  );
}

main();
