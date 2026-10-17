import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { createHash } from "node:crypto";

export const MANIFEST = "deployment-inputs.json";
const normalize = value => value.split(path.sep).join("/");
export const isTest = file => /(?:^|\/)__tests__\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
export const isNonRuntime = file => isTest(file) || /^(?:docs|graphify-out|\.serena|\.agents|\.codex|coverage|\.github)\//.test(file) || /(?:^|\/)(?:README|AGENTS)\.md$/.test(file);
const source = file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith(".d.ts");
const workerRoot = file => file.startsWith("src/trigger/") && source(file) && !isTest(file);
const backendRoot = file => file.startsWith("convex/") && source(file) && !isTest(file);
// Package/compiler settings affect every runtime. Release-control scripts are
// traced through their actual build/publisher consumers; they are not worker
// application inputs merely because CI executes them.
const specialFiles = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "tsconfig.json", "tsconfig.website.json", ".npmrc", "pnpm-workspace.yaml", "scripts/deployment-inputs.mjs", "scripts/deployment-impact.mjs", "vercel-ignore-build.sh"]);

/** Derive this repository's boundaries; no hand-maintained list of worker
 * helpers. Type-only imports are checked by CI, and do not emit website code. */
export function createManifest(root = process.cwd()) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  const tracked = new Set(files);
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw Error("Cannot read deployment dependency configuration");
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  function closure(seeds) {
    const visited = new Set(), uncertain = new Set(), pending = [...seeds];
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const filename = path.join(root, file);
      if (!source(file)) continue;
      // Trace emitted imports, matching isolated compilation. Older modules
      // legitimately write `import { Doc }` without `type`; TypeScript erases
      // these imports when their bindings occur only in type positions.
      const emitted = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { ...options, noEmit: false, module: ts.ModuleKind.ESNext, sourceMap: false, inlineSourceMap: false, declaration: false, declarationMap: false },
      }).outputText;
      const ast = ts.createSourceFile(filename, emitted, ts.ScriptTarget.Latest, true);
      if (ast.parseDiagnostics.length) uncertain.add(`${file}: parse error`);
      function dependency(specifier) {
        if (specifier.startsWith("node:")) return;
        const resolved = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule;
        if (!resolved) {
          // CSS/assets are included as website inputs without parsing as TS.
          if (/\.(?:css|svg|png|jpe?g|webp|woff2?|ttf|mp[34])$/.test(specifier)) return;
          if (specifier.startsWith(".") || specifier.startsWith("@/")) uncertain.add(`${file}: unresolved ${specifier}`);
          return;
        }
        let absolute = resolved.resolvedFileName;
        if (absolute.includes(`${path.sep}node_modules${path.sep}`)) return;
        // Convex provides runtime JS alongside its type declarations. Following
        // the .d.ts instead would falsely make every backend module a UI input.
        if (absolute.endsWith(".d.ts")) {
          const runtime = absolute.slice(0, -5) + ".js";
          if (!fs.existsSync(runtime)) {
            uncertain.add(`${file}: runtime implementation unavailable for ${specifier}`);
            return;
          }
          absolute = runtime;
        }
        if (!absolute.startsWith(root + path.sep)) {
          uncertain.add(`${file}: dependency escapes repository`); return;
        }
        const next = normalize(path.relative(root, absolute));
        if (!tracked.has(next)) {
          uncertain.add(`${file}: untracked runtime dependency ${next}`); return;
        }
        pending.push(next);
      }
      // A filesystem/spawn resource is a runtime input even when it is not a
      // JS import (for example the pinned narration-proof Python script).
      // Only repository-tracked files qualify; R2 keys, output filenames and
      // arbitrary prose do not become paths to read from the host filesystem.
      // Catalogued TS source names are data, not imports; module edges above
      // remain responsible for code dependencies.
      function staticResourcePath(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isCallExpression(node)) {
          if (node.expression.getText(ast) === "process.cwd" && node.arguments.length === 0) return ".";
          const name = ts.isIdentifier(node.expression) ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
          if (name === "join" || name === "resolve") {
            const parts = node.arguments.map(staticResourcePath);
            if (parts.length && parts.every(part => typeof part === "string")) return path.posix.join(...parts);
          }
        }
      }
      function visit(node) {
        const resource = staticResourcePath(node);
        if (typeof resource === "string" && !path.posix.isAbsolute(resource)) {
          const candidate = path.posix.normalize(resource);
          if (tracked.has(candidate) && !source(candidate)) pending.push(candidate);
        }
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause, bindings = clause?.namedBindings;
          const onlyTypes = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(element => element.isTypeOnly));
          if (!onlyTypes) dependency(node.moduleSpecifier.text);
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
          const onlyTypes = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(element => element.isTypeOnly);
          if (!onlyTypes) dependency(node.moduleSpecifier.text);
        }
        if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
          if (node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) dependency(node.moduleReference.expression.text);
          else uncertain.add(`${file}: dynamic import assignment`);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
          if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
          else {
            // Enumerate a literal for-of import probe without weakening the
            // fallback for arbitrary computed/local module names.
            const binding = node.arguments[0];
            let loop = node.parent;
            let shadowed = false;
            while (loop && !ts.isForOfStatement(loop)) {
              if (ts.isFunctionLike(loop)) shadowed = true;
              if (ts.isBlock(loop) && binding && ts.isIdentifier(binding) && loop.statements.some(statement =>
                ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d =>
                  ts.isIdentifier(d.name) && d.name.text === binding.text))) shadowed = true;
              loop = loop.parent;
            }
            const declaration = loop && ts.isVariableDeclarationList(loop.initializer) && loop.initializer.declarations[0];
            const values = loop && ts.isArrayLiteralExpression(loop.expression) && loop.expression.elements;
            if (!shadowed && loop && ts.isVariableDeclarationList(loop.initializer) &&
                (loop.initializer.flags & ts.NodeFlags.Const) && loop.initializer.declarations.length === 1 &&
                binding && ts.isIdentifier(binding) && declaration && ts.isIdentifier(declaration.name) &&
                declaration.name.text === binding.text && values && values.every(value => ts.isStringLiteral(value))) {
              for (const value of values) dependency(value.text);
            } else uncertain.add(`${file}: dynamic module import`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    return { files: [...visited].sort(), uncertain: [...uncertain].sort() };
  }
  const websiteSeeds = files.filter(file => !isNonRuntime(file) &&
    (file.startsWith("src/app/") || file.startsWith("public/") || file.startsWith("src/assets/") ||
     /^src\/(?:middleware|proxy|instrumentation|instrumentation-client)\.[cm]?[jt]s$/.test(file) ||
     /^(?:next|postcss|tailwind)\.config\./.test(file)));
  const website = closure(websiteSeeds);
  const backend = closure(files.filter(file => file.startsWith("convex/") && !isNonRuntime(file) || file === "convex.json"));
  // Read actual worker image globs; never copy another app's file manifest.
  const configAst = ts.createSourceFile("trigger.config.ts", fs.readFileSync(path.join(root, "trigger.config.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const imagePatterns = [], imageUncertain = [];
  function imageFiles(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "additionalFiles") {
      const arg = node.arguments[0];
      const property = arg && ts.isObjectLiteralExpression(arg) && arg.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(configAst) === "files");
      if (property && ts.isArrayLiteralExpression(property.initializer) && property.initializer.elements.every(e => ts.isStringLiteral(e))) {
        imagePatterns.push(...property.initializer.elements.map(e => e.text));
      } else imageUncertain.push("trigger.config.ts: nonliteral additionalFiles");
    }
    ts.forEachChild(node, imageFiles);
  }
  imageFiles(configAst);
  const imageMatchers = imagePatterns.map(pattern => new RegExp("^" + pattern.split("**").map(part => part.split("*").map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$"));
  const workerExtras = files.filter(file => imageMatchers.some(pattern => pattern.test(file)));
  const trigger = closure(files.filter(file => workerRoot(file) || file === "trigger.config.ts").concat(workerExtras));
  trigger.uncertain.push(...imageUncertain);
  const globals = files.filter(file => specialFiles.has(file)).sort();
  const inputs = new Set([...globals, ...website.files, ...backend.files, ...trigger.files]);
  const blobs = Object.fromEntries([...inputs].sort().map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    return [file, hash];
  }));
  const result = { version: 1, project: "youtube-studio-ai", generator: "scripts/deployment-inputs.mjs", globals, website, backend, trigger, blobs };
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const contents = JSON.stringify(createManifest(), null, 2) + "\n";
  if (process.argv.includes("--write")) fs.writeFileSync(MANIFEST, contents);
  else if (!fs.existsSync(MANIFEST) || fs.readFileSync(MANIFEST, "utf8") !== contents) {
    console.error("Deployment inputs changed. Run node scripts/deployment-inputs.mjs --write.");
    process.exit(1);
  }
  const value = JSON.parse(contents);
  console.log(JSON.stringify(Object.fromEntries(["website", "backend", "trigger"].map(key => [key, { files: value[key].files.length, uncertain: value[key].uncertain }]))));
}
