/**
 * Character LoRA wiring + honesty lock.
 *
 * This module's ONLY job is producing and serving a persistent character
 * identity, and the claims that make it safe to reuse are all falsifiable:
 *
 *   1. the serving module NEVER generates anything — no provider client, no
 *      network call, no render import (grepped against its own source);
 *   2. the training module generates ONLY training inputs — no image-to-video,
 *      no render farm, no episode artifact;
 *   3. the stored reference shape is validated, and a malformed one degrades to
 *      "no character" rather than bricking a render;
 *   4. the consumption helper produces a well-formed `loras` array, and REFUSES
 *      to produce one for an endpoint that cannot consume it;
 *   5. the storage lives on the channel identity, not in a parallel system;
 *   6. the provider-evidence table is honest about what is docs-only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyCharacterTriggerWords,
  assertCharacterLoraRef,
  canApplyCharacterLora,
  characterLoraDefects,
  characterLoraRefs,
  CharacterLoraUnsupportedSurfaceError,
  CHARACTER_LORA_MAX_IMPORT_BYTES,
  CHARACTER_LORA_MAX_REFS,
  CHARACTER_LORA_VERSION,
  loraPathDefects,
  LORA_SURFACES,
  makeImportedCharacterLora,
  makeTrainedCharacterLora,
  parseCharacterLora,
} from "@/lib/characterLora";
import {
  BOOTSTRAP_MIN_IMAGES,
  characterLoraCostEnvelope,
  importCharacterLora,
  NovitaCharacterLoraClient,
  NovitaCharacterLoraError,
  NOVITA_LORA_API_EVIDENCE,
  planBootstrapImages,
  servingModelName,
  TRAINING_TERMINAL_STATUSES,
} from "@/lib/novitaCharacterLora";

const ROOT = join(__dirname, "../../..");

/**
 * Strip comments before grepping. The claim under test is "this module makes no
 * generation CALL", not "this module never mentions an endpoint" — and the
 * modules deliberately document the endpoints they are keeping away from, which
 * a naive source grep would read as a violation.
 */
