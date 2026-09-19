/**
 * Controlled, title-selection-only experiment over retained source packets.
 * No historical invocation is reconstructed. The baseline executes unchanged
 * 991b349 source; only research I/O and unrelated package/comment purchases are
 * suppressed. Those synthetic ancillary values never enter the result record.
 *
 * Default is offline replay. Live execution requires explicit call/spend limits
 * and a new append-only receipt file; no Convex, Trigger, R2 or YouTube writes.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  createModelUsageScope, priceModelUsage, recordModelUsage,
} from "../src/lib/modelUsage";
import type { MetaCraftArgs } from "../src/lib/metacraft";
import type { claudeJson } from "../src/lib/anthropic";

export const BASELINE_REVISION = "991b349";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const HASH = /^[a-f0-9]{64}$/;
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const HARNESS_SOURCE = readFileSync(fileURLToPath(import.meta.url), "utf8");
const HARNESS_SHA256 = sha256(HARNESS_SOURCE);
const CURRENT_SOURCE_ARCHIVE_PATHS = ["src/lib/metacraft.ts", "src/lib/anthropic.ts", "src/lib/openRouter.ts"] as const;
type SourceArchiveEntry = { path: string; text: string; byteLength: number; sha256: string };
type Row = Record<string, unknown>;
function row(value: unknown, label: string): Row {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Row;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function gitSource(path: string, revision = BASELINE_REVISION): string {
  assert.match(revision, /^[a-f0-9]{7,40}$/);
  assert.ok(path.startsWith("src/") && !path.includes(".."), "only scoped repository source can be loaded");
  return execFileSync("git", ["show", `${revision}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 4_000_000 });
}

export type ExperimentPacket = {
  version: "title-quality-experiment/v1";
  caseId: string;
  runId: string;
  channelId: string;
  historicalReplay: false;
  identityBasis: "current_identity_observed_with_retained_source";
  observedAt: string;
  fixtureSha256: string;
  sourceProjectionSha256: string;
  coverage: {
    narrationCharacters: number;
    narrationSha256: string | null;
    productionBaselineCallerExcerptCharacters: number;
    experimentExcerptCharacters: number;
    sourceFamily: string | null;
    missing: string[];
  };
  evidence: {
    suggestions: { status: "unavailable"; values: string[]; reason: string };
    competitors: { status: "retained" | "unavailable"; values: { title: string; views: number }[]; reason: string };
  };
  args: Omit<MetaCraftArgs, "log"> & {
    suggestions: string[];
    sourceCoverage: { kind: "full_narration" | "topic_only"; providedChars: number; totalChars: number | null };
    format?: string;
  };
};

/** Integrity is checked before any model boundary, including file/channel swaps. */
export function verifySource(bindingValue: unknown, bytes: Buffer): Row {
  const binding = row(bindingValue, "case binding");
  assert.match(String(binding.sha256), HASH);
  assert.equal(bytes.length, binding.byteLength, "source byte length changed");
  assert.equal(sha256(bytes), binding.sha256, "source bytes changed");
  const packet = row(JSON.parse(bytes.toString("utf8")), "source packet");
  assert.equal(packet.version, "title-baseline-source/v1");
  assert.equal(packet.historicalReplayReady, false);
  assert.equal(packet.liveGenerationPerformed, false);
  const source = row(packet.source, "source projection");
  const channel = row(source.currentChannel, "current identity");
  assert.equal(source.runId, binding.runId, "run binding changed");
  assert.equal(row(source.run, "source run").channelId, binding.channelId, "channel binding changed");
  assert.equal(channel.id, binding.channelId);
  assert.equal(channel.name, binding.channelName);
  assert.equal(sha256(JSON.stringify(source)), binding.sourceProjectionSha256, "source projection changed");
  const stages = list(source.stages, "stages").map((s) => row(s, "stage"));
  for (const reference of list(binding.narration, "narration references")) {
    const n = row(reference, "narration reference");
    const matches = stages.filter((s) => s.id === n.stageId && s.block === n.block);
    assert.equal(matches.length, 1, "narration stage binding changed");
    const text = row(matches[0].outputs, "narration output").narrationText;
    assert.equal(typeof text, "string");
    assert.equal((text as string).length, n.characters);
    assert.equal(sha256(text as string), n.sha256, "narration digest changed");
  }
  return packet;
}

