/**
 * `emit_bundle` — render-group reuse. On a GROUP BASE channel's run, after the base
 * video is uploaded, persist the reusable assets (footage clips + music + the
 * script/topic) to a DURABLE group-bundle path in R2 (the run prefix gets cleaned;
 * this path does not), then fan out a localized run to each language sibling that
 * reuses those assets. Sibling runs only redo narration/captions/text/metadata.
 *
 * No-op (bundleEmitted:false) for ungrouped channels and for siblings.
 */
import { createHash } from "node:crypto";

import type { Block, StageContext } from "@/engine/types";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { putObject, getObjectBytes } from "@/lib/storage";
import { readBytes } from "@/lib/files";
import { ExecutionError } from "@/engine/executionErrors";
import { bundleFanoutDispatchSchedule, bundleFanoutEnvelope } from "@/lib/bundleFanout";
import { createMusicReuseReceipt } from "@/lib/musicReuseReceipt";
import { groupMusicSoundProfileFingerprint, storedChannelMusicProvider } from "@/lib/groupMusicProfile";
import {
  ThirdPartyStockEvidenceReferenceSchema,
  assertThirdPartyStockEvidenceMatchesFootageKeys,
  assertThirdPartyStockEvidenceReferenceBinding,
  createThirdPartyStockEvidenceReference,
  parseThirdPartyStockEvidenceManifestBytes,
  thirdPartyStockEvidenceManifestSha256,
  type ThirdPartyStockEvidenceManifest,
  type ThirdPartyStockEvidenceReference,
} from "@/lib/thirdPartyStockEvidence";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

type BundleDispatchClaim =
  | { kind: "enqueued" }
  | { kind: "busy"; retryAt?: number }
  | { kind: "pending"; retryAt?: number }
  | { kind: "failed"; error?: string }
  | { kind: "claimed"; runId: string; envelope: unknown; leaseToken: string };

function dispatchFailure(error: unknown, context: string): ExecutionError {
  const message = error instanceof Error ? error.message : String(error);
  return new ExecutionError(`emit_bundle: ${context}: ${message.slice(0, 1_000)}`, {
    code: "BUNDLE_FANOUT_DISPATCH_FAILED",
    retryable: true,
    phase: "emit_bundle",
  });
}

