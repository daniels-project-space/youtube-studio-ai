import { NextResponse } from "next/server";
import { z } from "zod";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { getObjectBytes, presignDownload, putObject } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { ChannelMusicProgramSchema, createMusicProgramQualityReceipt } from "@/engine/channelMusicProgram";
import { createMusicAuditionApproval, MusicAuditionCheckpointSchema } from "@/engine/musicAuditionCheckpoint";

export const runtime = "nodejs";

const musicAuditionApi = (api as unknown as {
  readonly musicAuditionCheckpoints: { readonly getReviewForRun: never; readonly approve: never; readonly reject: never };
}).musicAuditionCheckpoints;

const QualitySubmissionSchema = z.object({
  action: z.literal("approve"),
  checkpointId: z.string().trim().min(1).max(500),
  runId: z.string().trim().min(1).max(500),
  measurements: z.object({
    integratedLufs: z.number().finite(), truePeakDbtp: z.number().finite(), lraLu: z.number().finite(),
    crestDb: z.number().finite(), clippedSamples: z.number().int().nonnegative(),
    maximumConsecutiveCeilingSamples: z.number().int().nonnegative(), dcOffsetAbsolute: z.number().finite(),
    silenceFraction: z.number().finite(), mechanicalArtifactScore: z.number().finite(),
  }).strict(),
  sectionReviews: z.array(z.object({
    sectionId: z.string().trim().min(1).max(80), score: z.number().finite(), evidence: z.string().trim().min(1).max(600),
  }).strict()).min(4).max(8),
  audition: z.object({
    emotionalDepthScore: z.number().finite(), arrangementDepthScore: z.number().finite(),
    hollowOrGeneric: z.boolean(), verdict: z.enum(["pass", "fail"]), notes: z.string().trim().min(1).max(1_600),
  }).strict(),
}).strict();

type ReviewResult = {
  checkpoint: Record<string, unknown>;
  review: {
    nativeWavKey: string; durationSec: number; sampleRateHz: number; channels: number; programFingerprint: string;
    channelMusicProgramKey: string; musicRuntimeReceiptKey: string; checkpointFingerprint: string;
    immutableCheckpoint: unknown;
  };
};

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function runId(value: string | null): string {
  if (!value || !value.trim() || value.length > 500) throw new Error("runId is required");
  return value;
}

function musicReviewResult(value: unknown): ReviewResult {
  if (!value || typeof value !== "object") throw new Error("music audition checkpoint is unavailable");
  const result = value as ReviewResult;
  if (!result.checkpoint || !result.review) throw new Error("music audition checkpoint has no review material");
  return result;
}

function assertOwnedKey(ownerId: string, key: string, label: string): void {
  if (!key.startsWith(`owner/${ownerId}/`) || key.includes("..")) throw new Error(`${label} ownership validation failed`);
}