export function prepareExperiment(bindingValue: unknown, bytes: Buffer): ExperimentPacket {
  const binding = row(bindingValue, "case binding");
  const packet = verifySource(binding, bytes);
  const source = row(packet.source, "source");
  const channel = row(source.currentChannel, "channel");
  const identity = row(channel.identity ?? {}, "identity");
  const stages = list(source.stages, "stages").map((s) => row(s, "stage"));
  const metadata = stages.filter((s) => s.block === "metadata");
  assert.equal(metadata.length, 1, "one retained metadata topic is required");
  const topic = row(metadata[0].inputs, "metadata inputs").topic;
  assert.ok(typeof topic === "string" && topic.trim(), "missing actual metadata topic");
  const outputs = stages.map((s) => row(s.outputs ?? {}, "outputs"));
  const narrations = outputs.map((o) => o.narrationText).filter((t): t is string => typeof t === "string");
  assert.ok(narrations.length <= 1, "ambiguous narration source");
  const narration = narrations[0];
  const scriptOutput = outputs.find((o) => o.script !== undefined);
  const script = row(scriptOutput?.script ?? {}, "retained script");
  if (typeof script.narrationText === "string") assert.equal(script.narrationText, narration);
  const competitorOutput = outputs.find((o) => Array.isArray(o.competitors));
  const competitors = competitorOutput
    ? list(competitorOutput.competitors, "competitors").flatMap((c) => list(row(c, "competitor").topVideos, "top videos"))
      .map((v) => {
        const video = row(v, "competitor video");
        assert.ok(typeof video.title === "string" && finite(video.views), "invalid retained competitor evidence");
        return { title: video.title, views: video.views };
      }).sort((a, b) => b.views - a.views).slice(0, 12)
    : [];
  const intel = row(outputs.find((o) => o.nicheIntel)?.nicheIntel ?? {}, "niche intelligence");
  const powerWords = Array.isArray(intel.powerWords)
    ? intel.powerWords.map((w) => optionalString(row(w, "power word").word)).filter((w): w is string => w !== undefined).slice(0, 12)
    : undefined;
  const bet = row(outputs.find((o) => o.topicBet)?.topicBet ?? {}, "topic bet");
  const params = list(channel.metadataParams ?? [], "metadata params");
  assert.ok(params.length <= 1, "ambiguous current metadata configuration");
  const metadataParams = row(params[0] ?? {}, "metadata params");
  const seo = row(channel.styleSeo ?? {}, "current style SEO");
  const niche = optionalString(identity.niche);
  const family = optionalString(channel.family) ?? optionalString(row(channel.contentLane ?? {}, "content lane").family);
  if (!narration) assert.equal(family, "music_loop", "missing narration is allowed only for evidenced non-narrated music format");
  const args: ExperimentPacket["args"] = {
    topic,
    channelName: String(channel.name),
    ...(niche === undefined ? {} : { niche }),
    ...(typeof identity.persona === "string" ? { persona: identity.persona } : {}),
    ...(typeof metadataParams.language === "string" ? { language: metadataParams.language } : {}),
    ...(narration === undefined ? {} : { scriptExcerpt: narration }),
    ...(typeof script.hook === "string" ? { coldOpen: script.hook } : {}),
    ...(typeof script.hookLoop === "string" ? { hookLoop: script.hookLoop } : {}),
    ...(typeof script.closingLine === "string" ? { quote: script.closingLine } : {}),
    ...(typeof bet.provisionalTitle === "string" ? { betTitle: bet.provisionalTitle } : {}),
    ...(powerWords === undefined ? {} : { powerWords }),
    ...(typeof seo.titleFormula === "string" ? { titleFormula: seo.titleFormula } : {}),
    ...(typeof seo.descriptionStructure === "string" ? { descriptionStructure: seo.descriptionStructure } : {}),
    ...(finite(metadataParams.clickbaitLevel) ? { clickbaitLevel: metadataParams.clickbaitLevel } : {}),
    isMusicNiche: /lofi|lo-fi|study|chill|ambient|sleep|relax|music|beats/i.test(niche ?? ""),
    competitorTitles: competitors,
    suggestions: [],
    sourceCoverage: { kind: narration === undefined ? "topic_only" : "full_narration",
      providedChars: narration?.length ?? 0, totalChars: narration?.length ?? null },
    ...(family === undefined ? {} : { format: family }),
  };
  return {
    version: "title-quality-experiment/v1", caseId: String(packet.caseId),
    runId: String(binding.runId), channelId: String(binding.channelId), historicalReplay: false,
    identityBasis: "current_identity_observed_with_retained_source",
    observedAt: String(row(packet.provenance, "provenance").observedAt),
    fixtureSha256: String(binding.sha256), sourceProjectionSha256: String(binding.sourceProjectionSha256),
    coverage: {
      narrationCharacters: narration?.length ?? 0, narrationSha256: narration === undefined ? null : sha256(narration),
      productionBaselineCallerExcerptCharacters: Math.min(narration?.length ?? 0, 800),
      experimentExcerptCharacters: narration?.length ?? 0, sourceFamily: family ?? null,
      missing: list(row(packet.availability, "availability").missing, "missing fields").map(String),
    },
    evidence: {
      suggestions: { status: "unavailable", values: [], reason: "Historical autocomplete was not retained; explicitly withheld from BOTH new experiment conditions. No live lookup." },
      competitors: { status: competitorOutput ? "retained" : "unavailable", values: competitors,
        reason: competitorOutput ? "Identical retained top12 input, sorted by views as caller. Baseline991b349 resolves10; current selector resolves12. Actual feed recorded per condition. Not freshly retrieved."
          : "Not retained; explicitly withheld from BOTH conditions. This is not an observed empty historical feed." },
    },
    args,
  };
}

export function loadExperiments(): ExperimentPacket[] {
  const manifest = row(JSON.parse(readFileSync(resolve(ROOT, "test-fixtures/title-baseline/manifest.json"), "utf8")), "manifest");
  assert.equal(manifest.version, "title-baseline-manifest/v1");
  assert.equal(manifest.historicalReplayReadyCases, 0);
  const bindings = list(manifest.cases, "cases");
  assert.equal(bindings.length, 8);
  return bindings.map((value) => {
    const binding = row(value, "binding");
    assert.match(String(binding.runId), /^[a-z0-9]+$/);
    const path = `test-fixtures/title-baseline/${binding.runId}.json`;
    assert.equal(binding.file, path);
    return prepareExperiment(binding, readFileSync(resolve(ROOT, path)));
  });
}

export type RecordedHttp = { requestSha256: string; status: number; rawBody: string; rawBodySha256: string };
type Event = { type: string; [key: string]: unknown };
type Sink = (event: Event) => void;
type Condition = "baseline" | "baseline-repeat" | "current";
type JsonCall = Parameters<typeof claudeJson>[0];
type JsonFunction = <T>(args: JsonCall) => Promise<T>;
/**
 * v1 intentionally held both transports at 991b349. The opt-in schema
 * intervention requires the current adapter and HTTP client too; report that
 * broader current source boundary explicitly, outside the frozen input packet.
 * Baseline and baseline-repeat still execute only unchanged 991b349 sources.
 */
