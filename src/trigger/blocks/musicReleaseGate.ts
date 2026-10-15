import { ChannelMusicProgramSchema, assertMusicProgramQualityReceipt } from "@/engine/channelMusicProgram";
import {
  assertMusicAuditionNativeBytes,
  musicRunAudioPrefix,
  MusicProviderAuditionSourceSchema,
} from "@/engine/musicAuditionCheckpoint";
import type { StageContext } from "@/engine/types";
import { assertPinnedMiniMaxMusic3Receipt } from "@/lib/minimaxMusic3";
import { getObjectBytes } from "@/lib/storage";
import { sha256BytesHex } from "@/lib/sha256";
import { assertMusicReuseReceipt } from "@/lib/musicReuseReceipt";
import { channelProgramRouteFromContext, str } from "./blockContext";
import { isMusicReviewStatusCompatible } from "./providerAwareMusic";

/**
 * A worker qualification proves the installed graph is eligible to render; it
 * does not prove this song is free of the documented MiniMax/Comfy decode
 * degradation or has musical depth. The review workflow supplies this durable
 * receipt after actual section-by-section audition — never fabricated here.
 */
export async function assertMusicQualityForPublish(ctx: StageContext): Promise<void> {
  const provider = ctx.store["musicProvider"];
  if (provider === undefined && ctx.store["musicKey"] === undefined) return;
  const reviewStatus = ctx.store["musicQualityReviewStatus"];
  if (!isMusicReviewStatusCompatible(provider, reviewStatus)) {
    throw new Error("upload_draft: music provider review state is missing or invalid — refusing to upload");
  }
  if (provider === "reuse") {
    const musicKey = str(ctx, "musicKey");
    const route = channelProgramRouteFromContext(ctx);
    assertMusicReuseReceipt({
      receipt: ctx.store["reuseMusicReceipt"],
      ownerId: ctx.ownerId,
      siblingChannelId: String(ctx.channelId),
      musicKey,
      currentFamily: route?.family,
      currentContentLaneKey: route?.contentLaneKey,
      currentStyleDNA: ctx.store["styleDNA"],
      audioBytes: await getObjectBytes(musicKey),
    });
    ctx.log("upload_draft: admitted byte-bound render-group music reuse receipt");
    return;
  }
  if (provider === "mureka" || provider === "suno") {
    const programKey = str(ctx, "channelMusicProgramKey");
    const sourceKey = str(ctx, "musicAuditionSourceKey");
    const auditionWavKey = str(ctx, "musicAuditionWavKey");
    const qualityReceiptKey = str(ctx, "musicQualityReceiptKey");
    const musicKey = str(ctx, "musicKey");
    const [programBytes, sourceBytes, qualityBytes, musicBytes, auditionWavBytes] = await Promise.all([
      getObjectBytes(programKey), getObjectBytes(sourceKey), getObjectBytes(qualityReceiptKey),
      getObjectBytes(musicKey), getObjectBytes(auditionWavKey),
    ]);
    let program: unknown;
    let sourceValue: unknown;
    let qualityValue: unknown;
    try {
      program = JSON.parse(Buffer.from(programBytes).toString("utf8"));
      sourceValue = JSON.parse(Buffer.from(sourceBytes).toString("utf8"));
      qualityValue = JSON.parse(Buffer.from(qualityBytes).toString("utf8"));
    } catch (error) {
      throw new Error(`upload_draft: provider music review evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const admittedProgram = ChannelMusicProgramSchema.parse(program);
    const source = MusicProviderAuditionSourceSchema.parse(sourceValue);
    const quality = assertMusicProgramQualityReceipt({ program: admittedProgram, receipt: qualityValue });
    if (source.ownerId !== ctx.ownerId || source.channelId !== String(ctx.channelId) || source.runId !== ctx.runId ||
        source.provider !== provider || source.programFingerprint !== admittedProgram.fingerprint ||
        source.sourceMusicKey !== musicKey || source.auditionWavKey !== auditionWavKey ||
        admittedProgram.fingerprint !== str(ctx, "channelMusicProgramFingerprint") ||
        sha256BytesHex(musicBytes) !== source.sourceOutput.contentSha256 ||
        musicBytes.byteLength !== source.sourceOutput.byteLength) {
      throw new Error("upload_draft: provider music review is not bound to the exact mastered source bytes");
    }
    assertMusicAuditionNativeBytes({ expected: source.auditionOutput, bytes: auditionWavBytes });
    if (
      quality.output.contentSha256 !== source.auditionOutput.contentSha256 ||
      quality.output.byteLength !== source.auditionOutput.byteLength ||
      Math.abs(quality.output.durationSec - source.auditionOutput.durationSec) > Math.max(0.1, source.auditionOutput.durationSec * 0.001) ||
      quality.output.sampleRate !== source.auditionOutput.sampleRateHz ||
      quality.output.channels !== source.auditionOutput.channels ||
      quality.output.codec !== source.auditionOutput.codec ||
      qualityReceiptKey !== `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}music-quality-${quality.fingerprint}.json`
    ) {
      throw new Error("upload_draft: provider music quality receipt does not match the auditioned master");
    }
    ctx.log(`upload_draft: admitted byte-bound ${provider} owner audition receipt ${quality.fingerprint.slice(0, 12)}`);
    return;
  }
  if (provider !== "minimax_music3") throw new Error("upload_draft: unsupported music provider; refusing release");
  const programKey = str(ctx, "channelMusicProgramKey");
  const runtimeReceiptKey = str(ctx, "musicRuntimeReceiptKey");
  const qualityReceiptKey = str(ctx, "musicQualityReceiptKey");
  const [programBytes, runtimeBytes, qualityBytes] = await Promise.all([
    getObjectBytes(programKey),
    getObjectBytes(runtimeReceiptKey),
    getObjectBytes(qualityReceiptKey),
  ]);
  let program: unknown;
  let runtimeReceipt: unknown;
  let qualityReceipt: unknown;
  try {
    program = JSON.parse(Buffer.from(programBytes).toString("utf8"));
    runtimeReceipt = JSON.parse(Buffer.from(runtimeBytes).toString("utf8"));
    qualityReceipt = JSON.parse(Buffer.from(qualityBytes).toString("utf8"));
  } catch (error) {
    throw new Error(
      `MiniMax-Music3 per-track quality evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const admittedProgram = ChannelMusicProgramSchema.parse(program);
  if (admittedProgram.fingerprint !== str(ctx, "channelMusicProgramFingerprint")) {
    throw new Error("MiniMax-Music3 channel music program does not match this run's sealed fingerprint");
  }
  const runtime = assertPinnedMiniMaxMusic3Receipt(runtimeReceipt, admittedProgram);
  const quality = assertMusicProgramQualityReceipt({ program: admittedProgram, receipt: qualityReceipt });
  if (
    quality.output.contentSha256 !== runtime.output.contentSha256 ||
    quality.output.byteLength !== runtime.output.byteLength ||
    Math.abs(quality.output.durationSec - runtime.durationSec) > Math.max(0.1, runtime.durationSec * 0.001) ||
    quality.output.sampleRate !== runtime.output.sampleRateHz ||
    quality.output.channels !== runtime.output.channels ||
    quality.output.codec !== runtime.output.codec
  ) {
    throw new Error("MiniMax-Music3 quality receipt is not bound to the exact native worker WAV");
  }
  const nativeWavKey = str(ctx, "musicNativeWavKey");
  const expectedNativeWavKey =
    `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}minimax-music3-native-${runtime.output.contentSha256}.wav`;
  if (nativeWavKey !== expectedNativeWavKey) {
    throw new Error("MiniMax-Music3 native WAV key is not bound to this run and immutable worker output");
  }
  assertMusicAuditionNativeBytes({
    expected: runtime.output,
    bytes: await getObjectBytes(nativeWavKey),
  });
  ctx.log(
    `upload_draft: admitted human-auditioned and byte-verified per-track music receipt ${quality.fingerprint.slice(0, 12)} ` +
    `for MiniMax request ${runtime.requestKey.slice(0, 12)}`,
  );
}
