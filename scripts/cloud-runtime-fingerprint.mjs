import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const POLICY_VERSION = "cloud-runtime-inputs/v1";
const PROVIDERS = ["convex", "trigger"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const implementationHash = sha256(readFileSync(fileURLToPath(import.meta.url)));
const BOTH = "both";
const under = (path, root) => path === root || path.startsWith(`${root}/`);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

// Closed, reviewed recipe: changing selectors, aliases or arbitrary build hooks
// requires reviewing this inventory and updating its version/digests. Merely
// hashing a new recipe would not cover later edits to a newly introduced input.
const REVIEWED_RECIPES = {
  "trigger.config.ts": "7b8a3aa07c768bb43023d5c3564a860c138868086394c89acf87e3c3d28a5644",
  "tsconfig.json": "a6eed31585eea12a52e55eba41688c1915aba7ebd321ddab15648cc5ff8aad44",
  "convex/tsconfig.json": "1f35eb40d8745ec19ef3069f29ffa59920488fc30a42efcb94f815c2f720dcb4",
};
const PYTHON = ["wb_scribe_sync", "whisper_align", "narration_transcript_proof", "mc_page_render", "mc_textplace", "mc_font", "shot_analysis"].map((name) => `scripts/${name}.py`);
const QA_LOCKS = ["requirements/qa-scene-analysis.txt", "requirements/qa-narration-proof.txt"];
const COMMON_FILES = ["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", ".github/workflows/ci.yml"];
const SHARED_ROOTS = ["src/lib", "src/engine", "src/agents", "src/remotion", "src/geo", "src/motion"];
const TRIGGER_ROOTS = ["src/trigger", "src/assets", "public/fonts"];
// Deliberate over-inclusion: these small support trees may become build inputs.
// New files inside them invalidate both providers without needing a classifier edit.
const SUPPORT_ROOTS = ["scripts", "requirements", ".github", "infra", "workers", "test-fixtures", "public"];
const ROOT_FILES = new Set([...COMMON_FILES, "trigger.config.ts", "requirements-ci.txt", ".gitignore", ".dockerignore", ".vercelignore", ".npmrc", ".nvmrc", ".node-version", "eslint.config.mjs", "next.config.ts", "postcss.config.mjs"]);
const EXCLUDED_ROOTS = [".git", "node_modules", ".next", ".trigger", ".convex", ".vercel", ".agents", ".codex", ".serena", ".claude", ".locks", "graphify-out", "output", "out", "build", "coverage", "motion-graphics"];
const UI_ROOTS = ["src/app", "src/components"];
const DEPLOY_COMMAND = "npx --yes trigger.dev@4.5.9 deploy --native-build-server";
const LIFECYCLES = ["preinstall", "install", "postinstall", "prepare", "pretrigger:deploy", "posttrigger:deploy"];

function classify(path) {
  if (EXCLUDED_ROOTS.some((root) => under(path, root)) || path.split("/").some((part) => ["node_modules", "__pycache__"].includes(part)) ||
      /(?:^|\/)\.env[^/]*$|\.pem$|\.pyc$|\.tsbuildinfo$|(?:^|\/)\.DS_Store$/.test(path) ||
      path === "next-env.d.ts" || path === "scripts/.yt-refresh-token.txt") return "excluded";
  if (UI_ROOTS.some((root) => under(path, root))) return "ui";
  if (under(path, "docs") || (!path.includes("/") && path.endsWith(".md"))) return "documentation";
  if (under(path, "convex/_generated")) return BOTH;
  if (under(path, "convex")) return "convex";
  if (TRIGGER_ROOTS.some((root) => under(path, root)) || PYTHON.includes(path) || QA_LOCKS.includes(path) || path === "trigger.config.ts") return "trigger";
  if (SHARED_ROOTS.some((root) => under(path, root)) || SUPPORT_ROOTS.some((root) => under(path, root)) || ROOT_FILES.has(path) || path === "src") return BOTH;
  return "unknown";
}

const stamp = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
function hashFile(path, before) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (stamp(fstatSync(descriptor)) !== stamp(before)) throw new Error("changed-input");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    if (stamp(fstatSync(descriptor)) !== stamp(before)) throw new Error("changed-input");
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}

function readText(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error("Not a regular source file");
    return readFileSync(descriptor, "utf8");
  }
  finally { closeSync(descriptor); }
}