export function benchmarkSourcePolicy(condition: Condition) {
  return {
    version: "title-runtime-source-policy/v2" as const,
    metadataAndDependencies: condition === "current" ? "current_working_tree" : "git_991b349",
    anthropicAndOpenRouter: condition === "current" ? "current_working_tree_opt_in_schema" : "git_991b349",
    usageRecorder: "current_bytes_verified_identical_to_git_991b349",
    intervention: condition === "current" ? "selector_and_opt_in_schema_transport" : "unchanged_baseline_selector_and_transport",
  };
}
export function titleCallPhase(prompt: string): "candidate" | "judge" {
  if (prompt.startsWith("Write SEVEN YouTube TITLE candidates for a video about ") ||
      prompt.startsWith("Write SEVEN YouTube TITLE candidates, one per useful frame:")) return "candidate";
  if (prompt.startsWith("You are a YouTube CTR strategist judging a real feed. Topic:") ||
      prompt.startsWith("You are a YouTube CTR strategist judging candidate titles against their actual source and channel identity.")) return "judge";
  throw new Error("unrecognized title call purpose; review the new prompt version before spending");
}
export type BenchmarkOptions = {
  condition: Condition;
  mode: "replay" | "live";
  maxCalls: number;
  spendCapUsd: number;
  replay?: RecordedHttp[];
  /** Test-only deterministic transport. It cannot be supplied from CLI. */
  testTransport?: (body: Row, index: number) => Promise<{ status: number; rawBody: string } | Response>;
  sink?: Sink;
};

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const key = process.env.OPENROUTER_API_KEY;
  if (key) message = message.split(key).join("[redacted]");
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1200);
}

/** Source is compiled, not rewritten. Each actual loaded source is hashed. */
type FrozenEvidence = { suggestions: { values: string[] }; competitors: { values: { title: string; views: number }[] } };
function isolatedRuntime(
  condition: Condition, transport: typeof fetch, jsonBoundary: (original: JsonFunction) => JsonFunction,
  frozen: { evidence: FrozenEvidence }, codeHashes: Record<string, string>, sourceArchive: Map<string, SourceArchiveEntry>,
) {
  const modules = new Map<string, { exports: Row }>();
  const env: Record<string, string | undefined> = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "offline-replay-only",
    OPENROUTER_INTELLIGENCE_MODEL: process.env.OPENROUTER_INTELLIGENCE_MODEL,
    OPENROUTER_CREATIVE_MODEL: process.env.OPENROUTER_CREATIVE_MODEL,
  };
  function load(path: string): Row {
    if (path === "src/lib/modelUsage.ts") {
      const text = readFileSync(resolve(ROOT, path), "utf8");
      assert.equal(text, gitSource(path), "usage recorder changed since transport baseline; freeze/review this intervention first");
      codeHashes[path] = sha256(text);
      return nativeRequire(resolve(ROOT, path)) as Row;
    }
    const prior = modules.get(path);
    if (prior) return prior.exports;
    const source = condition === "current"
      ? readFileSync(resolve(ROOT, path), "utf8") : gitSource(path);
    codeHashes[path] = sha256(source);
    if (condition === "current" && CURRENT_SOURCE_ARCHIVE_PATHS.some((allowed) => allowed === path)) {
      sourceArchive.set(path, { path, text: source, byteLength: Buffer.byteLength(source), sha256: codeHashes[path] });
    }
    const loadedModule = { exports: {} as Row };
    modules.set(path, loadedModule);
    const localRequire = (id: string) => {
      if (id === "@/lib/youtubeData") return {
        hasYouTubeDataAccess: () => false,
        searchVideoIds: () => { throw new Error("benchmark forbids unfrozen YouTube research"); },
        fetchVideoDetails: () => { throw new Error("benchmark forbids unfrozen YouTube research"); },
      };
      if (id.startsWith("node:") || !id.startsWith(".") && !id.startsWith("@/")) return nativeRequire(id);
      const target = id.startsWith("@/") ? `src/${id.slice(2)}.ts` : `${posix.join(posix.dirname(path), id)}.ts`;
      const imported = load(target);
      if (id === "@/lib/anthropic") return { ...imported, claudeJson: jsonBoundary(imported.claudeJson as JsonFunction) };
      return imported;
    };
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const sourceFetch: typeof fetch = path === "src/lib/metacraft.ts"
      ? async (url) => {
        assert.ok(String(url).startsWith("https://suggestqueries.google.com/complete/search?"), "unexpected metadata evidence request");
        return Response.json(["", frozen.evidence.suggestions.values]);
      } : transport;
    const execute = new Function("require", "exports", "module", "fetch", "process", output);
    execute(localRequire, loadedModule.exports, loadedModule, sourceFetch, { env });
    return loadedModule.exports;
  }
  return { metadata: load("src/lib/metacraft.ts"), load };
}

