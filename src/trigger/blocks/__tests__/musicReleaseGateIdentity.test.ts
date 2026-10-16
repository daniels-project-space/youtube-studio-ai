import assert from "node:assert/strict";
import Module from "node:module";
import { createChannelMusicProgram, createMusicProgramQualityReceipt } from "@/engine/channelMusicProgram";
import { createMusicProviderAuditionSource } from "@/engine/musicAuditionCheckpoint";
import type { StageContext } from "@/engine/types";
import { sha256BytesHex } from "@/lib/sha256";
import { musicReuseTestReceipt, musicReuseTestStyleDNA } from "./musicReuseFixtures";

const ctx: StageContext = {
  ownerId: "owner-release-gate",
  channelId: "channel-release-gate",
  runId: "run-release-gate",
  keyPrefix: "owner/owner-release-gate/",
  params: {},
  store: {},
  budgetUsd: 0,
  log: () => {},
};
const program = createChannelMusicProgram({
  channelId: String(ctx.channelId),
  channelIdentityFingerprint: "a".repeat(64),
  family: "narrated_stock",
  contentLaneKey: "narrated_stock",
  topic: "Quiet evening",
  providerPreference: "minimax_music3",
});
const objects = new Map([
  ["program.json", Buffer.from(JSON.stringify(program))],
  ["runtime.json", Buffer.from("{}")],
  ["quality.json", Buffer.from("{}")],
]);
const objectReads: string[] = [];
let minimaxReceiptAdmitted = false;

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "@/lib/storage") {
    return {
      getObjectBytes: async (key: string) => {
        objectReads.push(key);
        const bytes = objects.get(key);
        if (!bytes) throw new Error(`unexpected object read: ${key}`);
        return bytes;
      },
    };
  }
  if (id === "@/lib/minimaxMusic3") {
    return {
      assertPinnedMiniMaxMusic3Receipt: () => {
        if (!minimaxReceiptAdmitted) throw new Error("runtime receipt validation must not run for a foreign program");
        return { license: { uiAttribution: "MiniMax-Music3" }, requestKey: "0123456789abcdef" };
      },
    };
  }
  return originalLoad.call(this, id, ...args);
};