function validateTargets(targets, env) {
  const defaults = {
    convex: { deployment: "astute-camel-689", kind: "dev" },
    trigger: { project: env.TRIGGER_PROJECT_REF ?? "proj_vorkjqmnnpkzoiqqgbuu", environment: "prod" },
  };
  const result = {};
  for (const provider of PROVIDERS) {
    const value = targets?.[provider] ?? defaults[provider];
    if (!value || Object.keys(value).sort().join() !== Object.keys(defaults[provider]).sort().join() ||
        Object.values(value).some((part) => typeof part !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(part))) throw new Error("Invalid public runtime target");
    result[provider] = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (!["dev", "prod"].includes(result.convex.kind) || !["prod", "staging"].includes(result.trigger.environment)) throw new Error("Invalid runtime environment");
  if (targets && Object.keys(targets).some((key) => !PROVIDERS.includes(key))) throw new Error("Unknown runtime target");
  return result;
}

// The only computed import currently used by the worker is a const for-of over
// literal package names. Resolve that finite case; reject shadowing/function
// scopes instead of pretending to evaluate arbitrary JavaScript.
function finiteImport(argument) {
  if (ts.isStringLiteralLike(argument)) return [argument.text];
  if (!ts.isIdentifier(argument)) return null;
  for (let parent = argument.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return null;
    if (!ts.isForOfStatement(parent)) continue;
    const declaration = parent.initializer;
    if (!ts.isVariableDeclarationList(declaration) || !(declaration.flags & ts.NodeFlags.Const) || declaration.declarations.length !== 1 ||
        declaration.declarations[0].name.getText() !== argument.text || !ts.isArrayLiteralExpression(parent.expression) ||
        !parent.expression.elements.every(ts.isStringLiteralLike)) return null;
    let shadowed = false;
    function check(node) {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.name.getText() === argument.text) shadowed = true;
      ts.forEachChild(node, check);
    }
    check(parent.statement);
    return shadowed ? null : parent.expression.elements.map((node) => node.text);
  }
  return null;
}

/** Local inventory only. This function never contacts Git or a provider and
 * deliberately never returns a deployment/reuse authorization. */
