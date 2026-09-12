import assert from "node:assert/strict";
import { artifactContract } from "@/engine/artifactSchemas";
import { manifestFromBlock, type ModuleManifest } from "@/engine/moduleManifest";
import {
  assertRestoredStageOutputs, assertStageReuseReceipt, sealStageReuseReceipt,
  stageInvocationHash, stageReuseHash, type StageReuseInvocation,
} from "@/engine/stageReuse";
import { StageReuseReceiptSchema } from "@/engine/stageReuseContract";
import type { ArtifactRef } from "@/engine/types";

// Real receipt/manifest code, controlled plain data; no filesystem/provider IO.
const root = "owners/reuse-test/channels/channel-one/runs/run-one/";
const outputs = {
  videoKey: root + "video.mp4", videoLocalPath: "/worker-a/video.mp4",
  narrationKey: root + "voice.wav", narrationLocalPath: "/worker-a/voice.wav",
  musicKey: root + "music.wav", musicUrl: "/worker-a/music.wav",
  introCardKey: root + "intro.mov", introCardPath: "/worker-a/intro.mov",
  footageKeys: [root + "one.mp4", root + "two.mp4"],
  footageClips: ["/worker-a/one.mp4", "/worker-a/two.mp4"],
  insertOverlays: [{ path: "/worker-a/stat.mov", key: root + "stat.mov", start: 1, end: 3, text: "Actual evidence" }],
  narrationText: "Calm, 24/7. Preserve sun/rain as literal text.",
  captions: [{ text: "Original caption", start: 0, end: 2 }],
};

function makeManifest(): ModuleManifest {
  return manifestFromBlock({
    id: "stage_reuse_contract_test",
    consumes: ["topic", "narrationLocalPath", "footageClips", "insertOverlays"],
    produces: Object.keys(outputs),
    run: async () => ({ ...outputs }),
  }, {
    version: "1.2.0", capabilities: ["test.reuse_contract"],
    optionalConsumes: ["script", "captions"],
    providerProfiles: [{ id: "local-fixture", provider: "local", quality: "production", allowFallback: false }],
    certification: "contract",
  });
}

function ref(key: string, value: unknown, producerModule = "upstream_test"): ArtifactRef {
  const contract = artifactContract(key);
  return {
    artifactId: "artifact:" + producerModule + ":" + key, key,
    type: contract.type, schemaVersion: contract.version,
    producerModule, producerVersion: "1.0.0", payloadHash: stageReuseHash(value),
  };
}

function invocation(): StageReuseInvocation {
  const store = {
    topic: "A source-bound episode",
    narrationLocalPath: outputs.narrationLocalPath, narrationKey: outputs.narrationKey,
    footageClips: [...outputs.footageClips], footageKeys: [...outputs.footageKeys],
    insertOverlays: structuredClone(outputs.insertOverlays),
    script: { hook: "Grounded opening", details: { words: 32, language: "en" } },
  };
  return {
    ownerId: "owner-one", runId: "run-one", channelId: "channel-one", keyPrefix: root,
    manifest: makeManifest(), params: { fps: 30, options: { palette: "walnut", zoom: 1 } }, store,
    inputRefs: Object.fromEntries(Object.entries(store).map(([key, value]) => [key, ref(key, value)])),
  };
}