async function main() {
  const { appendMusicGenerationDisclosure, assertMusicQualityForPublish } = await import("../musicReleaseGate");
  const foreignProgramContext: StageContext = {
    ...ctx,
    store: {
      musicProvider: "minimax_music3",
      musicKey: "master.mp3",
      musicQualityReviewStatus: "awaiting-human-audition",
      channelMusicProgramKey: "program.json",
      channelMusicProgramFingerprint: "b".repeat(64),
      musicRuntimeReceiptKey: "runtime.json",
      musicQualityReceiptKey: "quality.json",
    },
  };
  await assert.rejects(
    assertMusicQualityForPublish(foreignProgramContext),
    /does not match this run's sealed fingerprint/u,
  );
  assert.deepEqual(objectReads, ["program.json", "runtime.json", "quality.json"],
    "a foreign MiniMax program must fail before any native audio bytes are read");

  const disclosureContext: StageContext = { ...ctx, store: {
    musicProvider: "minimax_music3", channelMusicProgramKey: "program.json", musicRuntimeReceiptKey: "runtime.json",
  } };
  const baseDescription = "A factual video description.";
  await assert.rejects(appendMusicGenerationDisclosure(disclosureContext, baseDescription),
    /runtime receipt validation must not run/u,
    "provider attribution must stop when the durable runtime receipt is not admitted");
  minimaxReceiptAdmitted = true;
  const disclosed = await appendMusicGenerationDisclosure(disclosureContext, baseDescription);
  assert.equal(disclosed,
    `${baseDescription}\n\nMusic generated with MiniMax-Music3. This video contains AI-generated audio.`,
    "the shared music gate adds the required disclosure only after runtime-receipt admission");
  assert.equal(await appendMusicGenerationDisclosure(disclosureContext, disclosed), disclosed,
    "reapplying shared provider attribution must not duplicate the disclosure");
  assert.equal(await appendMusicGenerationDisclosure({ ...ctx, store: { musicProvider: "suno" } }, baseDescription), baseDescription,
    "other music providers must not inherit MiniMax-specific disclosure");

  const reusedAudio = Buffer.alloc(1_024, 9);
  objects.set("reused.mp3", reusedAudio);
  const baseProgram = createChannelMusicProgram({
    channelId: "base-channel", channelIdentityFingerprint: "c".repeat(64),
    family: "narrated_stock", contentLaneKey: "narrated_stock", topic: "Quiet evening", providerPreference: "mureka",
  });
  const baseMusicKey = "owner/owner-release-gate/runs/base-run/audio/music.mp3";
  const auditionWav = Buffer.alloc(44, 1);
  const auditionSha = sha256BytesHex(auditionWav);
  const auditionWavKey = `owner/owner-release-gate/runs/base-run/audio/music-audition-${auditionSha}.wav`;
  const source = createMusicProviderAuditionSource({
    ownerId: String(ctx.ownerId), channelId: "base-channel", runId: "base-run", provider: "mureka",
    program: baseProgram, sourceMusicKey: baseMusicKey, sourceBytes: reusedAudio, durationSec: 10,
    auditionWavKey, auditionWavBytes: auditionWav,
  });
  const quality = createMusicProgramQualityReceipt({
    program: baseProgram,
    output: { contentSha256: auditionSha, byteLength: auditionWav.byteLength, durationSec: 10,
      sampleRate: 32_000, channels: 2, codec: "pcm_s16le" },
    measurements: { integratedLufs: baseProgram.mix.targetLufs,
      truePeakDbtp: baseProgram.mix.truePeakMaxDbtp - 1, lraLu: 20, crestDb: 20,
      clippedSamples: 0, maximumConsecutiveCeilingSamples: 0, dcOffsetAbsolute: 0,
      silenceFraction: 0, mechanicalArtifactScore: 0, openingHighBandDropDb: 0 },
    sectionReviews: baseProgram.generation.sections.map((section) => ({ sectionId: section.id, score: 1, evidence: "test" })),
    audition: { reviewerId: "test-owner", reviewReceiptFingerprint: "d".repeat(64), emotionalDepthScore: 1,
      arrangementDepthScore: 1, hollowOrGeneric: false, verdict: "pass", notes: "fixture" },
  });
  const evidenceBytes = {
    program: Buffer.from(JSON.stringify(baseProgram)),
    source: Buffer.from(JSON.stringify(source)),
    quality: Buffer.from(JSON.stringify(quality)),
    auditionWav,
  };
  const evidenceKeys = {
    program: "owner/owner-release-gate/group/fixture/bundle/base-run/music-evidence/program.json",
    source: "owner/owner-release-gate/group/fixture/bundle/base-run/music-evidence/source.json",
    quality: "owner/owner-release-gate/group/fixture/bundle/base-run/music-evidence/quality.json",
    auditionWav: "owner/owner-release-gate/group/fixture/bundle/base-run/music-evidence/audition.wav",
  };
  for (const name of Object.keys(evidenceBytes) as Array<keyof typeof evidenceBytes>) {
    objects.set(evidenceKeys[name], evidenceBytes[name]);
  }
  const reuseReceipt = {
    ...musicReuseTestReceipt({ ownerId: String(ctx.ownerId), baseRunId: "base-run", baseChannelId: "base-channel",
      siblingChannelId: String(ctx.channelId), family: "narrated_stock", contentLaneKey: "narrated_stock",
      provider: "mureka", musicKey: "reused.mp3" }),
    audioSha256: sha256BytesHex(reusedAudio),
    audioByteLength: reusedAudio.byteLength,
    baseMusicKey,
    providerEvidence: Object.fromEntries((Object.keys(evidenceBytes) as Array<keyof typeof evidenceBytes>).map((name) => [name, {
      key: evidenceKeys[name], sha256: sha256BytesHex(evidenceBytes[name]),
    }])),
  };
  objectReads.length = 0;
  await assertMusicQualityForPublish({ ...ctx, store: {
    musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
    reuseMusicReceipt: reuseReceipt,
    styleDNA: musicReuseTestStyleDNA,
  } });
  assert.deepEqual(objectReads, ["reused.mp3", ...Object.values(evidenceKeys)],
    "reuse release re-reads and hashes the exact audio and complete source-review evidence chain");
  for (const receipt of [undefined, { ...reuseReceipt, siblingChannelId: "foreign-sibling" },
    { ...reuseReceipt, audioSha256: "b".repeat(64) },
    { ...reuseReceipt, soundProfileFingerprint: "c".repeat(64) }]) {
    objectReads.length = 0;
    await assert.rejects(assertMusicQualityForPublish({ ...ctx, store: {
      musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
      reuseMusicReceipt: receipt,
      styleDNA: musicReuseTestStyleDNA,
    } }), /music reuse receipt/u);
    assert.deepEqual(objectReads, ["reused.mp3"], "invalid or mismatched reuse proof cannot pass release");
  }
  const retainedSourceEvidence = objects.get(evidenceKeys.source)!;
  objects.set(evidenceKeys.source, Buffer.from("{}"));
  await assert.rejects(assertMusicQualityForPublish({ ...ctx, store: {
    musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
    reuseMusicReceipt: reuseReceipt, styleDNA: musicReuseTestStyleDNA,
  } }), /reused source evidence bytes/u, "source-review receipt replacement bytes cannot authorize reuse");
  objects.set(evidenceKeys.source, retainedSourceEvidence);
  objects.set("reused.mp3", Buffer.alloc(reusedAudio.byteLength, 8));
  await assert.rejects(assertMusicQualityForPublish({ ...ctx, store: {
    musicProvider: "reuse", musicKey: "reused.mp3", musicQualityReviewStatus: "not-required-reused-master",
    reuseMusicReceipt: reuseReceipt,
    styleDNA: musicReuseTestStyleDNA,
  } }), /exact audio bytes/u, "same-length replacement bytes cannot pass a previously valid receipt");

  for (const provider of ["mureka", "suno"] as const) {
    objectReads.length = 0;
    await assert.rejects(
      assertMusicQualityForPublish({
        ...ctx,
        store: {
          musicProvider: provider,
          musicKey: "master.mp3",
          musicQualityReviewStatus: "not-required-provider-route",
        },
      }),
      /review state is missing or invalid/u,
      `${provider} cannot claim that owner review is unnecessary`,
    );
    assert.deepEqual(objectReads, [], `${provider} invalid review state must stop before storage reads`);

    const requiredEvidenceKeys = [
      "program.json", "source.json", "quality.json", "master.mp3", "audition.wav",
    ];
    await assert.rejects(
      assertMusicQualityForPublish({
        ...ctx,
        store: {
          musicProvider: provider,
          musicKey: "master.mp3",
          musicQualityReviewStatus: "awaiting-human-audition",
          channelMusicProgramKey: "program.json",
          channelMusicProgramFingerprint: program.fingerprint,
          musicAuditionSourceKey: "source.json",
          musicQualityReceiptKey: "quality.json",
          musicAuditionWavKey: "audition.wav",
        },
      }),
      /unexpected object read/u,
      `${provider} with an awaiting status must still require its durable review objects`,
    );
    assert.deepEqual(objectReads, requiredEvidenceKeys,
      `${provider} release must load program, source, quality receipt, master, and audition bytes`);
  }
  console.log("MUSIC RELEASE GATE PASS: byte-bound reuse plus foreign MiniMax identity and missing provider audition evidence fail closed");
}

void main().finally(() => {
  loader._load = originalLoad;
});
