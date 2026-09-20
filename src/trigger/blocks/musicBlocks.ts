/**
 * Shared music generation and prepared-track reuse for every channel family.
 * Provider admission, receipt verification, mastering and spend stay together.
 */
import { FALLBACK_UNDERSCORE_BRIEFS, spreadDefault } from "@/lib/identitySpread";
import { boundedInteger } from "@/engine/boundedNumber";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { getMusicBrief } from "@/engine/creative/brief";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { PRICE } from "@/engine/pricing";
import {
  assertMusicProgramQualityReceipt,
  createChannelMusicProgram,
  ChannelMusicProgramSchema,
  ChannelMusicProviderSchema,
  type ChannelMusicProgram,
} from "@/engine/channelMusicProgram";
import type { PlanWeekPreparedMusic } from "@/lib/planWeekPreparation";
import { assertMusicAuditionNativeBytes } from "@/engine/musicAuditionCheckpoint";
import {
  generateMureka,
  generateSuno,
  MusicError,
  selfLoopAudio,
  withMusicGenerationCost,
  type MusicProvider,
  type MusicTrack,
} from "@/lib/music";
import {
  assertPinnedMiniMaxMusic3Receipt,
  generateMiniMaxMusic3,
  type MiniMaxMusic3Receipt,
} from "@/lib/minimaxMusic3";
import {
  hasKnownMiniMaxMusic3OpeningDegradation,
  measureNativeMusicQuality,
  type NativeMusicQualityAnalysis,
} from "@/lib/nativeMusicQuality";
import { probe, crossfadeConcatAudio, masterAudioTransparentGain } from "@/lib/ffmpeg";
import { makeRunTempDir, downloadTo, readBytes, writeBytes } from "@/lib/files";
import { putObject, getObjectBytes, publicUrl } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { join } from "node:path";
import {
  str,
  recordAsset,
  channelProgramRouteFromContext,
  musicProgramForCurrentRoute,
} from "./blockContext";

// Accepted Mureka/Suno jobs do not expose a durable replay receipt yet. Keep
// their output transfer bounded so a stalled provider body reaches this block's
// existing cost-carrying terminal catch instead of the whole-task timeout.
const MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS = 300_000;