async function runTitleOperation(packet: ExperimentPacket | OraclePacket, options: BenchmarkOptions) {
  assert.ok(Number.isInteger(options.maxCalls) && options.maxCalls >= 1 && options.maxCalls <= 4, "maxCalls must be 1–4 per condition/case");
  assert.ok(finite(options.spendCapUsd) && options.spendCapUsd > 0 && options.spendCapUsd <= 5, "an explicit finite spend cap <=$5 is required");
  assert.ok(options.mode !== "live" || !options.testTransport && !options.replay, "live mode cannot use synthetic responses");
  if (options.mode === "live") assert.ok(process.env.OPENROUTER_API_KEY?.trim(), "live run requires an approved vault-hydrated key");
  assert.equal(packet.historicalReplay, false);
  const frozen = structuredClone(packet);
  const inputSha256 = sha256(JSON.stringify(frozen));
  const sourcePolicy = benchmarkSourcePolicy(options.condition);
  const scope = createModelUsageScope();
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const codeHashes: Record<string, string> = {};
  const sourceArchive = new Map<string, SourceArchiveEntry>();
  const requests: Event[] = [];
  const responses: RecordedHttp[] = [];
  const suppressed: Event[] = [];
  const attempts: { phase: string; elapsedMs: number; outcome: string }[] = [];
  let dispatched = 0;
  let hold: string | null = null;
  let knownProviderCost = 0;
  let knownMixedCost = 0;
  let providerCostCount = 0;
  let activePhase: "candidate" | "judge" | null = null;
  const sink = options.sink ?? (() => {});
  const emit = (event: Event) => sink({ caseId: packet.caseId, condition: options.condition, ...event });
  const accounted = () => Math.max(scope.snapshot().costUsd, knownMixedCost);
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), ENDPOINT, "unapproved benchmark network target");
    assert.equal(init?.method, "POST");
    if (hold) throw new Error(`benchmark spend hold: ${hold}`);
    if (dispatched >= options.maxCalls) { hold = "provider call ceiling reached"; throw new Error(hold); }
    const bodyText = String(init?.body);
    const body = row(JSON.parse(bodyText), "provider request");
    assert.equal(body.model, "google/gemini-3.7-flash", "benchmark must stay on the approved comparison route");
    const model = "google/gemini-3.7-flash";
    assert.ok(Number.isInteger(body.max_tokens) && Number(body.max_tokens) > 0 && Number(body.max_tokens) <= 8_000);
    // Text-only UTF-8 bytes are a conservative input-token reservation, not an
    // observed usage measurement. Real usage/cost below always comes from receipts.
    const reservation = priceModelUsage({ provider: "openrouter", model: body.model, kind: "text",
      inputTokens: Buffer.byteLength(bodyText), outputTokens: Number(body.max_tokens) });
    if (reservation.costUsd === undefined) { hold = "model has no known reservation price"; throw new Error(hold); }
    if (accounted() + reservation.costUsd > options.spendCapUsd) { hold = "remaining spend cap cannot reserve this call"; throw new Error(hold); }
    const requestSha256 = sha256(bodyText);
    assert.ok(activePhase, "each dispatched call needs an admitted title purpose");
    const request = { type: "request", phase: activePhase, index: dispatched, requestSha256, body,
      modelRouteSha256: sha256(JSON.stringify({ model: body.model, provider: body.provider })), reservationUsd: reservation.costUsd };
    requests.push(request); emit(request); // Deliberately excludes headers and environment.
    const index = dispatched++;
    const callStarted = performance.now();
    let response: Response;
    try {
      if (options.testTransport) {
        const synthetic = await options.testTransport(body, index);
        response = synthetic instanceof Response ? synthetic : new Response(synthetic.rawBody, { status: synthetic.status });
      }
      else if (options.mode === "replay") {
        const replay = options.replay?.[index];
        assert.ok(replay, "missing frozen provider replay response");
        assert.equal(replay.requestSha256, requestSha256, "replay request does not match exact prompt/options");
        assert.equal(replay.rawBodySha256, sha256(replay.rawBody), "replay response bytes changed");
        response = new Response(replay.rawBody, { status: replay.status });
      } else {
        response = await fetch(url, init);
      }
    } catch (error) {
      hold = options.mode === "live" ? "provider outcome/cost unknown; no further dispatch" : "replay/transport failed";
      if (options.mode === "live" || options.testTransport) recordModelUsage({ provider: "openrouter", model: body.model, kind: "text", unpricedReason: hold });
      emit({ type: "transport_failure", index, elapsedMs: performance.now() - callStarted, error: safeError(error), hold });
      throw error;
    }
    // Preserve the shipping client's separate header/body deadlines. Capturing
    // text inside fetch() would incorrectly spend the body on its header timeout.
    const readBody = response.text.bind(response);
    response.json = async () => {
      let rawBody: string;
      try { rawBody = await readBody(); }
      catch (error) {
        hold = "provider response body/cost unknown; no further dispatch";
        recordModelUsage({ provider: "openrouter", model, kind: "text", unpricedReason: hold });
        emit({ type: "body_failure", index, elapsedMs: performance.now() - callStarted, error: safeError(error), hold });
        throw error;
      }
    const recorded = { requestSha256, status: response.status, rawBody, rawBodySha256: sha256(rawBody) };
    responses.push(recorded);
    emit({ type: "response", index, ...recorded, elapsedMs: performance.now() - callStarted });
    let payload: Row | undefined;
    try { payload = row(JSON.parse(rawBody), "provider response"); } catch { /* Original client rejects malformed bodies. */ }
    const usage = payload?.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
      ? row(payload.usage, "usage") : undefined;
    if (usage && finite(usage.cost)) { knownProviderCost += usage.cost; providerCostCount++; }
    const priced = priceModelUsage({ provider: "openrouter", model: typeof payload?.model === "string" ? payload.model : model,
      kind: "text", inputTokens: finite(usage?.prompt_tokens) ? usage.prompt_tokens : undefined,
      outputTokens: finite(usage?.completion_tokens) ? usage.completion_tokens : undefined,
      reasoningTokens: finite(usage?.reasoning_tokens) ? usage.reasoning_tokens : undefined,
      cachedInputTokens: usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
        ? optionalTokenField(usage.prompt_tokens_details, "cached_tokens") : undefined });
    knownMixedCost += Math.max(usage && finite(usage.cost) ? usage.cost : 0, priced.costUsd ?? 0);
    if (response.status < 200 || response.status >= 300 || !payload) {
      hold = "HTTP/body failure has unresolved provider spend";
      recordModelUsage({ provider: "openrouter", model, kind: "text", unpricedReason: hold });
    } else if (!usage || !finite(usage.prompt_tokens) || !finite(usage.completion_tokens)) {
      hold = "provider usage missing or invalid; stop before another purchase";
    } else if (Object.hasOwn(usage, "cost") && !finite(usage.cost)) {
      hold = "provider reported invalid cost; stop before another purchase";
    }
      return JSON.parse(rawBody);
    };
    return response;
  };
  const wrapJson = (original: JsonFunction): JsonFunction => async <T>(args: JsonCall): Promise<T> => {
    const ancillary = args.prompt.startsWith("Write ONE pinned comment") ? "comment"
      : args.prompt.startsWith("Write the YouTube description + tags") ? "package" : null;
    if (ancillary) {
      const event = { type: "ancillary_suppressed", phase: ancillary, requestSha256: sha256(JSON.stringify(args)) };
      suppressed.push(event); emit(event);
      // Unchanged baseline must pass its ancillary shape check to expose its
      // OWN selected alternate/judged fields. Neither value is measured output.
      return (ancillary === "comment" ? { comment: "" }
        : { description: "[ancillary package intentionally suppressed]", tagsCsv: "suppressed,a,b,c,d" }) as T;
    }
    const phase = titleCallPhase(args.prompt);
    activePhase = phase;
    const t0 = performance.now();
    let outcome = "ok";
    try { return await original<T>(args); }
    catch (error) {
      outcome = safeError(error);
      if (error && typeof error === "object" && "outcome" in error && error.outcome === "unknown") {
        hold ??= "ambiguous provider outcome; no automatic repeat purchase";
      }
      throw error;
    }
    finally {
      activePhase = null;
      const usage = scope.snapshot();
      if (usage.unpricedCalls > 0) hold ??= "unpriced model usage";
      if (accounted() > options.spendCapUsd) hold ??= "reported spend exceeded cap; stop further dispatch";
      attempts.push({ phase, outcome, elapsedMs: performance.now() - t0 });
      emit({ type: "model_attempt", ...attempts.at(-1), usage, hold });
    }
  };
  let decision: unknown = null;
  let error: string | null = null;
  let preparationMs = 0;
  let selectionStarted: number | null = null;
  emit({ type: "experiment", mode: options.mode, inputSha256, packet: frozen, startedAt, baselineRevision: BASELINE_REVISION, harnessSha256: HARNESS_SHA256, sourcePolicy,
    maxCalls: options.maxCalls, spendCapUsd: options.spendCapUsd, historicalAnswerUsed: false });
  try {
    await scope.run(async () => {
      const runtime = isolatedRuntime(options.condition, transport, wrapJson, frozen, codeHashes, sourceArchive);
      if (options.condition === "current") {
        const files = CURRENT_SOURCE_ARCHIVE_PATHS.map((path) => {
          const saved = sourceArchive.get(path);
          assert.ok(saved, "current runtime source must be archived before a provider call");
          assert.equal(saved.byteLength, Buffer.byteLength(saved.text));
          assert.equal(saved.sha256, sha256(saved.text));
          assert.equal(saved.sha256, codeHashes[path], "archive must match the actual compiled source bytes");
          return saved;
        });
        files.push({ path: "scripts/title-quality-benchmark.ts", text: HARNESS_SOURCE,
          byteLength: Buffer.byteLength(HARNESS_SOURCE), sha256: HARNESS_SHA256 });
        // Only four allowlisted source texts. No interpolated environment,
        // request headers, credentials or runtime configuration is archived.
        emit({ type: "source_archive", version: "title-source-archive/v1", files });
      }
      preparationMs = performance.now() - started;
      selectionStarted = performance.now();
      emit({ type: "code_snapshot", codeHashes, sourcePolicy, compilerVersion: ts.version,
        pricingOverrideSha256: sha256(process.env.MODEL_PRICE_OVERRIDES_JSON ?? "no override") });
      if (options.condition === "current") {
        assert.equal(typeof runtime.metadata.selectTitle, "function", "current strict title-only selector is not available");
        const anthropic = runtime.load("src/lib/anthropic.ts");
        const io = {
          json: wrapJson(anthropic.claudeJson as JsonFunction),
          suggest: async () => frozen.evidence.suggestions.values,
          competitors: async () => frozen.evidence.competitors.values,
        };
        if (frozen.version === "title-oracle-operation/v1") {
          const judge = runtime.metadata.judgeTitleCandidates as (args: MetaCraftArgs, candidates: OracleCandidate[], runtime: unknown) => Promise<unknown>;
          decision = await judge(frozen.args, frozen.candidates, io);
        } else {
          const select = runtime.metadata.selectTitle as (args: MetaCraftArgs, runtime: unknown) => Promise<unknown>;
          decision = await select({ ...frozen.args, log: (message) => emit({ type: "log", message }) }, io);
        }
      } else {
        const craft = runtime.metadata.craftMetadata as (args: MetaCraftArgs) => Promise<Row>;
        const value = await craft({ ...frozen.args, log: (message) => emit({ type: "log", message }) });
        decision = { title: value.title, titleAlternate: value.titleAlternate, frame: value.frame,
          clickScore: value.clickScore, judged: value.judged, suggests: value.suggests, feed: value.feed };
      }
    });
  } catch (caught) { error = safeError(caught); }
  const usage = scope.snapshot();
  for (const key of ["costUsd", "calls", "inputTokens", "outputTokens", "unpricedCalls"] as const) assert.ok(finite(usage[key]), `nonfinite usage ${key}`);
  const result = {
    version: "title-quality-result/v1", mode: options.mode, condition: options.condition, startedAt, harnessSha256: HARNESS_SHA256, sourcePolicy,
    operation: frozen.version === "title-oracle-operation/v1" ? "judge_calibration" : "title_selection",
    caseId: packet.caseId, inputSha256, codeHashes, codeSha256: sha256(JSON.stringify(codeHashes)),
    compilerVersion: ts.version,
    pricingOverrideSha256: sha256(process.env.MODEL_PRICE_OVERRIDES_JSON ?? "no override"),
    status: hold ? "held" : error ? "failed" : "completed", error, hold, decision,
    elapsedMs: performance.now() - started, preparationMs,
    selectionElapsedMs: selectionStarted === null ? null : performance.now() - selectionStarted,
    dispatchedCalls: dispatched, attempts, requests, responses,
    liveProviderCalls: options.mode === "live" ? dispatched : 0,
    usageBasis: options.testTransport ? "synthetic_test_transport" : options.mode === "live" ? "live_provider_receipt" : "replayed_provider_receipt_no_new_spend",
    ancillarySuppressed: suppressed, usage,
    cost: { accountedUsd: accounted(), providerReportedUsd: providerCostCount ? knownProviderCost : null,
      accountingBasis: "Conservative per-call max(model-rate charge, provider-reported charge), summed; not a fabricated provider invoice.",
      providerCostResponseCount: providerCostCount, status: usage.unpricedCalls || hold ? "incomplete_or_unpriced"
        : providerCostCount === dispatched ? "provider_reported" : "priced_at_recorded_model_rates" },
    qualityClaim: "No historical answer key. Completion is not factual quality, owner preference, CTR or virality proof.",
  };
  emit({ type: "result", result });
  return result;
}