const input = invocation();
const invocationHash = stageInvocationHash(input);
const refs = Object.entries(outputs).map(([key, value]) => ref(key, value, input.manifest.id));
const receipt = sealStageReuseReceipt(invocationHash, outputs, refs);
let passed = 0;
const failures: string[] = [];
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log("PASS " + name); }
  catch (error) {
    failures.push(name);
    console.error("FAIL " + name + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

test("seal validates after JSON persistence and reordered reference input", () => {
  assert.deepEqual(assertStageReuseReceipt(JSON.parse(JSON.stringify(receipt)), invocationHash, JSON.parse(JSON.stringify(outputs))), receipt);
  assert.deepEqual(sealStageReuseReceipt(invocationHash, outputs, [...refs].reverse()), receipt);
  assert.equal(StageReuseReceiptSchema.safeParse(receipt).success, true);
  assert.doesNotThrow(() => assertRestoredStageOutputs(receipt, outputs));
});

test("object order is irrelevant to invocation and output identity", () => {
  const next = invocation();
  next.params = { options: { zoom: 1, palette: "walnut" }, fps: 30 };
  next.store = Object.fromEntries(Object.entries(next.store).reverse());
  next.inputRefs = Object.fromEntries(Object.entries(next.inputRefs).reverse());
  next.manifest = { ...next.manifest, consumes: Object.fromEntries(Object.entries(next.manifest.consumes).reverse()) };
  assert.equal(stageInvocationHash(next), invocationHash);
  assert.deepEqual(assertStageReuseReceipt(receipt, invocationHash, Object.fromEntries(Object.entries(outputs).reverse())), receipt);
});

test("JSON omission of undefined and sparse arrays is stable", () => {
  const next = invocation();
  next.store = { ...next.store, captions: undefined };
  assert.equal(stageInvocationHash(next), invocationHash);
  assert.equal(stageReuseHash({ absent: undefined, kept: 1 }), stageReuseHash({ kept: 1 }));
  assert.equal(stageReuseHash([undefined, 1]), stageReuseHash([null, 1]));
  assert.equal(stageReuseHash(new Array(2)), stageReuseHash([null, null]));
});

test("portable receipt survives top-level undefined fields omitted by persistence", () => {
  const original = { ...outputs, optionalOutput: undefined };
  const sealed = sealStageReuseReceipt(invocationHash, original, refs);
  const persisted = JSON.parse(JSON.stringify(original));
  assert.doesNotThrow(() => assertStageReuseReceipt(sealed, invocationHash, persisted));
  assert.doesNotThrow(() => assertRestoredStageOutputs(sealed, persisted));
});

const changes: Array<[string, (next: StageReuseInvocation) => void]> = [
  ["required text", (n) => { n.store = { ...n.store, topic: "Different episode" }; }],
  ["required input absent", (n) => { const s = { ...n.store }; delete s.topic; n.store = s; }],
  ["optional value", (n) => { n.store = { ...n.store, script: { hook: "Altered" } }; }],
  ["optional absent", (n) => { const s = { ...n.store }; delete s.script; n.store = s; }],
  ["optional appears", (n) => { n.store = { ...n.store, captions: outputs.captions }; }],
  ["optional null", (n) => { n.store = { ...n.store, captions: null }; }],
  ["input overlay text", (n) => { n.store = { ...n.store, insertOverlays: [{ ...outputs.insertOverlays[0], text: "Changed evidence" }] }; }],
  ["input overlay timing", (n) => { n.store = { ...n.store, insertOverlays: [{ ...outputs.insertOverlays[0], start: 2 }] }; }],
  ["input clip key order", (n) => { n.store = { ...n.store, footageKeys: [...outputs.footageKeys].reverse() }; }],
  ["input clip key", (n) => { n.store = { ...n.store, footageKeys: [root + "changed.mp4", outputs.footageKeys[1]] }; }],
  ["params", (n) => { n.params = { ...n.params, fps: 24 }; }],
  ["nested params", (n) => { n.params = { ...n.params, options: { palette: "midnight", zoom: 1 } }; }],
  ["module id", (n) => { n.manifest = { ...n.manifest, id: "different_module" }; }],
  ["module version", (n) => { n.manifest = { ...n.manifest, version: "1.2.1" }; }],
  ["owner", (n) => { n.ownerId = "owner-two"; }],
  ["run", (n) => { n.runId = "run-two"; }],
  ["channel", (n) => { n.channelId = "channel-two"; }],
  ["storage prefix", (n) => { n.keyPrefix = "owners/unrelated/"; }],
  ["provider profile", (n) => { n.manifest = { ...n.manifest, providerProfiles: [{ id: "other", provider: "other", quality: "production", allowFallback: false }] }; }],
];
for (const field of ["artifactId", "producerModule", "producerVersion", "schemaVersion", "type", "payloadHash"] as const) {
  changes.push(["input reference " + field, (n) => {
    n.inputRefs = { ...n.inputRefs, topic: { ...n.inputRefs.topic!, [field]: field === "payloadHash" ? "f".repeat(64) : "changed" } };
  }]);
}
for (const [bucket, key] of [["consumes", "topic"], ["optionalConsumes", "captions"], ["produces", "videoKey"]] as const) {
  for (const field of ["type", "version"] as const) changes.push([bucket + " contract " + field, (n) => {
    n.manifest = { ...n.manifest, [bucket]: { ...n.manifest[bucket], [key]: { ...n.manifest[bucket][key]!, [field]: "changed" } } };
  }]);
}
for (const [name, change] of changes) test("changed " + name + " rejects prior invocation", () => {
  const next = invocation();
  change(next);
  const hash = stageInvocationHash(next);
  assert.notEqual(hash, invocationHash);
  assert.throws(() => assertStageReuseReceipt(receipt, hash, outputs), /inputs, configuration or module contract changed/);
});

test("unread unrelated values and refs do not invalidate declared inputs", () => {
  const next = invocation();
  next.store = { ...next.store, unrelated: { text: "Changed", path: "/different/unconsumed" } };
  next.inputRefs = { ...next.inputRefs, unrelated: ref("unrelated", "unused") };
  assert.equal(stageInvocationHash(next), invocationHash);
});

test("new optional output contract invalidates the old invocation", () => {
  const next = invocation();
  next.manifest = { ...next.manifest, optionalProduces: { chapterPlan: artifactContract("chapterPlan") } };
  assert.notEqual(stageInvocationHash(next), invocationHash);
});

function projectedInvocation(hints: unknown, enabled = true): StageReuseInvocation {
  const next = invocation();
  next.manifest = manifestFromBlock(next.manifest.block, {
    version: next.manifest.version, capabilities: ["test.reuse_contract"],
    optionalConsumes: ["script", "captions", "healHints"],
    ...(enabled ? { resumeInputProjections: { healHints: "own_block_entry" as const } } : {}),
  });
  next.store = { ...next.store, healHints: hints };
  next.inputRefs = { ...next.inputRefs, healHints: ref("healHints", hints) };
  return next;
}

test("explicit own-block projection ignores only another block's repair hint/ref", () => {
  const id = input.manifest.id;
  const before = projectedInvocation({ [id]: "Keep own repair", other_block: "Old external repair" });
  const after = projectedInvocation({ other_block: "New external repair", [id]: "Keep own repair" });
  assert.equal(stageInvocationHash(before), stageInvocationHash(after));
  assert.notEqual(before.inputRefs.healHints!.payloadHash, after.inputRefs.healHints!.payloadHash);
});

test("own-block hint changes, appears or disappears invalidate the invocation", () => {
  const id = input.manifest.id;
  const original = stageInvocationHash(projectedInvocation({ [id]: "Original repair", other_block: "Keep" }));
  for (const hints of [{ [id]: "Changed repair", other_block: "Keep" }, { other_block: "Keep" }, { [id]: null }]) {
    assert.notEqual(stageInvocationHash(projectedInvocation(hints)), original);
  }
  assert.equal(
    stageInvocationHash(projectedInvocation({ other_block: "Repair" })),
    stageInvocationHash(projectedInvocation(undefined)),
    "An unrelated hint does not turn an absent own-block hint into a present one",
  );
});

test("projection is opt-in; ordinary maps retain every declared entry", () => {
  const id = input.manifest.id;
  assert.notEqual(
    stageInvocationHash(projectedInvocation({ [id]: "Keep", other_block: "Before" }, false)),
    stageInvocationHash(projectedInvocation({ [id]: "Keep", other_block: "After" }, false)),
  );
  assert.notEqual(
    stageInvocationHash(projectedInvocation({ [id]: "Keep" }, true)),
    stageInvocationHash(projectedInvocation({ [id]: "Keep" }, false)),
    "Projection contract itself is part of identity",
  );
});

test("legacy whole-string and array repair hints are not reduced to map entries", () => {
  assert.notEqual(stageInvocationHash(projectedInvocation("Old hint")), stageInvocationHash(projectedInvocation("New hint")));
  assert.notEqual(stageInvocationHash(projectedInvocation(["first", "second"])), stageInvocationHash(projectedInvocation(["second", "first"])));
});

test("invocation permits recognized media relocation with unchanged R2 identity", () => {
  const next = invocation();
  next.store = {
    ...next.store, narrationLocalPath: "/worker-b/restored.wav",
    footageClips: ["/worker-b/one.mp4", "/worker-b/two.mp4"],
    insertOverlays: outputs.insertOverlays.map((o) => ({ ...o, path: "/worker-b/stat.mov" })),
  };
  assert.equal(stageInvocationHash(next), invocationHash);
});

test("restoration sibling R2 key participates even if not separately consumed", () => {
  const next = invocation();
  assert.equal("narrationKey" in next.manifest.consumes, false);
  next.store = { ...next.store, narrationKey: root + "different.wav" };
  assert.notEqual(stageInvocationHash(next), invocationHash);
});

test("raw output check rejects relocation; portable check admits only restoration", () => {
  const restored = { ...outputs, videoLocalPath: "/worker-b/video.mp4" };
  assert.throws(() => assertStageReuseReceipt(receipt, invocationHash, restored), /outputs changed/);
  assert.doesNotThrow(() => assertRestoredStageOutputs(receipt, restored));
});

test("top-level paths, clip arrays and nested overlay items relocate together", () => {
  assert.doesNotThrow(() => assertRestoredStageOutputs(receipt, {
    ...outputs, videoLocalPath: "/worker-b/video.mp4", narrationLocalPath: "/worker-b/voice.wav",
    musicUrl: "/worker-b/music.wav", introCardPath: "/worker-b/intro.mov",
    footageClips: ["/worker-b/one.mp4", "/worker-b/two.mp4"],
    insertOverlays: outputs.insertOverlays.map((o) => ({ ...o, path: "/worker-b/stat.mov" })),
  }));
});

for (const [name, patch] of [
  ["video key", { videoKey: root + "other.mp4" }],
  ["voice key", { narrationKey: root + "other.wav" }],
  ["narration text", { narrationText: "Different script" }],
  ["caption text", { captions: [{ text: "Altered", start: 0, end: 2 }] }],
  ["caption timing", { captions: [{ text: "Original caption", start: 1, end: 2 }] }],
  ["clip key order", { footageKeys: [...outputs.footageKeys].reverse() }],
  ["clip key", { footageKeys: [root + "other.mp4", outputs.footageKeys[1]] }],
  ["missing clip", { footageClips: outputs.footageClips.slice(0, 1) }],
  ["overlay key", { insertOverlays: [{ ...outputs.insertOverlays[0], key: root + "other.mov" }] }],
  ["overlay text", { insertOverlays: [{ ...outputs.insertOverlays[0], text: "Invented" }] }],
  ["overlay timing", { insertOverlays: [{ ...outputs.insertOverlays[0], end: 4 }] }],
  ["overlay removal", { insertOverlays: [] }],
] as const) test("restoration rejects changed " + name, () => {
  const changed = { ...outputs, ...patch };
  assert.throws(() => assertStageReuseReceipt(receipt, invocationHash, changed), /outputs changed/);
  assert.throws(() => assertRestoredStageOutputs(receipt, changed), /changed content/);
});

test("tampered receipt hashes, refs, schema and duplicate output keys reject", () => {
  for (const key of ["fingerprint", "invocationHash", "persistedOutputsHash", "portableOutputsHash"] as const) {
    assert.throws(() => assertStageReuseReceipt({ ...receipt, [key]: "0".repeat(64) }, invocationHash, outputs));
  }
  assert.throws(() => assertStageReuseReceipt({ ...receipt, outputRefs: [{ ...receipt.outputRefs[0], payloadHash: "0".repeat(64) }, ...receipt.outputRefs.slice(1)] }, invocationHash, outputs));
  assert.throws(() => assertStageReuseReceipt({ ...receipt, version: "stage-reuse/v0" }, invocationHash, outputs));
  assert.throws(() => assertStageReuseReceipt({ ...receipt, approved: true }, invocationHash, outputs));
  assert.throws(() => assertStageReuseReceipt(sealStageReuseReceipt(invocationHash, outputs, [...refs, refs[0]!]), invocationHash, outputs), /repeats|duplicate/i);
});

test("unbound paths are never normalized away", () => {
  for (const original of [
    { videoLocalPath: "/worker-a/unbound.mp4" },
    { nested: { path: "/worker-a/unbound.json" } },
    { inputs: ["/worker-a/unbound.wav"] },
    { narrationText: "/worker-a/literal-text" },
  ]) {
    const changed = JSON.parse(JSON.stringify(original).replaceAll("worker-a", "worker-b"));
    const sealed = sealStageReuseReceipt(invocationHash, original, []);
    assert.throws(() => assertRestoredStageOutputs(sealed, changed), /changed content/);
  }
});

test("URLs and slash prose are content, not media placeholders", () => {
  for (const value of ["https://example.invalid/voice.wav", "24/7", "sun/rain", "rain / night", "relative/file.wav"]) {
    const original = { narrationLocalPath: value, narrationKey: root + "voice.wav" };
    const sealed = sealStageReuseReceipt(invocationHash, original, []);
    assert.throws(() => assertRestoredStageOutputs(sealed, { ...original, narrationLocalPath: value + "-changed" }));
  }
});

test("invalid local or HTTP sibling keys cannot authorize relocation", () => {
  for (const key of ["", "/local/not-r2.wav", "C:\\local\\not-r2.wav", "https://example.invalid/not-r2.wav"]) {
    const original = { narrationLocalPath: "/worker-a/voice.wav", narrationKey: key };
    const sealed = sealStageReuseReceipt(invocationHash, original, []);
    assert.throws(() => assertRestoredStageOutputs(sealed, { ...original, narrationLocalPath: "/worker-b/voice.wav" }));
  }
});

test("array order and path-like caption content remain meaningful", () => {
  assert.notEqual(stageReuseHash(["first", "second"]), stageReuseHash(["second", "first"]));
  const original = { caption: { text: "/literal-caption", key: "caption-one" }, filePathInProse: "/literal/text" };
  const sealed = sealStageReuseReceipt(invocationHash, original, []);
  assert.throws(() => assertRestoredStageOutputs(sealed, { ...original, caption: { ...original.caption, text: "/changed-caption" } }));
  assert.throws(() => assertRestoredStageOutputs(sealed, { ...original, filePathInProse: "/changed/text" }));
});

test("portable normalization cannot alias media STRING with marker OBJECT", () => {
  assert.throws(() => assertRestoredStageOutputs(receipt, {
    ...outputs, videoLocalPath: { durableMediaKey: outputs.videoKey },
  }), /changed content/);
});

test("invocation distinguishes media strings from marker-shaped objects", () => {
  const next = invocation();
  next.store = { ...next.store, narrationLocalPath: { durableMediaKey: outputs.narrationKey } };
  assert.notEqual(stageInvocationHash(next), invocationHash);
});

test("unrecognized nested configuration path/key is not a media restoration shape", () => {
  const original = { configuration: { path: "/config/one", key: "semantic-rule" } };
  const sealed = sealStageReuseReceipt(invocationHash, original, []);
  assert.throws(() => assertRestoredStageOutputs(sealed, {
    configuration: { path: "/config/two", key: "semantic-rule" },
  }), /changed content/);
});

for (const [name, value] of [
  ["NaN", Number.NaN], ["infinity", Number.POSITIVE_INFINITY],
  ["Date", new Date("2026-01-01T00:00:00Z")], ["Map", new Map([["a", 1]])],
  ["function", () => 1], ["bigint", BigInt(1)],
] as const) test("hash rejects non-persistable " + name, () => assert.throws(() => stageReuseHash({ nested: value })));

console.log("Stage reuse receipts: " + passed + " passed; " + failures.length + " failed. No provider or file-byte QA claims.");
if (failures.length) {
  console.error("Counterexamples: " + failures.join("; "));
  process.exitCode = 1;
}