function codeOnly(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function separationOfConcerns(): void {
  /* 1 — the SERVING module generates nothing at all */
  const serving = codeOnly("src/lib/characterLora.ts");
  // Import and call forms, not bare mentions: the module deliberately DOCUMENTS
  // the endpoints it stays away from (LORA_SURFACES notes name them), and a
  // string in a capability table is the opposite of a hidden generation call.
  for (const forbidden of [
    "fetch(",
    "https://api.novita.ai",
    "renderImages(",
    "renderVideo(",
    "@/lib/novitaRenderFarm",
    "@/lib/novitaDirectRender",
    "@/lib/novitaMedia",
    "@/lib/gemini",
    "/v3/async/",
    "@remotion",
    "putObject(",
    "geminiJson(",
  ]) {
    assert.ok(
      !serving.includes(forbidden),
      `characterLora.ts must never generate content (found "${forbidden}") — its only job is to store and serve a reference`,
    );
  }
  // It must also import nothing that could generate: a pure module has no
  // provider dependency edges at all.
  const servingImports = [...serving.matchAll(/^import .*?from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(servingImports, [], "characterLora.ts must have zero imports to stay provably pure");

  /* 2 — the TRAINING module produces training inputs only */
  const training = codeOnly("src/lib/novitaCharacterLora.ts");
  for (const forbidden of [
    "/v3/async/img2video",
    "image-to-video",
    "@/lib/novitaRenderFarm",
    "@/lib/novitaDirectRender",
    "renderVideo(",
    "timeline_assemble",
    "videoKey",
    "@remotion",
  ]) {
    assert.ok(
      !training.includes(forbidden),
      `novitaCharacterLora.ts must never touch episode rendering (found "${forbidden}")`,
    );
  }
  // The ONE generation endpoint it may call is the bootstrap text-to-image one.
  assert.ok(training.includes("/v3/async/z-image-turbo"), "the train path bootstraps its own dataset");
  assert.ok(training.includes("/v3/training/subject"), "the train path submits a real subject-training task");

  /* HTTP conventions must match the existing Novita client, not invent a style */
  const fleet = codeOnly("src/lib/novitaFleet.ts");
  for (const convention of ["authorization: `Bearer ", "AbortSignal.timeout"]) {
    assert.ok(fleet.includes(convention), `precondition: novitaFleet.ts uses ${convention}`);
    assert.ok(
      training.includes(convention),
      `novitaCharacterLora.ts must follow the existing Novita client convention (${convention})`,
    );
  }
  assert.ok(
    training.includes("failed with HTTP ${response.status}"),
    "provider errors must report status without reflecting the response body",
  );
}

function referenceShape(): void {
  const trained = makeTrainedCharacterLora({
    novitaLoraPath: "model_1699325939_E83A88DAC5.safetensors",
    trainingTaskId: "a0c4cc90-0000-4000-a1d8-e00000000000",
    scale: 0.8,
    triggerWords: ["chloe_vlogger"],
    character: "a young history vlogger",
    now: 1_700_000_000_000,
  });
  assert.equal(trained.version, CHARACTER_LORA_VERSION);
  assert.equal(trained.source, "trained");
  assert.deepEqual(characterLoraDefects(trained), []);
  assert.deepEqual(parseCharacterLora(trained), trained);

  /* a trained ref MUST record the run that produced it */
  assert.ok(
    characterLoraDefects({ ...trained, trainingTaskId: undefined }).some((d) => d.includes("training task id")),
  );

  /* scale is bounded by Novita's documented range */
  assert.ok(characterLoraDefects({ ...trained, scale: 9 }).some((d) => d.includes("outside Novita's documented")));
  assert.ok(characterLoraDefects({ ...trained, scale: Number.NaN }).some((d) => d.includes("non-finite")));

  /* path validation: a bad path fails HERE, not at render time */
  assert.deepEqual(loraPathDefects("model_1699325939_E83A88DAC5.safetensors"), []);
  assert.deepEqual(loraPathDefects("https://cdn.example.com/chloe.safetensors"), []);
  assert.ok(loraPathDefects("http://cdn.example.com/chloe.safetensors").some((d) => d.includes("https")));
  assert.ok(loraPathDefects("https://cdn.example.com/chloe.ckpt").some((d) => d.includes(".safetensors")));
  assert.ok(loraPathDefects("some path with spaces").some((d) => d.includes("whitespace")));
  assert.ok(loraPathDefects("").length > 0);

  /* a malformed ref degrades to "no character" rather than throwing */
  for (const bad of [null, {}, { ...trained, version: "character-lora/v0" }, { ...trained, scale: 99 }]) {
    assert.equal(parseCharacterLora(bad), undefined);
    assert.deepEqual(characterLoraRefs({ lora: bad, surface: "z_image_turbo_lora" }), []);
  }
  assert.throws(() => assertCharacterLoraRef({}), /character lora integrity/);

  /* IMPORT path: size ceiling on an unvetted hosted file */
  const imported = makeImportedCharacterLora({
    novitaLoraPath: "https://cdn.example.com/chloe.safetensors",
    sizeBytes: 64 * 1024 * 1024,
    now: 1,
  });
  assert.equal(imported.source, "imported");
  assert.deepEqual(characterLoraDefects(imported), []);
  assert.throws(
    () => makeImportedCharacterLora({ novitaLoraPath: "https://cdn.example.com/chloe.safetensors" }),
    /verified size in bytes/,
    "a hosted file must be imported with its size or the ceiling is unenforceable",
  );
  assert.throws(
    () =>
      makeImportedCharacterLora({
        novitaLoraPath: "https://cdn.example.com/chloe.safetensors",
        sizeBytes: CHARACTER_LORA_MAX_IMPORT_BYTES + 1,
      }),
    /exceeds the .* ceiling/,
  );
  // A hub path carries no size, and needs none.
  assert.doesNotThrow(() => importCharacterLora({ novitaLoraPath: "novita/chloe-v1.safetensors" }));
}

function consumptionContract(): void {
  const lora = makeTrainedCharacterLora({
    novitaLoraPath: "model_x.safetensors",
    trainingTaskId: "task-1",
    scale: 0.75,
    triggerWords: ["chloe_vlogger", "period accurate"],
    now: 1,
  });

  /* 4 — a well-formed loras array for a surface that accepts one */
  const refs = characterLoraRefs({ lora, surface: "z_image_turbo_lora" });
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], { path: "model_x.safetensors", scale: 0.75 });
  assert.ok(refs.length <= CHARACTER_LORA_MAX_REFS, "Novita documents a hard maximum of 3 LoRAs");
  for (const ref of refs) {
    assert.equal(typeof ref.path, "string");
    assert.ok(ref.path.length > 0);
    assert.ok(ref.scale >= 0 && ref.scale <= 4, "scale must land inside Novita's documented range");
  }
  // Serializes to exactly the documented wire shape and nothing else.
  assert.deepEqual(Object.keys(refs[0]).sort(), ["path", "scale"]);

  /* the clamp means a stored value can never produce a rejected request */
  const hot = characterLoraRefs({ lora: { ...lora, scale: 4 }, surface: "z_image_turbo_lora" });
  assert.equal(hot[0].scale, 4);

  /* ...and REFUSES for a surface that cannot consume one */
  assert.throws(
    () => characterLoraRefs({ lora, surface: "novita_bridge_i2v" }),
    CharacterLoraUnsupportedSurfaceError,
    "silently dropping the LoRA would ship a video with the wrong face and no explanation",
  );
  assert.throws(() => characterLoraRefs({ lora, surface: "not_a_surface" }), /unknown target surface/);
  // ...but only when there IS a character. No character = no error, empty array.
  assert.deepEqual(characterLoraRefs({ lora: undefined, surface: "novita_bridge_i2v" }), []);

  assert.equal(canApplyCharacterLora(lora, "z_image_turbo_lora"), true);
  assert.equal(canApplyCharacterLora(lora, "novita_bridge_i2v"), false);
  assert.equal(canApplyCharacterLora(undefined, "z_image_turbo_lora"), false);

  /* trigger words must reach the prompt, idempotently */
  const prompted = applyCharacterTriggerWords("standing in a Roman forum, golden hour", lora);
  assert.ok(prompted.startsWith("chloe_vlogger, period accurate,"));
  assert.equal(applyCharacterTriggerWords(prompted, lora), prompted, "re-applying must not duplicate triggers");
  assert.equal(applyCharacterTriggerWords("a plain prompt", {}), "a plain prompt");

  /* 6 — the capability table is honest about its evidence */
  assert.equal(LORA_SURFACES.z_image_turbo_lora.supportsLoras, true);
  assert.equal(LORA_SURFACES.z_image_turbo_lora.parameter, "loras");
  assert.equal(LORA_SURFACES.z_image_turbo_lora.verified, "docs", "not exercised against a live key from this repo");
  assert.equal(LORA_SURFACES.novita_bridge_i2v.supportsLoras, false);
  assert.equal(LORA_SURFACES.novita_bridge_i2v.verified, "unsupported");
  assert.match(LORA_SURFACES.novita_bridge_i2v.note, /no LoRA field/i);
  // The unsupported entry must actually match the code it describes: the bridge
  // video job payload really has no lora field. If someone adds one, this fires
  // and the capability table has to be updated with it.
  const farm = codeOnly("src/lib/novitaRenderFarm.ts");
  const videoJobs = /export function videoJobs\(cfg: NovitaRenderCfg\)[\s\S]*?\n}/.exec(farm);
  assert.ok(videoJobs, "precondition: novitaRenderFarm.videoJobs must be findable");
  assert.ok(
    !/\blora/i.test(videoJobs[0]),
    "the bridge video job now has a lora field — LORA_SURFACES.novita_bridge_i2v is stale and must be updated",
  );

  assert.equal(NOVITA_LORA_API_EVIDENCE.applyToVideo.evidence, "unsupported");
  assert.equal(NOVITA_LORA_API_EVIDENCE.trainedModelOnZImageLora.evidence, "unconfirmed");
  for (const key of ["bootstrapImages", "submitTraining", "trainingResult", "applyToImages"] as const) {
    assert.equal(
      NOVITA_LORA_API_EVIDENCE[key].evidence,
      "docs",
      `${key} must be marked docs-only until a live call confirms it`,
    );
  }
}

