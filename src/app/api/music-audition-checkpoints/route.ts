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
import { measureNativeMusicQuality } from "@/lib/nativeMusicQuality";
import {
  assertMusicAuditionNativeBytes,
  createMusicAuditionApproval,
  MusicAuditionCheckpointSchema,
} from "@/engine/musicAuditionCheckpoint";
import { assertPinnedMiniMaxMusic3Receipt } from "@/lib/minimaxMusic3";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const RunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);

const musicAuditionApi = (api as unknown as {
  readonly musicAuditionCheckpoints: { readonly getReviewForRun: never; readonly approve: never; readonly reject: never };
}).musicAuditionCheckpoints;

const QualitySubmissionSchema = z.object({
  action: z.literal("approve"),
  checkpointId: z.string().trim().min(1).max(500),
  runId: RunIdSchema,
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
    const parsed = RunIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 400, headers });
    const result = await client().query(musicAuditionApi.getReviewForRun, {
      ownerId: actor.ownerId,
      runId: parsed.data as Id<"runs">,
    } as never) as unknown as ReviewResult | null;
    if (!result) return NextResponse.json({ ok: true, checkpoint: null }, { headers });
    assertOwnedKey(actor.ownerId, result.review.nativeWavKey, "music audition native WAV");
    assertOwnedKey(actor.ownerId, result.review.channelMusicProgramKey, "music audition program");
    const [programBytes, nativeWavBytes] = await Promise.all([
      getObjectBytes(result.review.channelMusicProgramKey),
      getObjectBytes(result.review.nativeWavKey),
    ]);
    const program = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(programBytes).toString("utf8")));
    if (program.fingerprint !== result.review.programFingerprint) throw new Error("music audition program fingerprint validation failed");
    const checkpoint = MusicAuditionCheckpointSchema.parse(result.review.immutableCheckpoint);
    if (checkpoint.ownerId !== actor.ownerId || checkpoint.programFingerprint !== program.fingerprint) {
      throw new Error("music audition native WAV checkpoint identity mismatch");
    }
    assertMusicAuditionNativeBytes({ expected: checkpoint.nativeOutput, bytes: nativeWavBytes });
    const nativeQuality = await measureNativeMusicQuality({
      audio: nativeWavBytes,
      durationSec: checkpoint.nativeOutput.durationSec,
    });
    const nativeWavUrl = await presignDownload(result.review.nativeWavKey, { expiresIn: 600 });
    return NextResponse.json({
      ok: true,
      checkpoint: result.checkpoint,
      review: {
        nativeWavKey: undefined, channelMusicProgramKey: undefined, musicRuntimeReceiptKey: undefined,
        checkpointFingerprint: undefined, immutableCheckpoint: undefined, nativeWavUrl,
        durationSec: result.review.durationSec, sampleRateHz: result.review.sampleRateHz, channels: result.review.channels,
        programFingerprint: result.review.programFingerprint,
        nativeQuality,
        sections: program.generation.sections.map((section) => ({ id: section.id, label: section.label, instruction: section.instruction })),
      },
    }, { headers });
  } catch (error) {
    const status = error instanceof StudioAuthError ? error.status : 503;
    return NextResponse.json({ ok: false, error: status === 503 ? "Review evidence unavailable or invalid" : "Authentication required" }, { status, headers });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session") throw new StudioAuthError("Owner session required", 403);
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
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
      assertOwnedKey(actor.ownerId, checkpoint.musicNativeWavKey, "music audition native WAV");
      assertOwnedKey(actor.ownerId, result.review.channelMusicProgramKey, "music audition program");
      assertOwnedKey(actor.ownerId, result.review.musicRuntimeReceiptKey, "music audition runtime receipt");
      const [programBytes, runtimeBytes, nativeWavBytes] = await Promise.all([
        getObjectBytes(result.review.channelMusicProgramKey),
        getObjectBytes(result.review.musicRuntimeReceiptKey),
        getObjectBytes(checkpoint.musicNativeWavKey),
      ]);
      const program = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(programBytes).toString("utf8")));
      const runtime = JSON.parse(Buffer.from(runtimeBytes).toString("utf8")) as Record<string, unknown>;
      if (program.fingerprint !== checkpoint.programFingerprint) {
        throw new Error("music audition frozen program/runtime identity mismatch");
      }
      const admittedRuntime = assertPinnedMiniMaxMusic3Receipt(runtime, program);
      if (
        admittedRuntime.programFingerprint !== checkpoint.programFingerprint ||
        admittedRuntime.output.contentSha256 !== checkpoint.nativeOutput.contentSha256 ||
        admittedRuntime.output.byteLength !== checkpoint.nativeOutput.byteLength ||
        admittedRuntime.durationSec !== checkpoint.nativeOutput.durationSec ||
        admittedRuntime.output.sampleRateHz !== checkpoint.nativeOutput.sampleRateHz ||
        admittedRuntime.output.channels !== checkpoint.nativeOutput.channels ||
        admittedRuntime.output.codec !== checkpoint.nativeOutput.codec
      ) {
        throw new Error("music audition frozen program/runtime identity mismatch");
      }
      // Never let an owner review approve a missing, overwritten, or different
      // object merely because its R2 key and worker metadata look plausible.
      assertMusicAuditionNativeBytes({ expected: checkpoint.nativeOutput, bytes: nativeWavBytes });
      // Technical measurements come from these exact retained bytes. The
      // browser only supplies human judgement for arrangement and emotional
      // quality; it cannot type metrics for a more convenient take.
      const nativeQuality = await measureNativeMusicQuality({
        audio: nativeWavBytes,
        durationSec: checkpoint.nativeOutput.durationSec,
      });
      const reviewReceiptFingerprint = sha256Hex(canonicalJson({
        version: "music-audition-human-review/v1", checkpointFingerprint: checkpoint.checkpointFingerprint,
        reviewerId: actor.ownerId, measurements: nativeQuality.measurements, sectionReviews: submission.sectionReviews,
        audition: submission.audition,
      }));
      const qualityReceipt = createMusicProgramQualityReceipt({
        program,
        output: {
          contentSha256: checkpoint.nativeOutput.contentSha256, byteLength: checkpoint.nativeOutput.byteLength,
          durationSec: checkpoint.nativeOutput.durationSec, sampleRate: checkpoint.nativeOutput.sampleRateHz,
          channels: checkpoint.nativeOutput.channels, codec: checkpoint.nativeOutput.codec,
        },
        measurements: nativeQuality.measurements,
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
      return NextResponse.json({ ok: true, result: mutationResult, approvalFingerprint: approval.approvalFingerprint }, { headers });
    }
    if (body.action !== "reject" || typeof body.checkpointId !== "string" || !body.checkpointId.trim() || Object.keys(body).some((key) => key !== "action" && key !== "checkpointId")) {
      return NextResponse.json({ ok: false, error: "Invalid audition request" }, { status: 400, headers });
    }
    const result = await client().mutation(musicAuditionApi.reject, {
      ownerId: actor.ownerId, checkpointId: body.checkpointId, reviewerId: actor.ownerId, now: Date.now(),
    } as never);
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    const status = error instanceof StudioAuthError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    return NextResponse.json({ ok: false, error: status === 400 ? "Invalid audition request" : status === 503
      ? "Audition could not be saved; reload before retrying" : "Owner session required" }, { status, headers });
  }
}