export function fingerprintRuntimeInputs({ root = process.cwd(), targets, policyVersion = POLICY_VERSION, environmentEpoch = "unverified", env = process.env } = {}) {
  if (typeof constants.O_NOFOLLOW !== "number") throw new Error("No-follow source reads are required");
  if (typeof policyVersion !== "string" || typeof environmentEpoch !== "string" || !/^[a-zA-Z0-9_./-]{1,100}$/.test(policyVersion) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(environmentEpoch)) throw new Error("Invalid fingerprint policy metadata");
  const publicTargets = validateTargets(targets, env);
  const directory = resolve(root);
  let ancestor = "/";
  for (const part of directory.split("/").filter(Boolean)) {
    ancestor = join(ancestor, part);
    if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Source ancestors must not be symlinks");
  }
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error("Source root must be a real directory");
  const entries = new Map(), snapshots = new Map(), issues = [], excluded = [];
  const issue = (code, path, scope = BOTH) => {
    if (!issues.some((entry) => entry.code === code && entry.path === path && entry.scope === scope)) issues.push({ code, path, scope });
  };
  function walk(path = "") {
    const absolute = join(directory, path), classification = path ? classify(path) : BOTH;
    if (path.includes("\\") || /[\x00-\x1f]/.test(path)) { issue("unsafe-input-path", path); return; }
    if (classification === "excluded") { excluded.push(path); return; }
    if (classification === "documentation") {
      if (lstatSync(absolute).isSymbolicLink()) issue("unsupported-file-type", path);
      else excluded.push(path);
      return;
    }
    if (classification === "unknown") { issue("unknown-path", path); return; }
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) { issue("unsupported-file-type", path); return; }
      const names = stat.isDirectory() ? readdirSync(absolute).sort() : null;
      snapshots.set(path, { stat: stamp(stat), names });
      if (path) entries.set(path, { path, type: names ? "directory" : "file", mode: (stat.mode & 0o7777).toString(8), bytes: names ? 0 : stat.size, classification });
      if (names) for (const name of names) walk(path ? `${path}/${name}` : name);
      else if (classification !== "ui") entries.get(path).sha256 = hashFile(absolute, stat);
    } catch { issue("unreadable-or-changing-input", path); }
  }
  walk();

  function requireFile(path, scope = BOTH) {
    if (entries.get(path)?.type !== "file" || entries.get(path).bytes === 0) issue("missing-or-empty-required-file", path, scope);
  }
  COMMON_FILES.forEach((path) => requireFile(path));
  ["convex/schema.ts", "convex/auth.config.ts", "convex/crons.ts", "convex/tsconfig.json"].forEach((path) => requireFile(path, "convex"));
  requireFile("convex/_generated/api.js");
  ["trigger.config.ts", ...PYTHON, ...QA_LOCKS].forEach((path) => requireFile(path, "trigger"));
  for (const path of ["src/lib", "src/engine", "src/agents", "src/remotion", ...TRIGGER_ROOTS]) {
    if (![...entries.values()].some((entry) => entry.type === "file" && under(entry.path, path))) issue("empty-required-tree", path, TRIGGER_ROOTS.includes(path) ? "trigger" : BOTH);
  }
  for (const [path, digest] of Object.entries(REVIEWED_RECIPES)) {
    if (entries.get(path)?.sha256 !== digest) issue("unreviewed-input-recipe", path, path === "trigger.config.ts" ? "trigger" : BOTH);
  }
  let packageJson = {};
  try {
    if (entries.get("package.json")?.type !== "file") throw new Error("Missing package manifest");
    packageJson = JSON.parse(readText(join(directory, "package.json")));
    if (packageJson.scripts?.["trigger:deploy"] !== DEPLOY_COMMAND || LIFECYCLES.some((name) => packageJson.scripts?.[name])) issue("unreviewed-package-lifecycle", "package.json");
    if (typeof packageJson.dependencies?.convex !== "string" || typeof packageJson.devDependencies?.typescript !== "string") issue("missing-tool-declaration", "package.json");
    if (packageJson.imports || packageJson.exports || packageJson.workspaces ||
        Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies }).some((value) => /^(?:file:|link:|workspace:|portal:|\.|\/)/.test(value))) issue("unreviewed-local-package-resolution", "package.json");
  } catch { issue("invalid-package-json", "package.json"); }
  for (const path of ["package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) if (entries.get(path)?.type === "file") {
    try {
      if (/(?:["\s])(?:file:|link:|workspace:|portal:)|"link"\s*:\s*true/.test(readText(join(directory, path)))) issue("unreviewed-local-package-resolution", path);
    } catch { issue("unreadable-or-changing-input", path); }
  }

  const promotedUi = new Set(), references = [], edges = [], checked = new Set();
  const queue = [...entries.keys()].filter((path) => CODE.test(path) && !TEST.test(path) && !path.includes("/__tests__/") &&
    (path === "trigger.config.ts" || under(path, "convex") || SHARED_ROOTS.some((part) => under(path, part)) || under(path, "src/trigger")));
  function localReference(specifier, importer, scope) {
    let path;
    if (specifier.startsWith("@/")) path = `src/${specifier.slice(2)}`;
    else if (specifier.startsWith(".")) path = posix.join(posix.dirname(importer), specifier);
    else if (specifier.startsWith("src/") || specifier.startsWith("/")) { issue("unsupported-module-path", importer, scope); return; }
    else return; // Package/builtin modules are covered conservatively by both locks.
    if (path.startsWith("../") || path.includes("\\")) { issue("escaping-module-path", importer, scope); return; }
    const candidates = [path, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts", ".d.mts", ".d.cts"].flatMap((ext) => [`${path}${ext}`, `${path}/index${ext}`])];
    if (/\.[cm]?js$/.test(path)) candidates.push(path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".d.ts"), path.replace(/\.mjs$/, ".mts"), path.replace(/\.mjs$/, ".d.mts"), path.replace(/\.cjs$/, ".cts"), path.replace(/\.cjs$/, ".d.cts"));
    const target = candidates.find((candidate) => entries.get(candidate)?.type === "file");
    if (!target) { issue("unresolved-local-import", importer, scope); return; }
    edges.push([importer, target]);
    if (entries.get(target).classification === "ui") {
      references.push({ importer, target, scope });
    }
    if (CODE.test(target) && !checked.has(target)) queue.push(target);
  }
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (checked.has(path)) continue;
    checked.add(path);
    const classification = entries.get(path).classification, scope = classification === "ui" ? BOTH : classification;
    try {
      const source = ts.createSourceFile(path, readText(join(directory, path)), ts.ScriptTarget.Latest, true);
      if (source.parseDiagnostics.length) { issue("unparseable-runtime-source", path, scope); continue; }
      const requireNames = new Set(["require"]), factories = new Set(["createRequire"]);
      source.statements.forEach((node) => {
        if (ts.isImportDeclaration(node) && ["node:module", "module"].includes(node.moduleSpecifier.text) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const name of node.importClause.namedBindings.elements) if ((name.propertyName ?? name.name).text === "createRequire") factories.add(name.name.text);
        }
      });
      function aliases(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) &&
            (factories.has(node.initializer.expression.getText(source)) || /\.createRequire$/.test(node.initializer.expression.getText(source)))) requireNames.add(node.name.text);
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer) && requireNames.has(node.initializer.text)) requireNames.add(node.name.text);
        ts.forEachChild(node, aliases);
      }
      aliases(source);
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) localReference(node.moduleSpecifier.text, path, scope);
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) localReference(node.moduleReference.expression.text, path, scope);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) localReference(node.argument.literal.text, path, scope);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || requireNames.has(node.expression.getText(source)) || [...requireNames].some((name) => node.expression.getText(source) === `${name}.resolve`))) {
          const values = node.arguments[0] && finiteImport(node.arguments[0]);
          if (!values) issue("unresolved-dynamic-import", path, scope);
          else values.forEach((value) => localReference(value, path, scope));
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    } catch { issue("unreadable-runtime-source", path, scope); }
  }
  // Propagate real cross-provider imports as well as UI edges. A Convex source
  // importing a Trigger-only helper must not miss later changes to that helper.
  const membership = new Map([...entries.values()].map((entry) => [entry.path, new Set(entry.classification === BOTH ? PROVIDERS : entry.classification === "ui" ? [] : [entry.classification])]));
  let changed;
  do {
    changed = false;
    for (const [importer, target] of edges) for (const provider of membership.get(importer)) {
      if (!membership.get(target).has(provider)) { membership.get(target).add(provider); changed = true; }
    }
  } while (changed);
  for (const entry of entries.values()) if (entry.classification === "ui") for (const provider of membership.get(entry.path)) promotedUi.add(provider);
  for (const entry of entries.values()) {
    if (entry.classification === "ui") for (const provider of promotedUi) membership.get(entry.path).add(provider);
    for (let parent = posix.dirname(entry.path); parent !== "."; parent = posix.dirname(parent)) {
      if (membership.has(parent)) for (const provider of membership.get(entry.path)) membership.get(parent).add(provider);
    }
  }
  // A dependency's uncertainty affects every consumer, not just its original
  // directory bucket (including a Trigger helper newly imported by Convex).
  for (const entry of [...issues]) if (entry.scope !== BOTH && membership.has(entry.path)) for (const provider of membership.get(entry.path)) {
    if (provider !== entry.scope) issue(entry.code, entry.path, provider);
  }
  // One runtime edge removes the entire UI exemption for that provider. This
  // over-includes child styles/assets instead of guessing their transitive use.
  if (promotedUi.size) for (const entry of entries.values()) if (entry.type === "file" && entry.classification === "ui") {
    try { entry.sha256 = hashFile(join(directory, entry.path), lstatSync(join(directory, entry.path))); }
    catch { issue("unreadable-or-changing-input", entry.path); }
  }
  // Reject concurrent edits, replacements, additions and removals, including UI
  // files changing while their import exemption is being evaluated.
  for (const [path, snapshot] of snapshots) {
    try {
      const absolute = join(directory, path);
      if (stamp(lstatSync(absolute)) !== snapshot.stat || (snapshot.names && readdirSync(absolute).sort().join("\0") !== snapshot.names.join("\0"))) issue("changed-during-inventory", path);
    } catch { issue("changed-during-inventory", path); }
  }
  issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const tools = { node: process.versions.node, platform: process.platform, arch: process.arch, typescript: ts.version,
    convex: packageJson.dependencies?.convex ?? null, triggerDeploy: packageJson.scripts?.["trigger:deploy"] ?? null, packageManager: packageJson.packageManager ?? null };
  const providers = {};
  for (const provider of PROVIDERS) {
    const records = [...entries.values()].filter((entry) => membership.get(entry.path).has(provider))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      .map(({ path, type, mode, bytes, sha256 }) => ({ path, type, mode, bytes, sha256: sha256 ?? null }));
    const failures = issues.filter((entry) => entry.scope === BOTH || entry.scope === provider);
    providers[provider] = { status: failures.length ? "blocked" : "complete", fingerprint: failures.length ? null : sha256(JSON.stringify({ policyVersion, implementationHash, provider, target: publicTargets[provider], environmentEpoch, tools, records })),
      target: publicTargets[provider], uiExcluded: !promotedUi.has(provider), inputCount: records.length, inputBytes: records.reduce((sum, entry) => sum + entry.bytes, 0), issues: failures, records };
  }
  return { policyVersion, implementationHash, tools, environmentEpoch, reuseAuthorized: false, source: "local-filesystem-inventory-not-a-deployment-receipt", providers,
    uiReferences: references.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), excluded: excluded.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let root, includeFiles = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--files" && !includeFiles) includeFiles = true;
      else if (args[index] === "--root" && root === undefined && args[index + 1] && !args[index + 1].startsWith("--")) root = args[++index];
      else throw new Error("Use --root <directory> and optional --files");
    }
    const inventory = fingerprintRuntimeInputs({ root });
    if (!includeFiles) for (const provider of PROVIDERS) delete inventory.providers[provider].records;
    console.log(JSON.stringify(inventory, null, 2));
    if (PROVIDERS.some((provider) => inventory.providers[provider].status !== "complete")) process.exitCode = 2;
  } catch {
    console.error("Runtime input inventory failed closed. No deployment reuse is authorized.");
    process.exitCode = 2;
  }
}
