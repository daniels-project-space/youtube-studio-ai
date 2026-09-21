import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { registerAllBlocks } from "@/engine/blocks";
import { MusicArrangementIntentSchema } from "@/engine/acceptedMusicArrangement";
import { getManifest } from "@/engine/registry";
import type { StageContext } from "@/engine/types";
import { agentJsonConfiguration } from "@/agents/mastra";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { createModelUsageScope } from "@/lib/modelUsage";
import { createYuE2AcceptedArrangementRequest } from "@/lib/yue2Evaluation";
import { SCORED_ARRANGEMENT_COMPOSER_VERSION, musicArrangementPlan } from "@/trigger/blocks/musicArrangementBlocks";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128);
const inputSchema = z.object({
  ownerId: identifier, channelId: identifier, runId: identifier,
  provenance: z.string().min(1).max(4000),
  family: z.string().min(1).max(100),
  musicIntent: MusicArrangementIntentSchema,
  seed: z.number().int().nonnegative().max(2147483647),
  budgetUsd: z.number().finite().positive(),
  seedStore: z.record(z.unknown()).refine(store =>
    typeof store.topic === "string" && store.topic.trim().length > 0 &&
    typeof store.channelSlug === "string" && store.channelSlug.trim().length > 0,
  "frozen topic and channel grounding are required; live channel fallback is forbidden"),
}).strict();

export function validateLocalYuE2Score(runtime: string, job?: unknown) {
  if (!isAbsolute(runtime)) throw new Error("runtime path must be absolute");
  const result = spawnSync(join(runtime, ".venv-test/bin/python"), ["-c", job === undefined
    ? "from music_runtime.config import validate_job; print('ready')"
    : "import json,sys; from music_runtime.config import validate_job; validate_job(json.load(sys.stdin)); print('valid')"], {
    input: job === undefined ? undefined : JSON.stringify(job), encoding: "utf8", timeout: 10000, maxBuffer: 65536,
    env: { NODE_ENV: "test", PATH: process.env.PATH, PYTHONPATH: join(runtime, "src"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error || result.status !== 0) throw new Error(`native score validation failed: ${result.error?.message ?? result.stderr}`);
}

/** Isolated operator evaluation, never a production run lease or channel mutation. */
export async function evaluateMusicComposer(value: unknown, options: { output?: string; runtime?: string; submit?: boolean }) {
  const input = inputSchema.parse(value);
  if (Buffer.byteLength(canonicalJson(input)) > 128 * 1024) throw new Error("composer evaluation input too large");
  registerAllBlocks();
  const composer = getManifest("composer_brief", SCORED_ARRANGEMENT_COMPOSER_VERSION)!;
  const reservationUsd = z.number().finite().positive().parse(composer.costAndLatency.maxCostUsd);
  if (input.budgetUsd < reservationUsd) throw new Error("composer evaluation budget below reservation");
  const implementation: Record<string, string> = {};
  for (const relative of ["./evaluate-music-composer.ts", "../engine/creative/crew.ts",
    "../trigger/blocks/musicArrangementBlocks.ts", "../trigger/blocks/crewBlocks.ts",
    "../engine/acceptedMusicArrangement.ts", "../agents/mastra.ts", "../lib/arrangementComposerBudget.ts"]) {
    implementation[relative] = sha256Hex(await readFile(new URL(relative, import.meta.url), "utf8"));
  }
  const binding = { version: "music-composer-evaluation/v1", input, implementation,
    composerVersion: composer.version, model: agentJsonConfiguration("composer_arrangement").model, reservationUsd };
  const inputFingerprint = sha256Hex(canonicalJson(binding));
  if (!options.submit) return { status: "validated", inputFingerprint, reservationUsd, providerCalls: 0, gpuCalls: 0 };
  if (!options.output || !options.runtime) throw new Error("submission requires output directory and local runtime parser");
  validateLocalYuE2Score(options.runtime);
  const directory = resolve(options.output);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const save = (name: string, data: unknown) => writeFile(join(directory, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  // Claim before any paid call. A crash or failed result must never authorize replay.
  await save("attempt.json", { ...binding, inputFingerprint, startedAt: new Date().toISOString() });
  const usage = createModelUsageScope();
  let dispatched = false;
  const context: StageContext = {
    ownerId: input.ownerId, channelId: input.channelId, runId: input.runId,
    keyPrefix: `evaluation/${input.runId}/`, params: { family: input.family, musicIntent: input.musicIntent },
    store: input.seedStore, budgetUsd: input.budgetUsd, stageBudgetUsd: reservationUsd,
    log: () => {},
    assertInlinePaidExecutionLease: async () => {
      if (dispatched) throw new Error("composer evaluation permits one dispatch only");
      await save("dispatch.json", { inputFingerprint, dispatchedAt: new Date().toISOString() });
      dispatched = true;
    },
  };
  try {
    const patch = await usage.run(() => composer.execute(context));
    await save("brief.json", patch);
    const accepted = await musicArrangementPlan.run({ ...context, store: { ...context.store, ...patch } });
    const request = createYuE2AcceptedArrangementRequest({
      arrangement: accepted.acceptedMusicArrangement, seed: input.seed, personalCreatorAcknowledged: true,
    });
    await save("arrangement.json", request.acceptedArrangement);
    await save("request.json", request);
    validateLocalYuE2Score(options.runtime, request.job);
    const measured = usage.snapshot();
    if (measured.calls !== 1 || measured.unpricedCalls || measured.costUsd > input.budgetUsd) {
      throw new Error("composer evaluation requires exactly one fully priced call within budget");
    }
    const result = { status: "score_validated", inputFingerprint, reservationUsd, usage: measured,
      jobId: request.job.job_id, gpuCalls: 0, productionApproved: false, musicalQualityApproved: false };
    await save("result.json", result);
    return result;
  } catch (error) {
    await save("failure.json", { status: "held", inputFingerprint, dispatched, usage: usage.snapshot(),
      error: error instanceof Error ? error.message : String(error), gpuCalls: 0, automaticRetryAllowed: false });
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, out: { type: "string" }, runtime: { type: "string" }, submit: { type: "boolean", default: false },
  }, strict: true, allowPositionals: false });
  if (!values.input) throw new Error("--input is required");
  const bytes = await readFile(values.input);
  if (bytes.byteLength > 128 * 1024) throw new Error("composer evaluation input too large");
  const result = await evaluateMusicComposer(JSON.parse(bytes.toString("utf8")), {
    output: values.out, runtime: values.runtime, submit: values.submit,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
