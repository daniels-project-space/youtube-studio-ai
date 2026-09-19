/**
 * Replay actual caller source without importing the provider-backed Trigger
 * task. AST extraction retains the certifier and runtime seed/admission/
 * compilation code verbatim; every referenced import remains genuine.
 *
 * This is local boundary coverage, not an authenticated Trigger/Convex run.
 * Probe/benchmark fixtures exercise selected seed contexts, not signed budget
 * admission. The helper/designer's pure cases live in channelPipelineSeedKeys.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { registerAllBlocks } from "../blocks";
import { createChannelProgramBrief } from "../channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "../channelProgramRoute";
import { channelShowProfileFingerprint, createChannelShowProfile } from "../channelShowProfile";
import { contentLaneForFamily } from "../contentLane";
import { designPipeline } from "../designer";
import { completePipelineForPolicy, type PipelineCompilation } from "../pipelineCompiler";
import type { ResolvedPipeline } from "../validate";
import type { PipelineInvocationSnapshot } from "../../lib/pipelineInvocationSnapshot";

type Scope = Record<string, unknown>;
interface BoundaryResult {
  seedStore: Scope;
  resolved: ResolvedPipeline;
  compilation: PipelineCompilation;
}
interface CaseResult { name: string; refusal?: string }

const repo = process.cwd();
const sourcePaths = [
  "src/engine/channelPipelineSeedKeys.ts",
  "src/engine/designerCore.ts",
  "src/trigger/designChannelInception.ts",
  "src/trigger/runPipeline.ts",
  "src/engine/channelProgramRoute.ts",
  "src/engine/pipelineCompiler.ts",
  "src/engine/validate.ts",
  "src/lib/pipelineInvocationSnapshot.ts",
  "src/lib/payloadSeedInputs.ts",
  "src/engine/channelShowProfile.ts",
  "src/engine/childrenShowBible.ts",
];
function sourceHashes() {
  return Object.fromEntries(sourcePaths.map((path) => [
    path, createHash("sha256").update(readFileSync(join(repo, path))).digest("hex"),
  ]));
}
function readSource(path: string) {
  return ts.createSourceFile(path, readFileSync(join(repo, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
function exactNode(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  const node = nodes(source, predicate)[0];
  assert.ok(node, `required actual caller boundary disappeared: ${source.fileName}`);
  return node;
}
function actualImports(source: ts.SourceFile, code: string): Scope {
  const fragment = ts.createSourceFile("fragment.ts", code, ts.ScriptTarget.Latest, true);
  const names = new Set(nodes(fragment, ts.isIdentifier).map((node) => (node as ts.Identifier).text));
  const requireAtSource = createRequire(join(repo, source.fileName));
  const scope: Scope = { structuredClone };
  for (const item of source.statements) {
    if (!ts.isImportDeclaration(item) || item.importClause?.isTypeOnly ||
        !item.importClause?.namedBindings || !ts.isNamedImports(item.importClause.namedBindings)) continue;
    for (const element of item.importClause.namedBindings.elements) {
      if (!names.has(element.name.text) || element.isTypeOnly) continue;
      const importedExports = requireAtSource((item.moduleSpecifier as ts.StringLiteral).text) as Scope;
      scope[element.name.text] = importedExports[element.propertyName?.text ?? element.name.text];
    }
  }
  return scope;
}
function evaluate<T>(code: string, scope: Scope): T {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(js, scope) as T;
}

const before = sourceHashes();
const inception = readSource("src/trigger/designChannelInception.ts");
const runtime = readSource("src/trigger/runPipeline.ts");
const certifier = exactNode(inception, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "certifyChannelPipeline");
const certifierCode = `${certifier.getText(inception)}; certifyChannelPipeline;`;
const certify = evaluate<(args: Scope) => { compilationFingerprint: string }>(certifierCode, actualImports(inception, certifierCode));
const selection = exactNode(runtime, (node) => ts.isIfStatement(node) &&
  node.expression.getText(runtime) === "durableInvocation" &&
  node.thenStatement.getText(runtime).includes("seedStore = { ...durableInvocation.seedStore }"));
const frozenSeed = exactNode(runtime, (node) => ts.isVariableDeclaration(node) &&
  node.name.getText(runtime) === "frozenProgramRouteSeed") as ts.VariableDeclaration;
const immutableGuard = exactNode(runtime, (node) => ts.isIfStatement(node) &&
  node.expression.getText(runtime) === "durableInvocation && frozenProgramRouteSeed" &&
  node.getStart() < selection.getStart());
const compilationGuard = exactNode(runtime, (node) => ts.isIfStatement(node) &&
  node.expression.getText(runtime) === "durableInvocation" &&
  node.thenStatement.getText(runtime).includes("assertPipelineInvocationCompilation(durableInvocation, compilation)"));
const validation = exactNode(runtime, (node) => ts.isVariableDeclaration(node) &&
  node.name.getText(runtime) === "resolved" && Boolean(node.initializer?.getText(runtime).startsWith("validatePipeline(")));
const selectedRouteGuard = exactNode(runtime, (node) => ts.isIfStatement(node) &&
  node.expression.getText(runtime) === "durableInvocation && frozenProgramRouteSeed" &&
  node.getStart() > selection.getStart());
const selectorGuard = exactNode(runtime, (node) => ts.isIfStatement(node) &&
  node.expression.getText(runtime) === "narrativeSeriesAdmission" && node.getText(runtime).includes("seededSelector"));
const bootstrap = exactNode(runtime, (node) => ts.isAwaitExpression(node) &&
  node.expression.getText(runtime).startsWith("bootstrapSecrets(") && node.getStart() > validation.getStart());
assert.ok(selection.getStart() < selectedRouteGuard.getStart() &&
  selectedRouteGuard.getStart() < selectorGuard.getStart() && selectorGuard.getStart() < validation.getStart(),
"actual compilation must follow selected-store admission");
assert.ok(compilationGuard.getEnd() < bootstrap.getStart(), "actual compilation must precede credentials");

const runtimeCode = `(() => {
  const frozenProgramRouteSeed = ${frozenSeed.initializer!.getText(runtime)};
  ${immutableGuard.getText(runtime)}
  let seedStore;
  ${runtime.text.slice(selection.getStart(), compilationGuard.getEnd())}
  return { seedStore, resolved, compilation };
})()`;
const runtimeImports = actualImports(runtime, runtimeCode);
const candidate = exactNode(runtime, (node) => ts.isVariableDeclaration(node) &&
  node.name.getText(runtime) === "invocationCandidate") as ts.VariableDeclaration;
const candidateCode = `(${candidate.initializer!.getText(runtime)})`;
const candidateImports = actualImports(runtime, candidateCode);
const results: CaseResult[] = [];
function pass<T>(name: string, check: () => T): T {
  const value = check();
  results.push({ name });
  return value;
}
function refuses(name: string, check: () => unknown, pattern: RegExp) {
  let error: unknown;
  try { check(); } catch (caught) { error = caught; }
  assert.ok(error, `${name}: must refuse`);
  assert.match(String(error), pattern);
  results.push({ name, refusal: String(error) });
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("caller seed regression forbids network"); };
try {
  registerAllBlocks();
  const fixtures = (["whiteboard", "comic", "loreshort", "narrated_stock"] as const).map((family) => {
    const brief = createChannelProgramBrief({
      family, nicheKey: "educational", locale: "en",
      concept: "An original educational channel explaining one clear mechanism through a distinctive visual story.",
    });
    const route = resolveChannelProgramRoute(brief);
    const design = designPipeline({ family, nicheKey: brief.nicheKey, programBrief: brief, programRoute: route });
    const entries = completePipelineForPolicy(design.pipeline).entries;
    const profile = createChannelShowProfile({ programBrief: brief, programRoute: route, pipeline: design.pipeline });
    const lane = contentLaneForFamily(family)!;
    const channel = {
      ownerId: "owner-fixture", name: "Seed audit", slug: "seed-audit", family, budget: 20,
      identity: { programBrief: brief, programRoute: route, nicheKey: brief.nicheKey },
    };
    const scope: Scope = {
      entries, contentLane: lane, programRoute: route, programBrief: brief, channel,
      payload: { runId: "run-fixture", channelId: "channel-fixture" },
      showProfile: profile, showProfileFingerprint: channelShowProfileFingerprint(profile), ownerId: "owner-fixture",
      frozenModuleConfig: undefined, narrativeSeriesAdmission: undefined, scheduledPlan: undefined,
      weeklyPreparation: undefined, durableInvocation: undefined, probeBudgetAdmission: undefined,
      routeQualificationBenchmarkAdmission: undefined, privateInvocationContext: undefined, log: () => {},
    };
    const boundary = (overrides: Scope = {}) => evaluate<BoundaryResult>(runtimeCode, { ...runtimeImports, ...scope, ...overrides });
    const fresh = pass(`${family}: actual fresh runtime boundary`, () => boundary());
    const snapshot = pass(`${family}: actual invocation snapshot expression`, () =>
      evaluate<PipelineInvocationSnapshot>(candidateCode, { ...candidateImports, ...scope, ...fresh }));
    pass(`${family}: actual inception certification`, () => {
      const certification = certify({ pipeline: entries, moduleConfig: {}, disabledBlocks: [], family,
        requestFingerprint: "1".repeat(64), pipelineSourceFingerprint: "2".repeat(64), showProfile: profile, programBrief: brief });
      assert.equal(certification.compilationFingerprint, fresh.compilation.fingerprint);
    });
    pass(`${family}: frozen identity, seed and compilation replay`, () => {
      const replay = boundary({ durableInvocation: snapshot, programRoute: undefined, programBrief: undefined });
      assert.equal(replay.compilation.fingerprint, fresh.compilation.fingerprint);
      assert.deepEqual(JSON.parse(JSON.stringify(replay.seedStore)), JSON.parse(JSON.stringify(fresh.seedStore)));
    });
    return { family, brief, route, lane, channel, boundary, fresh, snapshot };
  });
  const fixture = fixtures[0];
  const seed = fixture.fresh.seedStore;
  const alternateBrief = createChannelProgramBrief({ ...fixture.brief, concept: "A different original educational program with a distinct episode promise." });
  const alternateRoute = resolveChannelProgramRoute(alternateBrief);
  const alternateSeed = channelProgramRouteRunSeed({ route: alternateRoute, programBrief: alternateBrief });
  for (const kind of ["probe", "benchmark"] as const) {
    const context = (seedStore: Scope) => ({ payload: kind === "probe"
      ? { probeInvocationContext: { seedStore } }
      : { routeQualificationBenchmark: { invocationContext: { seedStore } } } });
    pass(`${kind}: selected context compiles`, () => assert.equal(fixture.boundary(context(seed)).compilation.fingerprint, fixture.fresh.compilation.fingerprint));
    refuses(`${kind}: missing route is not supplied by current identity`, () => fixture.boundary(context({ contentLane: fixture.lane })), /route|Route|Required/);
    refuses(`${kind}: foreign same-family route`, () => fixture.boundary(context({ ...seed, channelProgramRoute: alternateSeed })), /route|Route/);
    refuses(`${kind}: malformed route`, () => fixture.boundary(context({ ...seed, channelProgramRoute: {} })), /route|Route|version|Required/i);
  }
  const scheduledPlan = {
    planItemId: "plan-fixture", topic: "An original lesson", title: "The Clear Mechanism", thumbnailKey: "fixture/thumbnail.jpg",
    preparation: { version: "plan-week-preparation/inputs-v1", manifestKey: "fixture/manifest.json", manifestSha256: "5".repeat(64) },
  };
  pass("weekly: admitted overlay is actual selected source", () => assert.equal(fixture.boundary({ scheduledPlan,
    weeklyPreparation: { execution: { seedStore: { ...seed, channelName: "Frozen weekly title" } }, prompts: {} },
  }).seedStore.channelName, "Frozen weekly title"));
  refuses("weekly: foreign route overlay", () => fixture.boundary({ scheduledPlan,
    weeklyPreparation: { execution: { seedStore: { channelProgramRoute: alternateSeed } }, prompts: {} },
  }), /route|Route/);
  const frozen = { durableInvocation: fixture.snapshot, programRoute: undefined, programBrief: undefined };
  refuses("frozen: changed immutable identity", () => fixture.boundary({ ...frozen, channel: { ...fixture.channel,
    identity: { programBrief: alternateBrief, programRoute: alternateRoute, nicheKey: alternateBrief.nicheKey },
  } }), /route.*fingerprint|fingerprint.*identity/i);
  refuses("frozen: changed route fingerprint", () => fixture.boundary({ ...frozen,
    durableInvocation: { ...fixture.snapshot, programRouteFingerprint: "0".repeat(64) },
  }), /fingerprint/);
  refuses("frozen: missing seed with retained fingerprint", () => {
    const seedStore = { ...seed };
    delete seedStore.channelProgramRoute;
    return fixture.boundary({ ...frozen, durableInvocation: { ...fixture.snapshot, seedStore } });
  }, /incomplete.*route/);
  refuses("frozen: module or policy drift", () => fixture.boundary({ ...frozen,
    durableInvocation: { ...fixture.snapshot, compilationFingerprint: "0".repeat(64) },
  }), /module\/policy fingerprint drift/);
  function routeLess(snapshot: PipelineInvocationSnapshot) {
    const durable = { ...snapshot, seedStore: { ...snapshot.seedStore } };
    delete durable.programRouteFingerprint;
    delete durable.seedStore.channelProgramRoute;
    return durable;
  }
  const ordinary = fixtures.find((item) => item.family === "narrated_stock")!;
  pass("ordinary: historical route-less snapshot stays route-less", () => {
    const replay = ordinary.boundary({ durableInvocation: routeLess(ordinary.snapshot), programRoute: undefined, programBrief: undefined });
    assert.equal(replay.seedStore.channelProgramRoute, undefined);
    assert.equal(replay.compilation.fingerprint, ordinary.fresh.compilation.fingerprint);
  });
  refuses("route-dependent snapshot cannot invent a missing route", () => fixture.boundary({
    durableInvocation: routeLess(fixture.snapshot), programRoute: undefined, programBrief: undefined,
  }), /channelProgramRoute.*not produced/);
  pass("unadmitted arithmetic request is not carried by real seeding", () => {
    const output = fixture.boundary({ payload: { workedExampleRequest: { operations: ["add"] } } });
    assert.equal(output.seedStore.workedExampleRequest, undefined);
  });
  assert.equal(networkCalls, 0);
  assert.deepEqual(sourceHashes(), before, "actual source must remain unchanged during the oracle");
  console.log(`Actual channel seed callers pass: ${results.length} cases; zero network; source hashes unchanged`);
} finally {
  globalThis.fetch = originalFetch;
}