async function trainingLifecycle(): Promise<void> {
  /* the bootstrap plan is deterministic and genuinely varied */
  const plan = planBootstrapImages({ characterDescription: "a young history vlogger with red hair", count: 8 });
  assert.equal(plan.length, 8);
  assert.deepEqual(plan, planBootstrapImages({ characterDescription: "a young history vlogger with red hair", count: 8 }));
  assert.equal(
    new Set(plan.map((brief) => brief.variation)).size,
    8,
    "a subject LoRA learns identity from VARIETY — eight copies of one pose teaches one pose",
  );
  for (const brief of plan) {
    assert.ok(brief.prompt.includes("red hair"), "every bootstrap prompt must describe the same character");
    assert.ok(brief.prompt.includes("no watermark"), "training inputs must be clean");
  }
  // Bounds are enforced, not suggested.
  assert.equal(planBootstrapImages({ characterDescription: "a young history vlogger", count: 1 }).length, BOOTSTRAP_MIN_IMAGES);
  assert.equal(planBootstrapImages({ characterDescription: "a young history vlogger", count: 500 }).length, 20);
  assert.throws(() => planBootstrapImages({ characterDescription: "hi", count: 8 }), /character description/);

  /* SUCCESS alone is not usable — the model must also be SERVING */
  assert.equal(
    servingModelName({ taskId: "t", taskStatus: "SUCCESS", models: [{ modelName: "m.safetensors", modelStatus: "DEPLOYING" }] }),
    undefined,
    "a DEPLOYING model would fail the first render on an unresolvable path",
  );
  assert.equal(
    servingModelName({ taskId: "t", taskStatus: "SUCCESS", models: [{ modelName: "m.safetensors", modelStatus: "SERVING" }] }),
    "m.safetensors",
  );
  assert.equal(
    servingModelName({ taskId: "t", taskStatus: "TRAINING", models: [{ modelName: "m.safetensors", modelStatus: "SERVING" }] }),
    undefined,
  );
  assert.deepEqual([...TRAINING_TERMINAL_STATUSES].sort(), ["CANCELED", "FAILED", "SUCCESS"]);

  /* spend admission covers the COMPLETE lifecycle before the first call */
  const envelope = characterLoraCostEnvelope({
    bootstrapImages: 8,
    perImageUsd: 0.01,
    trainingRunUsd: 2,
    label: "test",
  });
  assert.equal(envelope.bootstrapMaxCostUsd, 0.08);
  assert.equal(envelope.totalMaxCostUsd, 2.08);
  assert.throws(
    () => characterLoraCostEnvelope({ bootstrapImages: 8, perImageUsd: 0.01, trainingRunUsd: 2, maxCostUsd: 1, label: "test" }),
    /requires a \$2\.0800 envelope/,
    "a partial sequence must never start and strand a half-paid training run",
  );
  assert.throws(
    () => characterLoraCostEnvelope({ bootstrapImages: 2, perImageUsd: 0.01, trainingRunUsd: 2, label: "test" }),
    /at least 6 images/,
  );

  /* the client refuses an unconfigured key and never falls back to unauthenticated */
  assert.throws(() => new NovitaCharacterLoraClient({ apiKey: "short" }), NovitaCharacterLoraError);

  /* submit → poll, against a mocked transport (no live credential required) */
  {
    const calls: string[] = [];
    const client = new NovitaCharacterLoraClient({
      apiKey: "a-test-key-long-enough-to-pass",
      sleepImpl: async () => {},
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        assert.match(
          String((init?.headers as Record<string, string>)?.authorization ?? ""),
          /^Bearer /,
          "every request must carry the bearer credential",
        );
        const body =
          url.includes("/v3/training/subject") && init?.method === "POST"
            ? { task_id: "train-1" }
            : url.includes("/v3/training/subject")
              ? {
                  task_status: calls.filter((c) => c.includes("?task_id=")).length > 1 ? "SUCCESS" : "TRAINING",
                  models: [{ model_name: "model_out.safetensors", model_status: "SERVING" }],
                  extra: { progress_percent: 50 },
                }
              : { task_id: "img-1" };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch,
    });
    const taskId = await client.submitSubjectTraining({
      name: "chloe",
      baseModel: "base",
      instancePrompt: "chloe_vlogger",
      images: Array.from({ length: 6 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, caption: "chloe_vlogger" })),
    });
    assert.equal(taskId, "train-1");
    const modelName = await client.waitForServingModel(taskId, { intervalMs: 0 });
    assert.equal(modelName, "model_out.safetensors");
    // The dataset floor is enforced before the request is even made.
    await assert.rejects(
      client.submitSubjectTraining({ name: "c", baseModel: "b", instancePrompt: "p", images: [] }),
      /at least 6 images/,
    );
  }
}

function storage(): void {
  /* 5 — identity, stored with the rest of the channel's identity */
  const schema = readFileSync(join(ROOT, "convex/schema.ts"), "utf8");
  assert.ok(
    schema.includes('v.literal("character-lora/v1")'),
    "the character reference must be persisted on channels.identity, not in a parallel table",
  );
  const channels = readFileSync(join(ROOT, "convex/channels.ts"), "utf8");
  assert.ok(
    channels.includes('v.literal("character-lora/v1")'),
    "identityValidator must accept the reference or every write silently discards it",
  );
  // It must be OPTIONAL — existing channels have no character and must be
  // completely unaffected.
  assert.match(schema, /characterLora: v\.optional\(/);
  assert.match(channels, /characterLora: v\.optional\(/);
}

async function main(): Promise<void> {
  separationOfConcerns();
  referenceShape();
  consumptionContract();
  await trainingLifecycle();
  storage();
  console.log(
    "characterLoraWiring: generation-free serving module, validated reference shape, well-formed loras array, unsupported-surface refusal, spend admission and identity storage locks passed",
  );
}

void main();