async function writeImmutableQualityReceipt(key: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(canonicalJson(value));
  try {
    await putObject(key, bytes, { contentType: "application/json", ifNoneMatch: "*" });
    return;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = String((error as { name?: unknown })?.name ?? "");
    if (status !== 409 && status !== 412 && name !== "PreconditionFailed" && name !== "ConditionalRequestConflict") throw error;
  }
  const retained = Buffer.from(await getObjectBytes(key)).toString("utf8");
  if (retained !== bytes.toString("utf8")) throw new Error("music audition quality receipt key is already bound to different content");
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const result = await client().query(musicAuditionApi.getReviewForRun, {
      ownerId: actor.ownerId,
      runId: runId(new URL(request.url).searchParams.get("runId")) as Id<"runs">,
    } as never) as unknown as ReviewResult | null;
    if (!result) return NextResponse.json({ ok: true, checkpoint: null }, { headers: { "Cache-Control": "no-store" } });
    assertOwnedKey(actor.ownerId, result.review.nativeWavKey, "music audition native WAV");
    assertOwnedKey(actor.ownerId, result.review.channelMusicProgramKey, "music audition program");
    const program = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(await getObjectBytes(result.review.channelMusicProgramKey)).toString("utf8")));
    if (program.fingerprint !== result.review.programFingerprint) throw new Error("music audition program fingerprint validation failed");
    const nativeWavUrl = await presignDownload(result.review.nativeWavKey, { expiresIn: 600 });
    return NextResponse.json({
      ok: true,
      checkpoint: result.checkpoint,
      review: {
        nativeWavKey: undefined, channelMusicProgramKey: undefined, musicRuntimeReceiptKey: undefined,
        checkpointFingerprint: undefined, immutableCheckpoint: undefined, nativeWavUrl,
        durationSec: result.review.durationSec, sampleRateHz: result.review.sampleRateHz, channels: result.review.channels,
        programFingerprint: result.review.programFingerprint,
        sections: program.generation.sections.map((section) => ({ id: section.id, label: section.label, instruction: section.instruction })),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music audition review failed";
    const status = error instanceof StudioAuthError ? error.status : /runId|required|ownership|checkpoint|audition/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "approve") {
      const submission = QualitySubmissionSchema.parse(body);
      const convex = client();
      const result = musicReviewResult(await convex.query(musicAuditionApi.getReviewForRun, {
        ownerId: actor.ownerId, runId: submission.runId as Id<"runs">,
      } as never));
      if (String(result.checkpoint.id ?? "") !== submission.checkpointId) throw new Error("music audition approval checkpoint/run mismatch");
      const checkpoint = MusicAuditionCheckpointSchema.parse(result.review.immutableCheckpoint);
      if (checkpoint.ownerId !== actor.ownerId || checkpoint.runId !== submission.runId) {
        throw new Error("music audition approval ownership/run mismatch");
      }
      assertOwnedKey(actor.ownerId, result.review.channelMusicProgramKey, "music audition program");
      assertOwnedKey(actor.ownerId, result.review.musicRuntimeReceiptKey, "music audition runtime receipt");
      const [programBytes, runtimeBytes] = await Promise.all([
        getObjectBytes(result.review.channelMusicProgramKey), getObjectBytes(result.review.musicRuntimeReceiptKey),
      ]);
      const program = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(programBytes).toString("utf8")));
      const runtime = JSON.parse(Buffer.from(runtimeBytes).toString("utf8")) as Record<string, unknown>;
      if (program.fingerprint !== checkpoint.programFingerprint || runtime.programFingerprint !== program.fingerprint) {
        throw new Error("music audition frozen program/runtime identity mismatch");
      }
      const reviewReceiptFingerprint = sha256Hex(canonicalJson({
        version: "music-audition-human-review/v1", checkpointFingerprint: checkpoint.checkpointFingerprint,
        reviewerId: actor.ownerId, measurements: submission.measurements, sectionReviews: submission.sectionReviews,
        audition: submission.audition,
      }));
      const qualityReceipt = createMusicProgramQualityReceipt({
        program,
        output: {
          contentSha256: checkpoint.nativeOutput.contentSha256, byteLength: checkpoint.nativeOutput.byteLength,
          durationSec: checkpoint.nativeOutput.durationSec, sampleRate: checkpoint.nativeOutput.sampleRateHz,
          channels: checkpoint.nativeOutput.channels, codec: checkpoint.nativeOutput.codec,
        },
        measurements: submission.measurements,
        sectionReviews: submission.sectionReviews,
        audition: { ...submission.audition, reviewerId: actor.ownerId, reviewReceiptFingerprint },
      });
      const qualityReceiptKey = `owner/${actor.ownerId}/runs/${submission.runId}/audio/music-quality-${qualityReceipt.fingerprint}.json`;
      await writeImmutableQualityReceipt(qualityReceiptKey, qualityReceipt);
      const approvedAt = Date.now();
      const approval = createMusicAuditionApproval({
        version: "music-audition-approval/v1", checkpointFingerprint: checkpoint.checkpointFingerprint,
        qualityReceiptFingerprint: qualityReceipt.fingerprint, reviewerId: actor.ownerId, approvedAt,
      });
      const mutationResult = await convex.mutation(musicAuditionApi.approve, {
        ownerId: actor.ownerId, checkpointId: submission.checkpointId as Id<"musicAuditionCheckpoints">,
        reviewerId: actor.ownerId, qualityReceiptKey, qualityReceiptFingerprint: qualityReceipt.fingerprint, now: approvedAt,
      } as never);
      return NextResponse.json({ ok: true, result: mutationResult, approvalFingerprint: approval.approvalFingerprint }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "reject" || typeof body.checkpointId !== "string" || !body.checkpointId.trim() || Object.keys(body).some((key) => key !== "action" && key !== "checkpointId")) {
      throw new Error("music audition accepts only reject and checkpointId");
    }
    const result = await client().mutation(musicAuditionApi.reject, {
      ownerId: actor.ownerId, checkpointId: body.checkpointId, reviewerId: actor.ownerId, now: Date.now(),
    } as never);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music audition rejection failed";
    const status = error instanceof StudioAuthError ? error.status : /accepts|checkpoint|audition|rejection/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