function optionalTokenField(value: object, key: string): number | undefined {
  const tokenValue = (value as Row)[key];
  return finite(tokenValue) ? tokenValue : undefined;
}

export function runBenchmarkCase(packet: ExperimentPacket, options: BenchmarkOptions) {
  return runTitleOperation(packet, options);
}

export const ORACLE_FIXTURE_SHA256 = "73123e875e0c5c8c339cc216d437f27300d1ecea92dff3d0f63798aa6f46cffd";
export const ORACLE_HOLDOUT_FIXTURE_SHA256 = "69d5f205d6a1c850cc681602269f405c2242084c1bf1fe972b0f2fd921ce82a3";
const ORACLE_CORPORA = {
  calibration: { version: "title-oracle-calibration/v1", sha256: ORACLE_FIXTURE_SHA256,
    count: 12, id: /^c(?:0[1-9]|1[0-2])$/ },
  holdout: { version: "title-oracle-holdout/v1", sha256: ORACLE_HOLDOUT_FIXTURE_SHA256,
    count: 6, id: /^h0[1-6]$/ },
} as const;
type OracleCorpus = keyof typeof ORACLE_CORPORA;
type OracleCandidate = { frame: string; title: string };
type Grounding = "supported" | "contradicted" | "insufficient";
type OracleExpectation = { idx: number; grounding: Grounding; identity: "acceptable" | "violates" | "not_asserted" };
export type OracleCase = {
  id: string; args: MetaCraftArgs; candidates: OracleCandidate[];
  fixtureVersion: typeof ORACLE_CORPORA[OracleCorpus]["version"]; fixtureSha256: string;
  sourceTextSha256: string; judgeInputSha256: string; expectations: OracleExpectation[]; expectationsSha256: string;
};
type OraclePacket = {
  version: "title-oracle-operation/v1"; caseId: string; historicalReplay: false;
  fixtureSha256: string; sourceTextSha256: string; originalJudgeInputSha256: string;
  order: "original" | "reversed"; originalIndexes: number[];
  args: MetaCraftArgs; candidates: OracleCandidate[]; evidence: FrozenEvidence;
};