export const music: Block = {
  id: "music",
  consumes: ["topic"],
  produces: [
    "musicKey",
    "musicProvider",
    "musicUrl",
    "channelMusicProgramKey",
    "channelMusicProgramFingerprint",
    "musicRuntimeReceiptKey",
    "musicNativeWavKey",
    "musicQualityReviewStatus",
  ],
  paid: true,
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const preparedMusic = ctx.store["preparedMusic"] as PlanWeekPreparedMusic | undefined;
    // Bind before a reuse shortcut as well: otherwise a newly admitted music
    // route could attach a sibling's track without proving it belongs to this
    // episode program.
    const musicProgram = musicProgramForCurrentRoute(ctx, topic);
    const selection = ctx.params.provider === undefined ? undefined : ChannelMusicProviderSchema.safeParse(ctx.params.provider);
    if (selection && !selection.success) {
      throw new Error("music: unsupported explicit provider; refusing substitution with a default provider");
    }
    const requestedProvider = selection?.success ? selection.data : undefined;
    let preparedProgram: ChannelMusicProgram | undefined;
    if (preparedMusic !== undefined) {
      if (!preparedMusic || typeof preparedMusic !== "object" ||
        preparedMusic.ownerId !== ctx.ownerId || preparedMusic.channelId !== String(ctx.channelId) || preparedMusic.topic !== topic) {
        throw new Error("music: prepared weekly music does not match the current owner, channel and topic");
      }
      preparedProgram = ChannelMusicProgramSchema.parse(preparedMusic.musicProgram);
      if (preparedProgram.channelId !== String(ctx.channelId) || preparedProgram.topic !== topic) {
        throw new Error("music: prepared weekly sound program does not match the current channel and topic");
      }
    }
    if (
      musicProgram &&
      requestedProvider !== undefined &&
      requestedProvider !== musicProgram.audio.providerPreference
    ) {
      throw new Error(
        `music: requested provider ${requestedProvider} does not match sealed music program provider ${musicProgram.audio.providerPreference}`,
      );
    }
    const provider: MusicProvider = musicProgram?.audio.providerPreference ?? requestedProvider ?? "mureka";
    // RENDER-GROUP REUSE: a language sibling reuses the base render's music track
    // (identical audio bed; only narration differs) — no Mureka/Suno generation.
    const reuseMusicKey = ctx.store["reuseMusicKey"] as string | undefined;
    if (reuseMusicKey) {
      ctx.log(`music: REUSED base music track ${reuseMusicKey} (no generation)`);
      let reuseUrl = "";
      try { reuseUrl = publicUrl(reuseMusicKey); } catch { reuseUrl = `r2://${reuseMusicKey}`; }
      return {
        musicKey: reuseMusicKey,
        musicProvider: "reuse",
        musicUrl: reuseUrl,
        musicQualityReviewStatus: "not-required-reused-master",
        [COST_PATCH_KEY]: 0,
      };
    }
    // Phase 2 grounding: "Suno generated by the STYLE OF THE CHANNEL" — the frozen
    // Style DNA audio spec (genre/instrumentation/textures/BPM/loop) is the
    // channel's locked SOUND and WINS. Priority: DNA spec > Composer crew brief
    // (per-video nuance, only when there is no DNA) > explicit param > default.
    const composerPrompt = getMusicBrief(ctx.store)?.musicPrompt;
    const studioAudioRecipe = studioPostproductionRecipeProjectionFromUnknown(
      ctx.store["studioAudioRecipeProjection"],
      "audio_recipe",
    );
    const studioAudioDirection = studioAudioRecipe.promptAddenda.length
      ? ` Approved Studio audio direction (must preserve the locked channel sound, instrumental/no-vocal rule, and requested duration): ${studioAudioRecipe.promptAddenda.join(" ")}`
      : "";
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const a = dna?.audio;
    const dnaPrompt = a?.genre?.trim()
      ? [
          `${a.genre} instrumental, evoking "${topic}".`,
          a.instrumentation?.length ? `Instrumentation: ${a.instrumentation.join(", ")}.` : "",
          a.textures?.length ? `Texture: ${a.textures.join(", ")}.` : "",
          // Neither Mureka nor Suno exposes a structural/section parameter
          // (verified against both providers' actual request shapes in
          // src/lib/music.ts — `duration` is the only real metadata either
          // returns; BPM only ever appears as OUTBOUND prompt text). Prose is
          // the only lever these providers expose for mood movement across a
          // track, so carry the DNA's full mood-arc sentence (not just its
          // first clause) — an author who wrote "opens tense, resolves
          // warmer" wants that shift reaching the model, not truncated away.
          a.moodArc ? `Emotional arc across the track: ${a.moodArc.trim()}.` : "",
          `${a.bpmRange?.[0] ?? 70}-${a.bpmRange?.[1] ?? 88} BPM, ${a.loopable ? "loop-friendly, resolves back to the tonic" : "natural ending"}, purely instrumental, no vocals, no lyrics.`,
        ].filter(Boolean).join(" ")
      : "";
    // BLEND, not override: the DNA is the channel's locked sound (identity
    // floor); the Composer's per-video brief carries THIS video's emotional
    // arc. DNA-only made every video's score near-identical — the staleness
    // the composer crew existed to prevent.
    const arcNote = composerPrompt?.trim()
      ? ` This video's emotional direction: ${composerPrompt.trim()}`
      : "";
    // LAST RESORT, AND IT USED TO BE ONE GENRE.
    //
    // This chain ended in a lofi hip-hop brief — Rhodes piano, boom-bap drums,
    // vinyl crackle — from when this block served only the lofi family. It now
    // serves twelve channels, most of them not lofi, so a finance or philosophy
    // channel with no styleDNA audio and no composer brief was one missing
    // param away from being scored as lofi. Nothing caught it because a wrong
    // score renders and uploads perfectly.
    //
    // The lofi family still gets its own brief; everything else draws from a
    // range by stable channel identity, so two narrated channels that both
    // declare nothing no longer sound identical.
    const musicRoute = channelProgramRouteFromContext(ctx);
    const isLoopFamily = musicRoute?.family === "music_loop";
    const seed = String(ctx.store["channelName"] ?? ctx.channelId ?? "");
    const lastResort = isLoopFamily
      ? `warm cozy lofi hip-hop instrumental to study/relax to, evoking "${topic}". ` +
        `mellow Rhodes piano, soft boom-bap drums, gentle bass, vinyl crackle, tape warmth, ` +
        `calm and nostalgic, ~72 bpm, purely instrumental, no vocals, no lyrics, loop-friendly`
      : `${spreadDefault(seed, FALLBACK_UNDERSCORE_BRIEFS)}, evoking "${topic}", no vocals, no lyrics`;
    const basePrompt =
      (dnaPrompt && dnaPrompt.trim() ? `${dnaPrompt.trim()}${arcNote}` : "") ||
      (composerPrompt && composerPrompt.trim()) ||
      (typeof ctx.params.prompt === "string" ? ctx.params.prompt.trim() : "") ||
      lastResort;
    const prompt = [
      musicProgram?.audio.direction,
      basePrompt,
      studioAudioDirection,
    ].filter(Boolean).join(" ");
    ctx.log(`music: prompt source = ${dnaPrompt ? (arcNote ? "style DNA + composer arc" : "style DNA") : composerPrompt ? "composer brief" : "default"}${studioAudioDirection ? " + approved Studio audio direction" : ""}`);

    const route = channelProgramRouteFromContext(ctx);
    const channelIdentityFingerprint = sha256Hex(canonicalJson({
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      channelName: ctx.store["channelName"] ?? null,
      routeFingerprint: route?.routeFingerprint ?? null,
      styleDNA: dna,
      musicBrief: getMusicBrief(ctx.store) ?? null,
    }));
    const channelMusicProgram: ChannelMusicProgram = preparedProgram ?? createChannelMusicProgram({
      channelId: String(ctx.channelId),
      channelIdentityFingerprint,
      family: route?.family ?? "music_loop",
      contentLaneKey: route?.contentLaneKey ?? "music_loop",
      topic,
      providerPreference: provider,
      durationSec: Number(ctx.params.generationDurationSec ?? 300),
      genre: a?.genre,
      instrumentation: a?.instrumentation,
      textures: a?.textures,
      bpmRange: a?.bpmRange,
      moodArc: a?.moodArc,
      // DNA is already represented by the structured identity fields. Carry
      // its episode nuance, or the selected non-DNA prompt, without duplicating it.
      composerDirection: [
        musicProgram?.audio.direction,
        dnaPrompt ? (a?.loopable ? "Loop-friendly, resolves back to the tonic." : "Natural ending.") : "",
        dnaPrompt ? arcNote : basePrompt,
        studioAudioDirection,
      ].filter(Boolean).join(" ") || undefined,
      targetLufs: Number(a?.loudnessLufs ?? -16),
      bodyMusicVol: 1,
    });
    const channelMusicProgramKey =
      `${ctx.keyPrefix}runs/${ctx.runId}/audio/channel-music-program-${channelMusicProgram.fingerprint}.json`;
    await putObject(
      channelMusicProgramKey,
      Buffer.from(JSON.stringify(channelMusicProgram, null, 2)),
      { contentType: "application/json" },
    );
    await recordAsset(ctx, "channel_music_program", channelMusicProgramKey, {
      fingerprint: channelMusicProgram.fingerprint,
      providerPreference: channelMusicProgram.generation.providerPreference,
      role: channelMusicProgram.role,
      spendUsd: 0,
      productionMusicKey: null,
    });
    ctx.log(
      `music: sealed channel sound program ${channelMusicProgram.fingerprint.slice(0, 12)} ` +
      `(${channelMusicProgram.role}, ${channelMusicProgram.generation.sections.length} authored sections) before spend`,
    );
    // Week-ahead preparation is a distinct, receipt-backed reuse route. Do
    // not feed it through reuseMusicKey: that shortcut only proves a language
    // sibling named an object. This verifies the master and the exact sealed
    // program before any provider credential is consulted or generation can
    // begin. A stale program, altered byte, or absent MiniMax audit record is
    // terminal rather than permission to replace the planned track.
    if (preparedMusic !== undefined) {
      if (!preparedMusic || typeof preparedMusic !== "object") {
        throw new Error("music: prepared weekly music is invalid");
      }
      if (preparedMusic.musicProgram.fingerprint !== channelMusicProgram.fingerprint) {
        throw new Error("music: prepared weekly music does not match the frozen channel sound program");
      }
      const masterBytes = await getObjectBytes(preparedMusic.musicKey);
      if (
        masterBytes.byteLength !== preparedMusic.audioByteLength ||
        sha256BytesHex(masterBytes) !== preparedMusic.audioSha256
      ) {
        throw new Error("music: prepared weekly master bytes do not match their immutable receipt");
      }
      const preparedMasterPath = await writeBytes(
        join(await makeRunTempDir(ctx.runId), "prepared_weekly_music.mp3"),
        masterBytes,
      );
      const measuredDurationSec = (await probe(preparedMasterPath)).durationSec;
      if (
        !Number.isFinite(measuredDurationSec) ||
        measuredDurationSec <= 0 ||
        Math.abs(measuredDurationSec - preparedMusic.musicDurationSec) > 0.05
      ) {
        throw new Error("music: prepared weekly master duration does not match its immutable receipt");
      }

      let musicRuntimeReceiptKey: string | undefined;
      let musicNativeWavKey: string | undefined;
      if (preparedMusic.provider === "minimax_music3") {
        const minimax = preparedMusic.minimax;
        if (!minimax) {
          throw new Error("music: prepared MiniMax weekly music is missing its release evidence");
        }
        if (ctx.store["musicQualityReceiptKey"] !== minimax.qualityReceiptKey) {
          throw new Error("music: prepared MiniMax quality receipt is not bound to the scheduled invocation");
        }
        const [nativeWavBytes, runtimeReceiptBytes, qualityReceiptBytes] = await Promise.all([
          getObjectBytes(minimax.nativeWavKey),
          getObjectBytes(minimax.runtimeReceiptKey),
          getObjectBytes(minimax.qualityReceiptKey),
        ]);
        let runtimeReceipt: unknown;
        let qualityReceipt: unknown;
        try {
          runtimeReceipt = JSON.parse(Buffer.from(runtimeReceiptBytes).toString("utf8"));
          qualityReceipt = JSON.parse(Buffer.from(qualityReceiptBytes).toString("utf8"));
        } catch (error) {
          throw new Error(
            `music: prepared MiniMax evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const runtime = assertPinnedMiniMaxMusic3Receipt(runtimeReceipt, channelMusicProgram);
        const quality = assertMusicProgramQualityReceipt({ program: channelMusicProgram, receipt: qualityReceipt });
        if (
          quality.output.contentSha256 !== runtime.output.contentSha256 ||
          quality.output.byteLength !== runtime.output.byteLength ||
          Math.abs(quality.output.durationSec - runtime.durationSec) > Math.max(0.1, runtime.durationSec * 0.001) ||
          quality.output.sampleRate !== runtime.output.sampleRateHz ||
          quality.output.channels !== runtime.output.channels ||
          quality.output.codec !== runtime.output.codec
        ) {
          throw new Error("music: prepared MiniMax quality receipt is not bound to the exact native worker WAV");
        }
        assertMusicAuditionNativeBytes({ expected: runtime.output, bytes: nativeWavBytes });
        musicNativeWavKey =
          `${ctx.keyPrefix}runs/${ctx.runId}/audio/minimax-music3-native-${runtime.output.contentSha256}.wav`;
        await putObject(musicNativeWavKey, nativeWavBytes, { contentType: "audio/wav" });
        await recordAsset(ctx, "minimax_music3_native_wav", musicNativeWavKey, {
          source: "prepared-weekly-music",
          sourceKey: minimax.nativeWavKey,
          requestKey: runtime.requestKey,
          contentSha256: runtime.output.contentSha256,
          byteLength: runtime.output.byteLength,
          durationSec: runtime.durationSec,
          programFingerprint: channelMusicProgram.fingerprint,
          qualityReceiptKey: minimax.qualityReceiptKey,
          reviewBinding: "native-worker-wav",
        });
        musicRuntimeReceiptKey = minimax.runtimeReceiptKey;
      }
      let musicUrl: string;
      try {
        musicUrl = publicUrl(preparedMusic.musicKey);
      } catch {
        musicUrl = `r2://${preparedMusic.musicKey}`;
      }
      await recordAsset(ctx, "music", preparedMusic.musicKey, {
        provider: preparedMusic.provider,
        source: "prepared-weekly-music",
        byteLength: masterBytes.byteLength,
        durationSec: preparedMusic.musicDurationSec,
        channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
        channelMusicProgramKey,
        runtimeReceiptKey: musicRuntimeReceiptKey,
        trackHumanAuditionStatus: preparedMusic.provider === "minimax_music3"
          ? "passed-prepared-weekly-review"
          : "not-required-provider-route",
      });
      ctx.log(
        `music: consumed prepared weekly ${preparedMusic.provider} master ` +
        `(${preparedMusic.musicDurationSec.toFixed(1)}s; no music-generation spend)`,
      );
      return {
        musicKey: preparedMusic.musicKey,
        musicProvider: preparedMusic.provider,
        musicUrl,
        channelMusicProgramKey,
        channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
        musicRuntimeReceiptKey,
        musicNativeWavKey,
        musicQualityReviewStatus: preparedMusic.provider === "minimax_music3"
          ? "passed-prepared-weekly-audition"
          : "not-required-provider-route",
        [COST_PATCH_KEY]: 0,
      };
    }
    const providerPrompt = provider === "minimax_music3"
      ? channelMusicProgram.generation.structuredCaption
      : [
          prompt,
          `Arrangement map: ${channelMusicProgram.generation.sections.map((section) =>
            `${section.label} ${Math.round(section.startFraction * 100)}-${Math.round(section.endFraction * 100)}%: ${section.instruction}`,
          ).join(" ")}`,
        ].join(" ");

    // MULTI-TRACK MIX: a single looped 3-min track reads as stale on anything
    // longer than a few minutes. trackCount asks for N distinct clips that get
    // crossfade-concatenated (3s tri — the proven legacy-autostudio recipe)
    // into one continuous mix before looping. A Suno generation returns TWO
    // clips for one credit, so cost = ceil(N/2) generations. Default 2 = double
    // the unique audio at the old single-track price.
    // NaN here produced NaN, so the track loop ran zero times and the video
    // shipped with no music at all — the quietest possible failure.
    const trackCount = boundedInteger(ctx.params.trackCount, 2, 1, 8);
    const sunoModel = (ctx.params.model as string | undefined) ?? "V5";
    const mixTitle = (String(ctx.store["channelName"] ?? "") || topic).slice(0, 60);
    const tmp = await makeRunTempDir(ctx.runId);

    let tracks: MusicTrack[] = [];
    let jobIds: string[] = [];
    let generations = 0;
    let billedGenerations = 0;
    let billedAttestedCostUsd = 0;
    let usedProvider: MusicProvider = provider;
    let minimaxLocalPath: string | undefined;
    let minimaxReceipt: MiniMaxMusic3Receipt | undefined;
    let musicRuntimeReceiptKey: string | undefined;
    // The worker receipt is bound to the native WAV, not the subsequently
    // mastered/loop-folded MP3. Retain those exact verified bytes before any
    // transformation so an owner audition and its later quality receipt can
    // never silently approve the derivative in place of the worker output.
    let musicNativeWavKey: string | undefined;

    try {
    const generateWith = async (prov: MusicProvider): Promise<void> => {
      tracks = [];
      jobIds = [];
      generations = 0;
      if (prov === "minimax_music3") {
        ctx.log(
          "music: MiniMax-Music3 — two-GPU spot worker, pinned ComfyUI/model revisions, " +
          "prominent attribution/disclosure, durable WAV integrity, and listened-quality admission required…",
        );
        const configuredBudgetUsd = Number(ctx.params.maxCostUsd ?? 5);
        if (!Number.isFinite(configuredBudgetUsd) || configuredBudgetUsd <= 0) {
          throw new Error("music: MiniMax-Music3 requires a positive total generation budget");
        }
        const configuredSeed = Number(ctx.params.seed ?? 4_242);
        const baseSeed = Number.isSafeInteger(configuredSeed) && configuredSeed >= 0 ? configuredSeed : 4_242;
        let result: Awaited<ReturnType<typeof generateMiniMaxMusic3>> | undefined;
        let nativeTechnicalQuality: NativeMusicQualityAnalysis | undefined;
        // The upstream stock-graph defect can produce a healthy opening then
        // collapse spectrally around the first few seconds. Retry exactly once
        // with a deterministic different seed, only while the original stage
        // reservation still covers the observed first attempt. This is a
        // mechanical repair, not a substitute for the later human audition.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const remainingBudgetUsd = configuredBudgetUsd - billedAttestedCostUsd;
          if (remainingBudgetUsd <= 0) {
            throw new Error("music: MiniMax-Music3 known-defect retry would exceed the sealed stage budget");
          }
          const attemptSeed = attempt === 0
            ? baseSeed
            : (baseSeed + 104_729) % 2_147_483_647;
          const candidate = await generateMiniMaxMusic3({
            program: channelMusicProgram,
            seed: attemptSeed,
            // The worker accepts only the benchmarked full-precision profile.
            // Preserve an explicit override as an intentional, fail-closed
            // benchmark request instead of silently clamping it into a release.
            cfgScale: ctx.params.cfgScale === undefined ? undefined : Number(ctx.params.cfgScale),
            topK: ctx.params.topK === undefined ? undefined : Number(ctx.params.topK),
            maxCostUsd: Math.min(10, remainingBudgetUsd),
          });
          billedAttestedCostUsd += candidate.receipt.runtime.costUsd;
          const technicalQuality = await measureNativeMusicQuality({
            audio: candidate.audio,
            durationSec: candidate.receipt.durationSec,
          });
          if (!hasKnownMiniMaxMusic3OpeningDegradation(technicalQuality)) {
            result = candidate;
            nativeTechnicalQuality = technicalQuality;
            break;
          }
          const rejectedKey =
            `${ctx.keyPrefix}runs/${ctx.runId}/audio/rejected/minimax-music3-native-${candidate.receipt.output.contentSha256}.wav`;
          await putObject(rejectedKey, candidate.audio, { contentType: "audio/wav" });
          await recordAsset(ctx, "minimax_music3_rejected_native_wav", rejectedKey, {
            requestKey: candidate.receipt.requestKey,
            jobId: candidate.receipt.jobId,
            contentSha256: candidate.receipt.output.contentSha256,
            durationSec: candidate.receipt.durationSec,
            openingHighBandDropDb: technicalQuality.measurements.openingHighBandDropDb,
            mechanicalArtifactScore: technicalQuality.measurements.mechanicalArtifactScore,
            rejection: "known-music3-opening-degradation",
          });
          ctx.log(
            `music: rejected MiniMax-Music3 attempt ${attempt + 1}/2 for known opening degradation ` +
            `(high-band drop ${technicalQuality.measurements.openingHighBandDropDb} dB); retained evidence before bounded retry`,
          );
        }
        if (!result || !nativeTechnicalQuality) {
          throw new Error("music: MiniMax-Music3 exhausted its bounded retry after known opening degradation");
        }
        minimaxReceipt = result.receipt;
        minimaxLocalPath = await writeBytes(join(tmp, "minimax-music3.wav"), result.audio);
        musicNativeWavKey =
          `${ctx.keyPrefix}runs/${ctx.runId}/audio/minimax-music3-native-${result.receipt.output.contentSha256}.wav`;
        await putObject(musicNativeWavKey, result.audio, { contentType: "audio/wav" });
        await recordAsset(ctx, "minimax_music3_native_wav", musicNativeWavKey, {
          requestKey: result.receipt.requestKey,
          jobId: result.receipt.jobId,
          contentSha256: result.receipt.output.contentSha256,
          byteLength: result.receipt.output.byteLength,
          durationSec: result.receipt.durationSec,
          sampleRateHz: result.receipt.output.sampleRateHz,
          channels: result.receipt.output.channels,
          codec: result.receipt.output.codec,
          programFingerprint: channelMusicProgram.fingerprint,
          openingHighBandDropDb: nativeTechnicalQuality.measurements.openingHighBandDropDb,
          mechanicalArtifactScore: nativeTechnicalQuality.measurements.mechanicalArtifactScore,
          // This is a retained review artifact. It is deliberately distinct
          // from the mastered MP3, which has its own asset row below.
          reviewBinding: "native-worker-wav",
        });
        musicRuntimeReceiptKey =
          `${ctx.keyPrefix}runs/${ctx.runId}/audio/minimax-music3-runtime-${result.receipt.requestKey}.json`;
        await putObject(
          musicRuntimeReceiptKey,
          Buffer.from(JSON.stringify(result.receipt, null, 2)),
          { contentType: "application/json" },
        );
        await recordAsset(ctx, "minimax_music3_runtime_receipt", musicRuntimeReceiptKey, {
          requestKey: result.receipt.requestKey,
          jobId: result.receipt.jobId,
          programFingerprint: channelMusicProgram.fingerprint,
          modelRevision: result.receipt.modelRevision,
          runtimeRevision: result.receipt.runtimeRevision,
          observedCostUsd: result.receipt.runtime.costUsd,
          uiAttribution: result.receipt.license.uiAttribution,
          generatedContentDisclosureEnabled: result.receipt.license.generatedContentDisclosureEnabled,
          trackHumanAuditionStatus: "pending_private_draft_review",
        });
        generations = 1;
        usedProvider = "minimax_music3";
        jobIds = [result.receipt.jobId];
        tracks = [{
          url: result.receipt.output.url,
          wavUrl: result.receipt.output.url,
          durationSec: result.receipt.durationSec,
        }];
      } else if (prov === "suno") {
        const gens = Math.ceil(trackCount / 2);
        for (let g = 0; g < gens && tracks.length < trackCount; g++) {
          const varied =
            g === 0
              ? providerPrompt
              : `${providerPrompt} Part ${g + 1} of a continuous mix: same instrumentation, key family and mood, a different melodic progression.`;
          ctx.log(`music: suno ${sunoModel} generation ${g + 1}/${gens} (custom mode, WAV upgrade)…`);
          const res = await generateSuno({
            prompt: varied,
            model: sunoModel,
            title: mixTitle,
            // WAV upgrade only when EXPLICITLY requested (lofi sets it): a
            // narrated bed sits ducked -22dB under voice — inaudible benefit,
            // and a failed WAV poll burned up to 3 min/clip of pure waiting.
            wantClips: Math.min(2, trackCount - tracks.length),
            preferWav: ctx.params.preferWav === true,
            timeoutMs: 600_000,
          });
          generations++;
          billedGenerations++;
          jobIds.push(res.jobId);
          tracks.push(...res.tracks.slice(0, trackCount - tracks.length));
        }
      } else {
        ctx.log(`music: generating via ${prov}…`);
        const res = await generateMureka({
          prompt: providerPrompt,
          model: ctx.params.model as string | undefined,
          timeoutMs: 600_000,
        });
        generations = 1;
        billedGenerations++;
        usedProvider = res.provider;
        jobIds = [res.jobId];
        tracks = res.tracks;
      }
    };

    // PROVIDER FAILOVER: a quota/billing-dead provider must not kill the render
    // when the alternate provider's key is present — both produce instrumental
    // beds from the same DNA prompt. (Live case: Mureka 429 "exceeded your
    // current quota" after two renders; Suno had credits.)
    const altProvider: Exclude<MusicProvider, "minimax_music3"> = provider === "suno" ? "mureka" : "suno";
    const hasProviderKey = (p: Exclude<MusicProvider, "minimax_music3">) =>
      p === "suno" ? Boolean(process.env.SUNO_API_KEY) : Boolean(process.env.MUREKA_API_KEY);
    try {
      await generateWith(provider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const admissionRejected =
        e instanceof MusicError &&
        e.safeToFallback &&
        e.acceptedUnits === 0 &&
        billedGenerations === 0;
      if (provider !== "minimax_music3" && admissionRejected && hasProviderKey(altProvider)) {
        ctx.log(`music: ${provider} is quota/billing-dead (${msg.slice(0, 120)}) — FAILING OVER to ${altProvider}`);
        usedProvider = altProvider;
        await generateWith(altProvider);
      } else {
        throw e;
      }
    }
    if (!tracks.length) throw new Error("music: provider returned no tracks");
    const wavCount = tracks.filter((t) => t.wavUrl).length;
    ctx.log(`music: ${tracks.length} track(s) ready (${wavCount} lossless WAV) from ${generations} generation(s)`);

    // Download all clips, crossfade-concat into one mix, then MASTER to the
    // channel's LUFS target (DNA audio.loudnessLufs, default -14 = YouTube
    // reference) — the "Suno loudness mastering" step that previously existed
    // only as an unenforced DNA field.
    const locals: string[] = minimaxLocalPath ? [minimaxLocalPath] : [];
    if (!minimaxLocalPath) {
      for (let i = 0; i < tracks.length; i++) {
        const ext = tracks[i].wavUrl ? "wav" : "mp3";
        locals.push(await downloadTo(tracks[i].url, join(tmp, `track_${i}.${ext}`), {
          timeoutMs: MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
        }));
      }
    }
    const mixPath =
      locals.length > 1 ? await crossfadeConcatAudio(locals, join(tmp, "mix.mp3"), 3) : locals[0];
    const targetLufs = channelMusicProgram.mix.targetLufs;
    let local = await masterAudioTransparentGain(mixPath, join(tmp, "music.mp3"), {
      lufs: targetLufs,
      truePeakMaxDbtp: channelMusicProgram.mix.truePeakMaxDbtp,
    });
    ctx.log(`music: mastered mix → transparent constant gain I=${targetLufs} LUFS, no compressor/limiter, 320k`);
    // SELF-LOOPING FOLD: assemble stream_loops this mix for the whole render,
    // so an unproven bed would create an audible hard splice every loop. This
    // is a release gate, not optional polish: after a paid generation the
    // outer catch retains its observed spend and makes this failure terminal,
    // rather than buying the same music again on a task replay.
    const loopedMusicPath = join(tmp, "music_loop.mp3");
    const loopedMusic = await selfLoopAudio(local, loopedMusicPath, {
      log: (m) => ctx.log(`music: ${m}`),
    });
    // `selfLoopAudio` promises this exact path on success. Keep the check at
    // the release boundary as a future-proof guard against any reintroduced
    // pass-through fallback.
    if (loopedMusic !== loopedMusicPath) {
      throw new MusicError(
        "music: self-loop continuity proof did not produce the sealed loop artifact; refusing a hard-splice fallback",
      );
    }
    local = loopedMusic;

    const musicKey = `${ctx.keyPrefix}runs/${ctx.runId}/music.mp3`;
    await putObject(musicKey, await readBytes(local), { contentType: "audio/mpeg" });
    await recordAsset(ctx, "music", musicKey, {
      provider: usedProvider,
      jobId: jobIds.join(","),
      tracks: tracks.length,
      losslessTracks: wavCount,
      masteredLufs: targetLufs,
      channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
      channelMusicProgramKey,
      runtimeReceiptKey: musicRuntimeReceiptKey,
      generatedContentDisclosure: usedProvider === "minimax_music3",
      uiAttribution: minimaxReceipt?.license.uiAttribution,
      trackHumanAuditionStatus: "pending_private_draft_review",
    });

    // Downstream consumers (assemble/timeline_assemble) PREFER musicKey — the
    // mastered R2 mix. musicUrl is only the legacy fallback; R2_PUBLIC_BASE_URL
    // may be unset on Trigger, so fall back to the first provider clip URL.
    let musicUrl: string;
    try {
      musicUrl = publicUrl(musicKey);
    } catch {
      musicUrl = tracks[0].url;
    }
    return {
      musicKey,
      musicProvider: usedProvider,
      musicUrl,
      channelMusicProgramKey,
      channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
      musicRuntimeReceiptKey,
      musicNativeWavKey,
      // An operational worker qualification is not an audition of this track.
      // The owner/review flow adds musicQualityReceiptKey after section review;
      // upload_draft rejects a MiniMax release until that proof is present.
      musicQualityReviewStatus: usedProvider === "minimax_music3"
        ? "awaiting-human-audition"
        : "not-required-provider-route",
      // Keep spend from successful generations made before provider failover;
      // resetting the selected provider's tracks must not erase paid work.
      [COST_PATCH_KEY]: PRICE.musicTrackUsd * billedGenerations + billedAttestedCostUsd,
    };
    } catch (error) {
      // Preserve every confirmed accepted generation if a later generation,
      // download, mix, or R2 write fails. This also makes the failure terminal,
      // preventing the runner from buying the completed jobs again.
      if (billedAttestedCostUsd > 0 && error && typeof error === "object") {
        Object.assign(error, { observedCostUsd: billedAttestedCostUsd });
      }
      throw withMusicGenerationCost(error, billedGenerations, PRICE.musicTrackUsd);
    }
  },
};
