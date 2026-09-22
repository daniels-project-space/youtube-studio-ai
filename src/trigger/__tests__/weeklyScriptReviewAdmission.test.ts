import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { planWeekPreparationKey, planWeekPreparedScriptKey, type PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";

const manifest: PlanWeekPreparationManifest = {
  version: "plan-week-preparation/inputs-v1", ownerId: "review-owner", channelId: "review-channel",
  channelSlug: "archive", batchId: "batch", itemId: "episode", itemKey: "week:0", requestKey: "week", frozenAt: 1,
  plan: { topic: "The old lock", title: "The old lock", description: "A source-bound history.",
    sceneSeed: "An archive", thumbnailKey: "owner/review-owner/old.jpg", thumbnailSource: "planner_artwork" },
  execution: { pipeline: [{ block: "script_gen" }, { block: "qa_script" }, { block: "narration_tts" }],
    moduleConfig: {}, seedStore: { persona: "Curious history listeners" } },
  prompts: { script: "Source", narration: "Voice", shotlist: "Shots", visual: "Archive" },
};
const encode = (value: unknown) => Buffer.from(canonicalJson(value));
const script = { hook: "An old lock.", sections: [{ heading: "Archive", narration: "A missing pin.", role: "outro" }],
  narrationText: "An old lock. A missing pin.", estDurationSec: 12 };
const scriptKey = planWeekPreparedScriptKey(manifest), manifestKey = planWeekPreparationKey(manifest);
const reviewKey = `${scriptKey}.review.json`;
const objects = new Map<string, Uint8Array>();
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
let calls = 0, tts = 0, dispatches = 0;
let verdict: unknown = { pass: false, issues: ["Opening promise is never fulfilled."] };
let writeMode = "normal";
let charge: Record<string, unknown> = { cost: 0.003, is_byok: false };
const missing = () => Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
function reset(current = manifest) {
  // Independent fixture attempts only. Production never clears dispatch claims.
  objects.clear(); calls = 0; tts = 0; dispatches = 0; writeMode = "normal";
  charge = { cost: 0.003, is_byok: false };
  process.env.OPENROUTER_API_KEY = "synthetic-only";
  const bytes = encode(current), manifestSha256 = sha256BytesHex(bytes);
  objects.set(manifestKey, bytes);
  objects.set(scriptKey, encode({ ...current, version: "plan-week-prepared-script/v1", topic: current.plan.topic,
    manifestSha256, script, scriptSha256: sha256Hex(canonicalJson(script)), createdAt: 2 }));
  return { ownerId: current.ownerId, channelId: current.channelId, channelSlug: current.channelSlug,
    batchId: current.batchId, itemId: current.itemId, manifestKey, manifestSha256,
    maxCostUsd: 2, provider: "fish", speaker: "fixture-voice" };
}
async function main() {
  loader._load = function(id, ...args) {
    if (id === "@trigger.dev/sdk") return { task: (value: unknown) => value,
      tasks: { trigger: async () => { dispatches++; return { id: "fixture" }; } },
      idempotencyKeys: { create: async () => "fixture-key" } };
    if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
    if (id === "@/lib/storage") return {
      getObjectBytes: async (key: string) => { const value = objects.get(key); if (!value) throw missing(); return value; },
      putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch?: string }) => {
        assert.equal(options.ifNoneMatch, "*");
        if (objects.has(key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
        if (key === reviewKey && writeMode === "denied") throw Object.assign(new Error("write denied"), { $metadata: { httpStatusCode: 403 } });
        objects.set(key, bytes);
        if (key === reviewKey && writeMode === "lost") throw Object.assign(new Error("lost acknowledgement"), { $metadata: { httpStatusCode: 503 } });
        return key;
      },
    };
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/tts") return { ...actual as object, synthNarration: async () => {
      tts++; throw new Error("TTS boundary reached; no paid take in fixture");
    } };
    return actual;
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions"); calls++;
    const body = JSON.parse(String(init?.body));
    assert.ok(objects.has(`${reviewKey}.dispatch.json`), "claim must precede actual transport");
    assert.ok(body.messages.at(-1).content.includes(script.narrationText));
    assert.ok(body.messages.at(-1).content.includes("Curious history listeners"));
    return Response.json({ id: "review-fixture", model: body.model,
      choices: [{ message: { content: JSON.stringify(verdict) } }],
      usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230, ...charge } });
  };
  try {
    const require = createRequire(import.meta.url);
    const task = require(process.env.PREPARED_NARRATION_TASK_PATH ?? "../planWeekPreparedNarration").planWeekPreparedNarrationTask;
    let payload = reset();
    await assert.rejects(() => task.run(payload), /Opening promise/);
    assert.equal(tts, 0); assert.equal(calls, 1); assert.equal(dispatches, 0);
    const rejected = JSON.parse(Buffer.from(objects.get(reviewKey)!).toString());
    assert.equal(rejected.status, "held"); assert.equal(rejected.costUsd, 0.003);
    await assert.rejects(() => task.run(payload), /held/);
    assert.equal(calls, 1, "rejected review cannot be bought again");

    for (const reply of [{ pass: true, issues: [] }, { pass: "true", issues: [] }]) {
      payload = reset(); verdict = reply;
      await assert.rejects(() => task.run(payload), reply.pass === true ? /TTS boundary/ : /critic unavailable/);
      assert.equal(calls, 1); assert.equal(tts, reply.pass === true ? 1 : 0);
      delete process.env.OPENROUTER_API_KEY;
      await assert.rejects(() => task.run(payload), reply.pass === true ? /RECONCILIATION_REQUIRED/ : /held/);
      assert.equal(calls, 1); assert.equal(tts, reply.pass === true ? 1 : 0);
    }
    verdict = { pass: true, issues: [] };
    for (const invalidCharge of [{ cost: 0.003 }, { cost: 3, is_byok: false }]) {
      payload = reset(); charge = invalidCharge;
      await assert.rejects(() => task.run(payload), /usage is unpriced, incomplete, or exceeds/);
      assert.equal(calls, 1); assert.equal(tts, 0);
      await assert.rejects(() => task.run(payload), /held/);
      assert.equal(calls, 1);
    }
    payload = reset();
    await assert.rejects(() => task.run({ ...payload, maxCostUsd: 0.001 }), /priced allowance/);
    assert.equal(calls, 0); assert.equal(tts, 0); assert.equal(objects.size, 2);

    payload = reset(); writeMode = "lost";
    await assert.rejects(() => task.run(payload), /TTS boundary/);
    assert.equal(calls, 1); assert.equal(tts, 1, "lost receipt acknowledgement reconciles without another review");
    await assert.rejects(() => task.run({ ...payload, maxCostUsd: 0.002 }), /charge exceeds remaining allowance/);
    assert.equal(calls, 1); assert.equal(tts, 1, "recovery cannot erase the earlier review charge from admission");
    const swapped = JSON.parse(Buffer.from(objects.get(scriptKey)!).toString());
    swapped.script.narrationText = "Substituted narration with a different promise.";
    swapped.scriptSha256 = sha256Hex(canonicalJson(swapped.script));
    objects.set(scriptKey, encode(swapped));
    await assert.rejects(() => task.run(payload), /binding mismatch/);
    assert.equal(calls, 1); assert.equal(tts, 1);

    payload = reset(); writeMode = "denied";
    await assert.rejects(() => task.run(payload), /write denied/);
    writeMode = "normal";
    await assert.rejects(() => task.run(payload), /RECONCILIATION_REQUIRED/);
    assert.equal(calls, 1); assert.equal(tts, 0);

    payload = reset({ ...manifest, execution: { ...manifest.execution,
      pipeline: [{ block: "script_gen" }, { block: "narration_tts" }] } });
    await assert.rejects(() => task.run(payload), /one frozen qa_script/);
    assert.equal(calls, 0); assert.equal(tts, 0);

    payload = reset();
    await Promise.allSettled([task.run(payload), task.run(payload)]);
    assert.equal(calls, 1); assert.equal(tts, 1, "concurrent delivery admits exactly one review and take");
    console.log("WEEKLY SCRIPT REVIEW PASS: actual narration task, critic and HTTP parser; rejected/malformed scripts stop before TTS; budget, durable reuse, corruption, lost writes and concurrency covered; provider transport synthetic");
  } finally {
    loader._load = originalLoad; globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