/** Structural integrity checks are separate from all model evaluation. */
export function verifyOracleStructure(value: unknown, corpusKind: OracleCorpus = "calibration"): OracleCase[] {
  const expectedCorpus = ORACLE_CORPORA[corpusKind];
  assert.ok(expectedCorpus, "unknown oracle corpus");
  const corpus = row(value, "oracle corpus");
  assert.equal(corpus.version, expectedCorpus.version);
  assert.equal(corpus.providerCallsPerformed, 0);
  assert.equal(corpus.historicalReplay, false);
  assert.equal(corpus.ownerApprovedVideoTitlesIncluded, 0);
  if (corpusKind === "holdout") {
    const protocol = row(corpus.holdoutProtocol, "holdout protocol");
    assert.equal(protocol.revisedPromptInspected, false);
    assert.equal(protocol.exactCasesSharedWithPromptEditorBeforeFreeze, false);
  }
  const inputs = list(corpus.inputs, "oracle inputs");
  const provenance = list(corpus.provenance, "oracle provenance").map((v) => row(v, "provenance"));
  const expectations = list(corpus.expectations, "oracle expectations").map((v) => row(v, "expectation"));
  assert.equal(inputs.length, expectedCorpus.count); assert.equal(provenance.length, expectedCorpus.count);
  assert.equal(expectations.length, expectedCorpus.count);
  const ids = new Set<string>();
  const argsKeys = new Set(["topic", "channelName", "niche", "persona", "format", "language", "scriptExcerpt", "sourceCoverage", "suggestions", "competitorTitles"]);
  return inputs.map((value) => {
    const input = row(value, "oracle input");
    assert.deepEqual(Object.keys(input).sort(), ["args", "candidates", "id"], "labels/provenance must stay outside the judge input");
    const id = String(input.id); assert.match(id, expectedCorpus.id); assert.ok(!ids.has(id)); ids.add(id);
    const args = row(input.args, "oracle args");
    assert.ok(Object.keys(args).every((key) => argsKeys.has(key)), "non-allowlisted judge argument");
    for (const key of ["topic", "channelName", "niche", "persona", "format", "language", "scriptExcerpt"]) assert.equal(typeof args[key], "string");
    assert.ok(typeof args.topic === "string");
    assert.deepEqual(args.suggestions, []); assert.deepEqual(args.competitorTitles, []);
    const sourceCoverage = row(args.sourceCoverage, "source coverage");
    assert.deepEqual(Object.keys(sourceCoverage).sort(), ["kind", "providedChars", "totalChars"]);
    assert.ok(["full_narration", "script_excerpt", "topic_only"].includes(String(sourceCoverage.kind)));
    assert.equal(sourceCoverage.providedChars, (args.scriptExcerpt as string).length);
    assert.ok(sourceCoverage.totalChars === null || Number.isSafeInteger(sourceCoverage.totalChars) &&
      Number(sourceCoverage.totalChars) >= Number(sourceCoverage.providedChars));
    if (sourceCoverage.kind === "full_narration") assert.equal(sourceCoverage.totalChars, sourceCoverage.providedChars);
    if (sourceCoverage.kind === "topic_only") assert.equal(sourceCoverage.providedChars, 0);
    const candidates = list(input.candidates, "oracle candidates").map((value) => {
      const candidate = row(value, "candidate");
      assert.deepEqual(Object.keys(candidate).sort(), ["frame", "title"], "candidate labels must not enter model input");
      assert.equal(typeof candidate.frame, "string"); assert.equal(typeof candidate.title, "string");
      return { frame: candidate.frame as string, title: candidate.title as string };
    });
    assert.equal(candidates.length, 2);
    const refs = provenance.filter((p) => p.id === id); assert.equal(refs.length, 1);
    const reference = refs[0]; assert.equal(reference.historicalReplay, false);
    assert.equal(reference.sourceTextSha256, sha256(args.scriptExcerpt as string), "oracle source text changed");
    assert.equal(reference.judgeInputSha256, sha256(JSON.stringify({ args, candidates })), "oracle input changed");
    if (corpusKind === "holdout") assert.equal(reference.sourceOrigin, "synthetic_fact_packet");
    if (reference.sourceOrigin === "retained_narration_excerpt") {
      assert.equal(reference.retainedFixture, `test-fixtures/title-baseline/${reference.runId}.json`);
      assert.match(String(reference.runId), /^[a-z0-9]+$/);
      const bytes = readFileSync(resolve(ROOT, String(reference.retainedFixture)));
      assert.equal(sha256(bytes), reference.retainedFixtureSha256, "retained oracle fixture bytes changed");
      const saved = row(JSON.parse(bytes.toString("utf8")), "retained oracle source");
      const source = row(saved.source, "retained source"); assert.equal(source.runId, reference.runId);
      const stages = list(source.stages, "retained stages").map((s) => row(s, "stage"));
      const matches = stages.filter((s) => s.id === reference.narrationStageId); assert.equal(matches.length, 1);
      const narration = row(matches[0].outputs, "narration output").narrationText;
      assert.equal(typeof narration, "string"); assert.equal(sha256(narration as string), reference.narrationSha256);
      assert.ok(Number.isInteger(reference.excerptStart) && Number(reference.excerptStart) >= 0);
      assert.ok(Number.isInteger(reference.excerptEndExclusive) && Number(reference.excerptEndExclusive) <= (narration as string).length);
      assert.equal((narration as string).slice(Number(reference.excerptStart), Number(reference.excerptEndExclusive)), args.scriptExcerpt,
        "oracle excerpt offsets must bind exact retained text");
      assert.equal(sourceCoverage.totalChars, (narration as string).length);
    } else assert.equal(reference.sourceOrigin, "synthetic_fact_packet");
    const labels = expectations.filter((e) => e.id === id); assert.equal(labels.length, 1);
    const expected = list(labels[0].candidates, "expected candidates").map((v) => {
      const e = row(v, "expected candidate");
      assert.ok(e.idx === 0 || e.idx === 1);
      assert.ok(["supported", "contradicted", "insufficient"].includes(String(e.grounding)));
      assert.ok(["acceptable", "violates", "not_asserted"].includes(String(e.identity)));
      return { idx: e.idx, grounding: e.grounding as Grounding, identity: e.identity as OracleExpectation["identity"] };
    });
    assert.deepEqual(expected.map((e) => e.idx).sort(), [0, 1]);
    return { id, fixtureVersion: expectedCorpus.version, fixtureSha256: expectedCorpus.sha256,
      args: structuredClone({ ...args, topic: args.topic }), candidates,
      sourceTextSha256: String(reference.sourceTextSha256), judgeInputSha256: String(reference.judgeInputSha256),
      expectations: expected, expectationsSha256: sha256(JSON.stringify(expected)) };
  });
}