export const emitBundle: Block = {
  id: "emit_bundle",
  consumes: [], // tolerant: reads what's present (narrated has footage+script; lofi differs)
  produces: ["bundleEmitted"],
  run: async (ctx: StageContext) => {
    const c = convex();
    const channel = await c
      .query(api.channels.getChannel, { channelId: ctx.channelId as Id<"channels"> })
      .catch(() => null);
    const groupId = channel?.groupId;
    if (!channel || !groupId || channel.groupRole !== "base") {
      return { bundleEmitted: false };
    }

    const group = await c.query(api.channels.listGroup, { groupId });
    const siblings = group.filter((g) => g.groupRole === "sibling" && g.status === "active");
    const sourceProfile = groupMusicSoundProfileFingerprint({
      family: channel.family,
      contentLaneKey: channel.contentLane?.key,
      provider: ctx.store["musicProvider"],
      styleDNA: channel.styleDNA,
    });
    const runProfile = groupMusicSoundProfileFingerprint({
      family: channel.family,
      contentLaneKey: channel.contentLane?.key,
      provider: ctx.store["musicProvider"],
      styleDNA: ctx.store["styleDNA"],
    });
    const reusableMusicProfileBySibling = new Map<string, string>();
    const musicProvider = ctx.store["musicProvider"];
    const providerEvidenceKeys = {
      program: ctx.store["channelMusicProgramKey"],
      source: ctx.store["musicAuditionSourceKey"],
      quality: ctx.store["musicQualityReceiptKey"],
      auditionWav: ctx.store["musicAuditionWavKey"],
    };
    const hasReusableProviderEvidence = (musicProvider === "mureka" || musicProvider === "suno") &&
      Object.values(providerEvidenceKeys).every((key) => typeof key === "string" && key.length > 0);
    if (hasReusableProviderEvidence && sourceProfile && sourceProfile === runProfile) {
      for (const sibling of siblings) {
        const siblingProfile = groupMusicSoundProfileFingerprint({
          family: sibling.family,
          contentLaneKey: sibling.contentLane?.key,
          provider: storedChannelMusicProvider(sibling),
          styleDNA: sibling.styleDNA,
        });
        if (siblingProfile === sourceProfile) {
          reusableMusicProfileBySibling.set(String(sibling._id), sourceProfile);
        }
      }
    }
    if (ctx.store["musicKey"] && reusableMusicProfileBySibling.size === 0) {
      ctx.log("emit_bundle: channel music profiles are not explicitly equivalent; siblings will create their own sound");
    }

    const topic = ctx.store["topic"] as string | undefined;
    const script = ctx.store["script"];
    const narrationText = ctx.store["narrationText"] as string | undefined;
    const musicKey = ctx.store["musicKey"] as string | undefined;
    const footageClips = (ctx.store["footageClips"] as string[] | undefined) ?? [];
    const sourceFootageKeys = (ctx.store["footageKeys"] as string[] | undefined) ?? [];
    const sourceStockEvidenceRaw = ctx.store["thirdPartyStockEvidence"];
    const bundleDir = `owner/${ctx.ownerId}/group/${groupId}/bundle/${ctx.runId}/`;

    // Persist every reused dependency before a child is admitted. A partial
    // bundle would make a sibling fall back to fresh generation or reference a
    // base-run object that cleanup is allowed to delete.
    const footageKeys: string[] = [];
    const footageSha256: string[] = [];
    let durableMusicKey: string | undefined;
    let durableMusicSha256: string | undefined;
    let durableMusicByteLength: number | undefined;
    let durableProviderEvidence: {
      program: { key: string; sha256: string };
      source: { key: string; sha256: string };
      quality: { key: string; sha256: string };
      auditionWav: { key: string; sha256: string };
    } | undefined;
    let durableThirdPartyStockEvidence: ThirdPartyStockEvidenceReference | undefined;
    try {
      let sourceStockManifest: ThirdPartyStockEvidenceManifest | undefined;
      if (sourceStockEvidenceRaw !== undefined) {
        const sourceStockEvidence = ThirdPartyStockEvidenceReferenceSchema.parse(sourceStockEvidenceRaw);
        const sourceBytes = await getObjectBytes(sourceStockEvidence.manifestKey);
        sourceStockManifest = parseThirdPartyStockEvidenceManifestBytes(sourceBytes);
        assertThirdPartyStockEvidenceReferenceBinding({
          reference: sourceStockEvidence,
          manifest: sourceStockManifest,
        });
        assertThirdPartyStockEvidenceMatchesFootageKeys({
          manifest: sourceStockManifest,
          footageKeys: sourceFootageKeys,
        });
        if (sourceStockManifest.inputs.length !== footageClips.length) {
          throw new Error("stock evidence input count does not match local footage bundle inputs");
        }
      }
      for (let i = 0; i < footageClips.length; i++) {
        const key = `${bundleDir}clip_${i}.mp4`;
        const bytes = await readBytes(footageClips[i]);
        await putObject(key, bytes, { contentType: "video/mp4" });
        footageKeys.push(key);
        footageSha256.push(createHash("sha256").update(bytes).digest("hex"));
      }
      if (sourceStockManifest) {
        for (const input of sourceStockManifest.inputs) {
          if (input.footageSha256 !== footageSha256[input.ordinal]) {
            throw new Error(`stock evidence bytes changed while bundling footage ordinal ${input.ordinal}`);
          }
        }
        const bundleManifest = assertThirdPartyStockEvidenceMatchesFootageKeys({
          manifest: {
            ...sourceStockManifest,
            inputs: sourceStockManifest.inputs.map((input, ordinal) => ({
              ...input,
              ordinal,
              footageKey: footageKeys[ordinal],
              footageSha256: footageSha256[ordinal],
            })),
          },
          footageKeys,
        });
        const bundleManifestSha256 = thirdPartyStockEvidenceManifestSha256(bundleManifest);
        const bundleManifestKey = `${bundleDir}third-party-stock-evidence/${bundleManifestSha256}.json`;
        await putObject(bundleManifestKey, Buffer.from(JSON.stringify(bundleManifest)), {
          contentType: "application/json",
        });
        durableThirdPartyStockEvidence = createThirdPartyStockEvidenceReference({
          manifestKey: bundleManifestKey,
          manifest: bundleManifest,
        });
      }
      // Copy the music track into the durable bundle path. Never fall back to
      // the base run key: cleanup can remove it before a queued sibling starts.
      if (musicKey && reusableMusicProfileBySibling.size > 0) {
        durableMusicKey = `${bundleDir}music.mp3`;
        const musicBytes = await getObjectBytes(musicKey);
        await putObject(durableMusicKey, musicBytes, { contentType: "audio/mpeg" });
        durableMusicSha256 = createHash("sha256").update(musicBytes).digest("hex");
        durableMusicByteLength = musicBytes.byteLength;
        const evidence: typeof durableProviderEvidence = {} as NonNullable<typeof durableProviderEvidence>;
        for (const [name, sourceKey] of Object.entries(providerEvidenceKeys) as Array<
          [keyof typeof providerEvidenceKeys, string]
        >) {
          const bytes = await getObjectBytes(sourceKey);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const suffix = name === "auditionWav" ? "wav" : "json";
          const key = `${bundleDir}music-evidence/${name}-${sha256}.${suffix}`;
          await putObject(key, bytes, { contentType: suffix === "wav" ? "audio/wav" : "application/json" });
          evidence[name] = { key, sha256 };
        }
        durableProviderEvidence = evidence;
      }

      const bundle = {
        baseRunId: ctx.runId,
        topic,
        script,
        narrationText,
        footageKeys,
        thirdPartyStockEvidence: durableThirdPartyStockEvidence,
        musicKey: durableMusicKey,
      };
      await putObject(`${bundleDir}bundle.json`, new TextEncoder().encode(JSON.stringify(bundle)), {
        contentType: "application/json",
      });
    } catch (e) {
      ctx.log(`emit_bundle: durable bundle copy failed: ${e instanceof Error ? e.message : e}`);
      throw dispatchFailure(e, "durable bundle copy failed before fan-out admission");
    }

    // Fan out a localized, asset-reusing run to each sibling. The Convex claim
    // creates at most one child receipt per (base run, sibling) and freezes its
    // payload before the Trigger boundary. Every caller then shares its global
    // dispatch key, including a replay after an accepted-but-lost response.
    let fanned = 0;
    const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
    // Only ACTIVE siblings — a draft/disabled sibling (e.g. YouTube not yet
    // connected) shouldn't burn a render that would fail at upload. Enable a
    // sibling (Settings → ON) once it's ready and the next base run fans out to it.
    for (const sib of siblings) {
      const reuseProfileFingerprint = reusableMusicProfileBySibling.get(String(sib._id));
      const envelope = bundleFanoutEnvelope({
        ownerId: ctx.ownerId,
        baseRunId: ctx.runId,
        baseChannelId: String(ctx.channelId),
        siblingChannelId: String(sib._id),
        reuse: {
          language: sib.language ?? "en",
          ...(topic !== undefined ? { topic } : {}),
          ...(script !== undefined ? { script } : {}),
          footageKeys,
          ...(durableThirdPartyStockEvidence !== undefined
            ? { thirdPartyStockEvidence: durableThirdPartyStockEvidence }
            : {}),
          ...(durableMusicKey !== undefined && reuseProfileFingerprint !== undefined
            ? { musicKey: durableMusicKey }
            : {}),
          ...(durableMusicKey !== undefined && reuseProfileFingerprint !== undefined &&
            durableMusicSha256 !== undefined && durableMusicByteLength !== undefined
            ? { musicReuseReceipt: createMusicReuseReceipt({
                ownerId: ctx.ownerId,
                baseRunId: ctx.runId,
                baseChannelId: String(ctx.channelId),
                siblingChannelId: String(sib._id),
                family: String(channel.family),
                contentLaneKey: String(channel.contentLane!.key),
                provider: musicProvider as "mureka" | "suno",
                musicKey: durableMusicKey,
                audioSha256: durableMusicSha256,
                audioByteLength: durableMusicByteLength,
                soundProfileFingerprint: reuseProfileFingerprint,
                baseMusicKey: musicKey!,
                providerEvidence: durableProviderEvidence!,
              }) }
            : {}),
        },
      });
      const child = await c.mutation(api.runs.claimBundleFanoutRun, {
        ownerId: ctx.ownerId,
        baseRunId: ctx.runId as Id<"runs">,
        baseChannelId: ctx.channelId as Id<"channels">,
        siblingChannelId: sib._id,
        dispatchKey: envelope.dispatchKey,
        envelope,
        fingerprint: envelope.dispatchEnvelopeFingerprint,
      }) as { runId: Id<"runs">; envelope: unknown };
      const dispatch = await c.mutation(api.runs.claimBundleFanoutDispatch, {
        ownerId: ctx.ownerId,
        runId: child.runId,
        now: Date.now(),
      }) as BundleDispatchClaim;
      if (dispatch.kind === "enqueued") {
        fanned++;
        continue;
      }
      if (dispatch.kind === "failed") {
        throw new ExecutionError(
          `emit_bundle: fan-out to ${sib.slug} is terminal: ${dispatch.error ?? "manual reconciliation required"}`,
          { code: "BUNDLE_FANOUT_DISPATCH_TERMINAL", retryable: false, phase: "emit_bundle" },
        );
      }
      if (dispatch.kind === "busy" || dispatch.kind === "pending") {
        throw new ExecutionError(
          `emit_bundle: fan-out to ${sib.slug} is already durable but ${dispatch.kind}; retry after ${dispatch.retryAt ?? "its dispatch lease"}`,
          { code: "BUNDLE_FANOUT_DISPATCH_PENDING", retryable: true, phase: "emit_bundle" },
        );
      }
      let triggerAccepted = false;
      try {
        const request = bundleFanoutDispatchSchedule({
          runId: String(child.runId),
          envelope: dispatch.envelope,
        });
        const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, {
          scope: "global",
        });
        await tasks.trigger("run-pipeline", request.payload, {
          concurrencyKey: request.concurrencyKey,
          idempotencyKey,
        });
        triggerAccepted = true;
        await c.mutation(api.runs.markBundleFanoutDispatchEnqueued, {
          ownerId: ctx.ownerId,
          runId: child.runId,
          leaseToken: dispatch.leaseToken,
          now: Date.now(),
        });
      } catch (e) {
        if (!triggerAccepted) {
          try {
            await c.mutation(api.runs.deferBundleFanoutDispatch, {
              ownerId: ctx.ownerId,
              runId: child.runId,
              leaseToken: dispatch.leaseToken,
              now: Date.now(),
              error: e instanceof Error ? e.message.slice(0, 1_000) : String(e).slice(0, 1_000),
            });
          } catch (deferError) {
            ctx.log(
              `emit_bundle: fan-out ${sib.slug} defer receipt failed: ${
                deferError instanceof Error ? deferError.message : deferError
              }`,
            );
          }
        }
        // Do not log-and-succeed. The durable receipt either retries through
        // the minute dispatcher or reaches its bounded terminal/manual state.
        throw dispatchFailure(
          e,
          triggerAccepted
            ? `fan-out to ${sib.slug} was accepted but enqueue receipt was not recorded`
            : `fan-out to ${sib.slug} Trigger enqueue failed`,
        );
      }
      fanned++;
    }

    ctx.log(
      `emit_bundle: ${footageKeys.length} clips + music${durableThirdPartyStockEvidence ? " + stock evidence" : ""} persisted; ` +
        `fanned out ${fanned} sibling run(s)`,
    );
    return { bundleEmitted: true };
  },
};
