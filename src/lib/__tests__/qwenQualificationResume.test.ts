import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as qwen from "@/lib/qwenTts";

type Report = { takes: Array<Record<string, unknown> & { id: string; audioSha256: string; runtimeReceipt: qwen.QwenTtsReceipt | null }> };
const repo = process.cwd(), requireLocal = createRequire(join(repo, "package.json"));
const source = fs.readFileSync(process.env.QWEN_QUALIFICATION_BASELINE_SOURCE ?? join(repo, "scripts/qwen-tts-qualify.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
assert.equal(compiled.split("main().catch(").length, 2);
// Expose the actual CLI's existing completion promise, not a fake implementation.
const executable = compiled.replace("main().catch(", "module.exports.completion = main().catch(");
const root = fs.mkdtempSync(join(tmpdir(), "ysa-qwen-qualification-test-"));
const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const audio = Buffer.alloc(2048, 23); audio.set([0x49, 0x44, 0x33]);
let requests: Record<string, unknown>[] = [], offline = false, failPost = -1;
globalThis.fetch = async (_url, init) => {
  assert.equal(offline, false, "offline finalization must not contact a provider");
  const request = JSON.parse(String(init?.body)) as Record<string, unknown>; requests.push(request);
  assert.equal(new Headers(init?.headers).get("Idempotency-Key"), request.requestKey);
  if (requests.length === failPost) throw new TypeError("guarded unknown outcome after submission");
  const body = execFileSync("python3", [join(repo, "workers/qwen3-tts/contract.py"), "--fixture"], {
    input: JSON.stringify({ payload: request, idempotencyKey: request.requestKey, audioBase64: audio.toString("base64"), durationSec: 20, requestGpuSeconds: 10, gpuRateUsdPerSecond: 0.00005 }), encoding: "utf8",
  });
  return Response.json(JSON.parse(body));
};

function readReport(out: string): Report { return JSON.parse(fs.readFileSync(join(out, "qualification.json"), "utf8")) as Report; }
function verdictFile(out: string, mutate?: (value: Record<string, unknown>) => void): string {
  const verdicts: Record<string, unknown> = Object.fromEntries(readReport(out).takes.map((take) => [take.id, { audioSha256: take.audioSha256, decision: "accept", verdict: "Synthetic test control, not a genuine listening verdict." }]));
  mutate?.(verdicts);
  const file = join(root, `verdicts-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(verdicts)); return file;
}
function snapshot(out: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(out).sort().filter((name) => fs.lstatSync(join(out, name)).isFile()).map((name) => [name, digest(fs.readFileSync(join(out, name)))]));
}
function cloneEvidence(from: string, name: string): string {
  const to = join(root, name); fs.mkdirSync(to); fs.cpSync(from, to, { recursive: true }); return to;
}

async function run(out: string, options: { verdicts?: string; offline?: boolean; measurementFailure?: number; measurementShape?: string; matrixMutation?: (source: string) => string; qualityFailure?: string; failPost?: number; beforePost?: () => void; beforeMeasure?: (path: string) => void } = {}) {
  requests = []; offline = options.offline ?? false; failPost = options.failPost ?? -1;
  if (offline) { delete process.env.QWEN3_TTS_WORKER_URL; delete process.env.QWEN3_TTS_WORKER_TOKEN; }
  else {
    process.env.QWEN3_TTS_WORKER_URL = "https://guarded.invalid/synthesize";
    process.env.QWEN3_TTS_WORKER_TOKEN = "local-synthetic-token-no-real-credential-0000";
  }
  let measurements = 0, synthCalls = 0, readinessCalls = 0;
  const lines: string[] = [], exits: number[] = [];
  const mod = { exports: {} as { completion?: Promise<unknown> } };
  const args = ["tsx", "scripts/qwen-tts-qualify.ts", "--out", out, ...(options.verdicts ? ["--verdicts", options.verdicts] : [])];
  const scriptQwen = { ...qwen,
    qwenTtsReadiness: () => { readinessCalls += 1; return qwen.qwenTtsReadiness(); },
    synthQwenNarration: async (...args: Parameters<typeof qwen.synthQwenNarration>) => { synthCalls += 1; options.beforePost?.(); return qwen.synthQwenNarration(...args); },
  };
  const guardedRequire = (name: string) => {
    if (name === "@/lib/qwenTts") return scriptQwen;
    if (name === "node:child_process") return { execFileSync: (exe: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      assert.equal(exe, "python3"); assert.equal(args[0], join(repo, "scripts/qwen_take_measure.py"));
      measurements += 1;
      if (offline) { assert.equal(opts.env?.HF_HUB_OFFLINE, "1"); assert.equal(opts.env?.TRANSFORMERS_OFFLINE, "1"); }
      const file = args[args.indexOf("--audio") + 1]!, text = args[args.indexOf("--reference") + 1]!;
      options.beforeMeasure?.(file);
      if (measurements === options.measurementFailure) throw new Error("guarded measurement process failure");
      if (options.measurementShape !== undefined) return options.measurementShape;
      return JSON.stringify({ durationSec: 20, lufs: options.qualityFailure === "loudness" ? -30 : -18,
        truePeakDbtp: options.qualityFailure === "peak" ? -0.1 : -2, transcript: text,
        wer: options.qualityFailure === "unmeasured" ? null : options.qualityFailure === "wer" ? 0.5 : 0,
        referenceWords: 30, wordsPerSec: options.qualityFailure === "pace" ? 2 : file.includes("calm") ? 1 : 2 });
    } };
    assert.ok(["node:crypto", "node:fs", "node:path"].includes(name), `unapproved import ${name}`);
    return requireLocal(name);
  };
  const code = options.matrixMutation ? ts.transpileModule(options.matrixMutation(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText.replace("main().catch(", "module.exports.completion = main().catch(") : executable;
  new vm.Script(code, { filename: join(repo, "scripts/qwen-tts-qualify.ts") }).runInNewContext({
    require: guardedRequire, module: mod, exports: mod.exports,
    process: { argv: args, env: process.env, cwd: () => repo, stdout: { write: (line: string) => lines.push(line) }, exit: (code: number) => { exits.push(code); throw new Error(`AUDIT_EXIT_${code}`); } },
    console: { log: (...xs: unknown[]) => lines.push(xs.join(" ")), error: (...xs: unknown[]) => lines.push(xs.join(" ")) },
  });
  try { await mod.exports.completion; } catch (error) { assert.match(String(error), /AUDIT_EXIT_/); }
  return { code: exits[0] ?? 0, posts: requests.length, measurements, synthCalls, readinessCalls, lines, requests: structuredClone(requests) };
}

async function main() {
  const fresh = join(root, "fresh");
  const initial = await run(fresh);
  assert.equal(initial.posts, 6); assert.equal(initial.measurements, 6); assert.equal(initial.code, 3);
  const original = readReport(fresh), originalAudio = original.takes.map((take) => digest(fs.readFileSync(join(fresh, `${take.id}.mp3`))));
  const verdicts = verdictFile(fresh);
  const configuredFinalization = await run(fresh, { verdicts });
  assert.equal(configuredFinalization.posts, 0, "adding verdicts must not buy six more takes even when worker credentials are configured");
  const finalized = await run(fresh, { verdicts, offline: true });
  assert.equal(finalized.code, 0, finalized.lines.join("\n"));
  assert.equal(finalized.posts, 0); assert.equal(finalized.synthCalls, 0); assert.equal(finalized.readinessCalls, 0);
  assert.equal(finalized.measurements, 6); assert.ok(finalized.lines.some((line) => /^\nRECEIPT [a-f0-9]{64}$/.test(line)));
  assert.deepEqual(readReport(fresh).takes.map((take) => take.runtimeReceipt), original.takes.map((take) => take.runtimeReceipt));
  assert.deepEqual(original.takes.map((take) => digest(fs.readFileSync(join(fresh, `${take.id}.mp3`)))), originalAudio);
  console.log("PASS initial6→offline0 provider calls; all6 remeasured; original receipts/costs and MP3s identical");

  const generationAgain = await run(fresh);
  assert.notEqual(generationAgain.code, 0); assert.equal(generationAgain.posts, 0); assert.equal(generationAgain.synthCalls, 0);
  const malformed: Array<[string, (out: string) => void]> = [
    ["missing audio", (out) => fs.unlinkSync(join(out, `${original.takes[0]!.id}.mp3`))],
    ["corrupt audio", (out) => fs.writeFileSync(join(out, `${original.takes[0]!.id}.mp3`), Buffer.alloc(2048, 0))],
    ["symlink audio", (out) => { const file = join(out, `${original.takes[0]!.id}.mp3`); fs.unlinkSync(file); fs.symlinkSync(join(fresh, `${original.takes[0]!.id}.mp3`), file); }],
    ...["requestKey", "textSha256", "instructionSha256", "revision", "speaker", "language", "seed", "audioSha256"].map((field): [string, (out: string) => void] => [field, (out) => {
      const report = readReport(out); (report.takes[0]!.runtimeReceipt as unknown as Record<string, unknown>)[field] = field === "seed" ? 4243 : "changed"; fs.writeFileSync(join(out, "qualification.json"), JSON.stringify(report));
    }]),
    ["missing receipt", (out) => { const report = readReport(out); report.takes[0]!.runtimeReceipt = null; fs.writeFileSync(join(out, "qualification.json"), JSON.stringify(report)); }],
    ["duplicate take", (out) => { const report = readReport(out); report.takes[1] = report.takes[0]!; fs.writeFileSync(join(out, "qualification.json"), JSON.stringify(report)); }],
    ["missing report", (out) => fs.unlinkSync(join(out, "qualification.json"))],
  ];
  for (const [name, change] of malformed) {
    const out = cloneEvidence(fresh, name.replaceAll(" ", "-")); change(out); const before = snapshot(out);
    const result = await run(out, { verdicts, offline: true });
    assert.notEqual(result.code, 0, name); assert.equal(result.synthCalls, 0, name); assert.equal(result.measurements, 0, name);
    assert.deepEqual(snapshot(out), before, `${name}: refusal must preserve existing evidence`);
  }
  for (const [beforeText, afterText] of [["By the spring of 1945", "By the spring of 1946"], ["Speak slowly and calmly", "Speak clearly and quietly"]]) {
    const before = snapshot(fresh);
    assert.ok(source.includes(beforeText!));
    const result = await run(fresh, { verdicts, offline: true, matrixMutation: (text) => text.replace(beforeText!, afterText!) });
    assert.notEqual(result.code, 0); assert.equal(result.synthCalls, 0); assert.equal(result.measurements, 0);
    assert.deepEqual(snapshot(fresh), before, "changed current matrix identity cannot reuse or overwrite old evidence");
  }
  for (const [name, change] of [
    ["unbound string", (v: Record<string, unknown>) => { v[original.takes[0]!.id] = "great"; }],
    ["wrong reviewed audio", (v: Record<string, unknown>) => { (v[original.takes[0]!.id] as Record<string, unknown>).audioSha256 = "a".repeat(64); }],
  ] as const) {
    const result = await run(fresh, { verdicts: verdictFile(fresh, change), offline: true });
    assert.notEqual(result.code, 0, name); assert.equal(result.synthCalls, 0); assert.equal(result.measurements, 0);
  }
  const rejected = await run(fresh, { verdicts: verdictFile(fresh, (v) => { (v[original.takes[0]!.id] as Record<string, unknown>).decision = "reject"; }), offline: true, measurementFailure: 1 });
  assert.notEqual(rejected.code, 0); assert.ok(!rejected.lines.some((line) => /^\nRECEIPT /.test(line)));
  assert.equal((readReport(fresh).takes[0]!.humanVerdict as Record<string, unknown>).decision, "reject");
  for (const qualityFailure of ["wer", "loudness", "pace", "peak", "unmeasured"]) {
    const result = await run(fresh, { verdicts, offline: true, qualityFailure });
    assert.notEqual(result.code, 0, qualityFailure); assert.equal(result.synthCalls, 0);
    assert.ok(!result.lines.some((line) => /^\nRECEIPT /.test(line)));
  }
  const remeasureFailure = await run(fresh, { verdicts, offline: true, measurementFailure: 2 });
  assert.notEqual(remeasureFailure.code, 0); assert.equal(remeasureFailure.synthCalls, 0);
  assert.deepEqual(readReport(fresh).takes.map((take) => take.runtimeReceipt), original.takes.map((take) => take.runtimeReceipt));
  for (const measurementShape of ["null", "[]", "\"not measurements\"", "{}", "not JSON"]) {
    const result = await run(fresh, { verdicts, offline: true, measurementShape });
    assert.notEqual(result.code, 0, measurementShape); assert.equal(result.synthCalls, 0);
    assert.ok(!result.lines.some((line) => /^\nRECEIPT /.test(line)));
    assert.deepEqual(readReport(fresh).takes.map((take) => take.runtimeReceipt), original.takes.map((take) => take.runtimeReceipt));
  }
  const changing = cloneEvidence(fresh, "changing-audio");
  const changedDuringMeasurement = await run(changing, { verdicts, offline: true,
    beforeMeasure: (file) => fs.writeFileSync(file, Buffer.alloc(2048, 25)),
  });
  assert.notEqual(changedDuringMeasurement.code, 0); assert.equal(changedDuringMeasurement.synthCalls, 0);
  assert.ok(!changedDuringMeasurement.lines.some((line) => /^\nRECEIPT /.test(line)));
  const legacy = cloneEvidence(fresh, "legacy-report");
  const oldReport = readReport(legacy); for (const take of oldReport.takes) take.humanVerdict = "old unbound note ignored";
  fs.writeFileSync(join(legacy, "qualification.json"), JSON.stringify(oldReport));
  const legacyResult = await run(legacy, { verdicts, offline: true });
  assert.equal(legacyResult.code, 0, "old v1 receipt rows are reusable after strict current identity/audio checks and new bound verdicts");
  assert.equal(legacyResult.synthCalls, 0);

  const partial = join(root, "partial-measurement");
  const firstPartial = await run(partial, { measurementFailure: 2,
    beforePost: () => assert.ok(fs.existsSync(join(partial, "qualification.json")), "existing report is created before any POST"),
    beforeMeasure: (file) => { const report = readReport(partial); const take = report.takes.find((take) => file.endsWith(`${take.id}.mp3`)); assert.ok(take?.runtimeReceipt, "receipt checkpoint precedes measurement"); assert.equal(take?.audioSha256, digest(fs.readFileSync(file))); },
  });
  assert.equal(firstPartial.posts, 6); assert.equal(firstPartial.code, 2);
  assert.equal(readReport(partial).takes.filter((take) => take.runtimeReceipt).length, 6);
  const recovered = await run(partial, { verdicts: verdictFile(partial), offline: true });
  assert.equal(recovered.code, 0, recovered.lines.join("\n")); assert.equal(recovered.synthCalls, 0);
  const unknown = join(root, "unknown-outcome");
  const unknownRun = await run(unknown, { failPost: 2 });
  assert.equal(unknownRun.code, 2); const retainedUnknown = snapshot(unknown);
  const automaticRetry = await run(unknown);
  assert.notEqual(automaticRetry.code, 0); assert.equal(automaticRetry.synthCalls, 0); assert.deepEqual(snapshot(unknown), retainedUnknown);
  const unknownFinal = await run(unknown, { verdicts: verdictFile(unknown), offline: true });
  assert.notEqual(unknownFinal.code, 0); assert.equal(unknownFinal.synthCalls, 0); assert.deepEqual(snapshot(unknown), retainedUnknown);
  console.log(`PASS ${malformed.length} retained-evidence corruptions, bound/reject verdicts, unchanged quality gates, partial measurement recovery, unknown outcomes fail closed; evidence ${root}`);
}
main().finally(() => { globalThis.fetch = savedFetch; process.env = savedEnv; });