export function loadOracleCases(bytes = readFileSync(resolve(ROOT, "test-fixtures/title-oracle-calibration.json"))) {
  assert.equal(sha256(bytes), ORACLE_FIXTURE_SHA256, "frozen oracle fixture changed");
  return verifyOracleStructure(JSON.parse(bytes.toString("utf8")));
}

export function loadOracleHoldoutCases(bytes = readFileSync(resolve(ROOT, "test-fixtures/title-oracle-holdout.json"))) {
  assert.equal(sha256(bytes), ORACLE_HOLDOUT_FIXTURE_SHA256, "frozen oracle holdout fixture changed");
  return verifyOracleStructure(JSON.parse(bytes.toString("utf8")), "holdout");
}

export async function runOracleCalibrationCase(input: OracleCase, order: "original" | "reversed", options: BenchmarkOptions) {
  assert.equal(options.condition, "current", "calibrate the production judge seam, not a substitute");
  assert.equal(options.maxCalls, 1, "judge calibration permits exactly one provider call per case/order");
  assert.ok(order === "original" || order === "reversed");
  const corpus = Object.values(ORACLE_CORPORA).find((c) => c.version === input.fixtureVersion);
  assert.ok(corpus, "unknown oracle fixture version");
  assert.equal(input.fixtureSha256, corpus.sha256, "oracle fixture binding changed");
  assert.match(input.id, corpus.id);
  assert.equal(sha256(JSON.stringify({ args: input.args, candidates: input.candidates })), input.judgeInputSha256, "oracle input mutated after verification");
  assert.equal(sha256(JSON.stringify(input.expectations)), input.expectationsSha256, "oracle labels mutated after verification");
  const originalIndexes = order === "original" ? [0, 1] : [1, 0];
  const packet: OraclePacket = {
    version: "title-oracle-operation/v1", caseId: input.id, historicalReplay: false,
    fixtureSha256: input.fixtureSha256, sourceTextSha256: input.sourceTextSha256,
    originalJudgeInputSha256: input.judgeInputSha256, order, originalIndexes,
    args: structuredClone(input.args), candidates: originalIndexes.map((idx) => ({ ...input.candidates[idx] })),
    evidence: { suggestions: { values: [] }, competitors: { values: [] } },
  };
  const result = await runTitleOperation(packet, options);
  if (result.status !== "completed") return { ...result, calibration: null };
  const rankings = list(result.decision, "validated judge rankings").map((r) => row(r, "ranking"));
  const evaluated = rankings.map((ranking) => {
    const originalIndex = originalIndexes[Number(ranking.idx)];
    const expected = input.expectations.find((e) => e.idx === originalIndex)!;
    const identityAccepted = Number(ranking.identityFit) >= 7;
    return { originalIndex, actualGrounding: ranking.grounding, expectedGrounding: expected.grounding,
      factualMatch: ranking.grounding === expected.grounding, identityAccepted, expectedIdentity: expected.identity,
      identityMatch: expected.identity === "not_asserted" ? null : identityAccepted === (expected.identity === "acceptable") };
  }).sort((a, b) => a.originalIndex - b.originalIndex);
  const calibration = { order, evaluated,
    factualMatches: evaluated.filter((e) => e.factualMatch).length,
    falseFactualAcceptance: evaluated.filter((e) => e.expectedGrounding !== "supported" && e.actualGrounding === "supported").length,
    falseFactualRejection: evaluated.filter((e) => e.expectedGrounding === "supported" && e.actualGrounding !== "supported").length,
    identityFalseAcceptance: evaluated.filter((e) => e.expectedIdentity === "violates" && e.identityAccepted).length,
    identityFalseRejection: evaluated.filter((e) => e.expectedIdentity === "acceptable" && !e.identityAccepted).length,
    note: "Source fidelity and labeled identity checks only; no forced creative winner or measured audience engagement." };
  options.sink?.({ type: "oracle_calibration", caseId: input.id, condition: "current", calibration });
  return { ...result, calibration };
}

async function main() {
  const flags = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]; const value = process.argv[index + 1];
    assert.ok(["--mode", "--condition", "--case", "--oracle-case", "--oracle-fixture", "--order", "--replay", "--out", "--max-calls", "--spend-cap-usd"].includes(key) && value && !value.startsWith("--"), "use explicit named flag/value pairs");
    assert.ok(!flags.has(key), "duplicate flag"); flags.set(key, value);
  }
  const packets = loadExperiments();
  if (!flags.size) {
    console.log(JSON.stringify({ mode: "replay", networkEnabled: false, preparedCases: packets.map((p) => ({ runId: p.runId, caseId: p.caseId, inputSha256: sha256(JSON.stringify(p)), narrationCharacters: p.coverage.narrationCharacters })),
      usage: "--mode replay|live --condition baseline|baseline-repeat|current --case RUN_ID --max-calls 4 --spend-cap-usd 0.20 --out NEW_RECEIPT.jsonl [--replay REPLAY.json]",
      oracleUsage: "--mode replay|live --condition current [--oracle-fixture calibration|holdout] --oracle-case c01|h01 --order original|reversed --max-calls 1 --spend-cap-usd 0.05 --out NEW_RECEIPT.jsonl [--replay REPLAY.json]" }, null, 2));
    return;
  }
  const mode = flags.get("--mode") ?? "replay";
  assert.ok(mode === "live" || mode === "replay");
  const condition = flags.get("--condition");
  assert.ok(condition === "baseline" || condition === "baseline-repeat" || condition === "current");
  const oracleId = flags.get("--oracle-case");
  const oracleFixture = flags.get("--oracle-fixture") ?? "calibration";
  assert.ok(oracleFixture === "calibration" || oracleFixture === "holdout", "unknown oracle fixture");
  assert.ok(oracleId || !flags.has("--oracle-fixture"), "oracle fixture selection requires an oracle case");
  assert.ok(!oracleId || !flags.has("--case"), "choose a source experiment OR a calibration case");
  const packet = packets.find((p) => p.runId === flags.get("--case"));
  const oracle = oracleId ? (oracleFixture === "holdout" ? loadOracleHoldoutCases() : loadOracleCases()).find((c) => c.id === oracleId) : undefined;
  assert.ok(oracle || packet, "select one exact frozen source or oracle case");
  const order = flags.get("--order");
  assert.ok(!oracle || order === "original" || order === "reversed", "oracle order must be explicit");
  assert.ok(oracle || !order, "candidate order is for judge calibration only");
  const output = flags.get("--out"); assert.ok(output, "a new receipt file is required");
  const replayPath = flags.get("--replay");
  assert.ok(mode !== "replay" || replayPath, "offline mode needs frozen raw-response replay; never falls through to live");
  assert.ok(mode !== "live" || !replayPath);
  writeFileSync(output, "", { flag: "wx", mode: 0o600 });
  const options: BenchmarkOptions = { mode, condition,
    maxCalls: Number(flags.get("--max-calls")), spendCapUsd: Number(flags.get("--spend-cap-usd")),
    replay: replayPath ? JSON.parse(readFileSync(replayPath, "utf8")) : undefined,
    sink: (event) => appendFileSync(output, `${JSON.stringify(event)}\n`),
  };
  const result = oracle ? await runOracleCalibrationCase(oracle, order as "original" | "reversed", options)
    : await runBenchmarkCase(packet!, options);
  console.log(JSON.stringify({ status: result.status, caseId: result.caseId, inputSha256: result.inputSha256,
    calls: result.dispatchedCalls, cost: result.cost, output }));
  if (result.status !== "completed") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(safeError(error)); process.exitCode = 1; });
}
