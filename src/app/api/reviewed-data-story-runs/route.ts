import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  assertDataStorySourceLedger,
  dataStorySourceLedgerFingerprint,
} from "@/engine/dataStorySourceLedger";
import { editorialEvidencePacketFromDataStoryLedger } from "@/engine/editorialEvidencePacket";
import { createReviewedEvidencePack } from "@/engine/reviewedEvidencePack";
import { reviewedDataStoryInitialRunChannelBinding } from "@/engine/reviewedDataStoryInitialRunAdmission";
import { sourceDataStorySchedulerAdmission } from "@/engine/dataStorySchedulerAdmission";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

// Constrain fresh-codegen looseness to the service-only persistence seam. No
// browser request can name route/profile state, an invocation, or a Trigger
// payload; those are all rebuilt from the owned channel and immutable pack.
const reviewedDataStoryApi = (api as unknown as {
  readonly reviewedEvidencePacks: { readonly admit: never; readonly listForOwner: never };
  readonly reviewedDataStoryRunAdmissions: { readonly admit: never };
}).reviewedDataStoryRunAdmissions;
const reviewedEvidencePacksApi = (api as unknown as {
  readonly reviewedEvidencePacks: { readonly admit: never; readonly listForOwner: never };
}).reviewedEvidencePacks;

class ReviewedDataStoryRequestError extends Error {}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) {
    throw new ReviewedDataStoryRequestError(`${label} is required`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewedDataStoryRequestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

type PackReviewInput = { readonly reviewerId: string; readonly reviewId: string; readonly reviewedAt: string };

function packReview(value: unknown): PackReviewInput {
  const review = record(value, "review");
  const unexpected = Object.keys(review).filter((key) => !["reviewerId", "reviewId", "reviewedAt"].includes(key));
  if (unexpected.length) throw new ReviewedDataStoryRequestError(`review has unrecognized fields: ${unexpected.join(", ")}`);
  return {
    reviewerId: requiredId(review.reviewerId, "review.reviewerId"),
    reviewId: requiredId(review.reviewId, "review.reviewId"),
    reviewedAt: requiredId(review.reviewedAt, "review.reviewedAt"),
  };
}

function requestBody(value: unknown):
  | { readonly action: "prepare_ledger"; readonly dataStorySourceLedger: Record<string, unknown> }
  | { readonly action: "save_pack"; readonly channelId: string; readonly dataStorySourceLedger: unknown; readonly review: PackReviewInput }
  | { readonly action: "start"; readonly channelId: string; readonly packId: string } {
  const body = record(value, "request body");
  if (body.action === "prepare_ledger") {
    const unexpected = Object.keys(body).filter((key) => !["action", "dataStorySourceLedger"].includes(key));
    if (unexpected.length) throw new ReviewedDataStoryRequestError(`unrecognized fields: ${unexpected.join(", ")}`);
    return {
      action: "prepare_ledger",
      dataStorySourceLedger: record(body.dataStorySourceLedger, "dataStorySourceLedger"),
    };
  }
  if (body.action === "save_pack") {
    const unexpected = Object.keys(body).filter((key) => !["action", "channelId", "dataStorySourceLedger", "review"].includes(key));
    if (unexpected.length) throw new ReviewedDataStoryRequestError(`unrecognized fields: ${unexpected.join(", ")}`);
    return {
      action: "save_pack",
      channelId: requiredId(body.channelId, "channelId"),
      dataStorySourceLedger: body.dataStorySourceLedger,
      review: packReview(body.review),
    };
  }
  if (body.action === "start") {
    const unexpected = Object.keys(body).filter((key) => !["action", "channelId", "packId"].includes(key));
    if (unexpected.length) throw new ReviewedDataStoryRequestError(`unrecognized fields: ${unexpected.join(", ")}`);
    return {
      action: "start",
      channelId: requiredId(body.channelId, "channelId"),
      packId: requiredId(body.packId, "packId"),
    };
  }
  throw new ReviewedDataStoryRequestError("action must be prepare_ledger, save_pack, or start");
}

function ledgerFingerprintInput(value: Record<string, unknown>) {
  const keys = ["version", "topic", "sources", "claims"] as const;
  for (const key of keys) {
    if (value[key] === undefined) throw new ReviewedDataStoryRequestError(`dataStorySourceLedger.${key} is required`);
  }
  return {
    version: value.version,
    topic: value.topic,
    sources: value.sources,
    claims: value.claims,
  };
}

function publicPack(pack: Record<string, unknown>) {
  return {
    id: String(pack._id ?? ""),
    contentFingerprint: pack.contentFingerprint,
    topicFingerprint: pack.topicFingerprint,
    routeKey: pack.routeKey,
    contentLaneKey: pack.contentLaneKey,
    reviewedAt: pack.reviewedAt,
    reviewerId: pack.reviewerId,
    authorityKind: pack.authorityKind,
    createdAt: pack.createdAt,
  };
}

function publicChannel(channel: Record<string, unknown>) {
  return {
    id: String(channel._id ?? ""),
    name: channel.name,
    slug: channel.slug,
    status: channel.status,
    family: channel.family,
  };
}

function responseError(error: unknown) {
  if (error instanceof StudioAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof ReviewedDataStoryRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Reviewed data-story workflow failed";
  const status = /reviewed data-story|source.data.story|evidence pack|ledger|route|profile|channel/i.test(message)
    ? 422
    : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const convex = convexClient();
    const [channels, packs] = await Promise.all([
      convex.query(api.channels.listChannels, { ownerId: actor.ownerId }),
      convex.query(reviewedEvidencePacksApi.listForOwner, { ownerId: actor.ownerId } as never),
    ]);
    const candidates = (channels as Array<Record<string, unknown>>)
      .filter((channel) => {
        const admission = sourceDataStorySchedulerAdmission({
          identity: channel.identity,
          contentLane: channel.contentLane,
          family: channel.family,
          pipeline: channel.pipeline,
        });
        return !admission.automatic && admission.reason.startsWith("Source-attributed Data Story is supervised only:");
      })
      .map(publicChannel);
    const dataStoryPacks = (packs as Array<Record<string, unknown>>)
      .filter((pack) => pack.authorityKind === "data_story_source_ledger")
      .map(publicPack);
    return NextResponse.json(
      { ok: true, channels: candidates, packs: dataStoryPacks },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = requestBody(await request.json());
    const convex = convexClient();
    const now = Date.now();
    if (body.action === "prepare_ledger") {
      // This is a convenience checksum only. Final `save_pack` still parses
      // and freshness-checks the complete reviewer-signed ledger.
      return NextResponse.json({
        ok: true,
        reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(
          ledgerFingerprintInput(body.dataStorySourceLedger) as never,
        ),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "start") {
      const result = await convex.mutation(reviewedDataStoryApi.admit, {
        ownerId: actor.ownerId,
        channelId: body.channelId as Id<"channels">,
        packId: body.packId as Id<"reviewedEvidencePacks">,
        now,
      } as never) as unknown as { state: "created" | "reused"; runId: unknown };
      return NextResponse.json(
        { ok: true, state: result.state, runId: String(result.runId) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const channel = await convex.query(api.channels.getChannel, {
      channelId: body.channelId as Id<"channels">,
    }) as unknown as Record<string, unknown> | null;
    if (!channel || channel.ownerId !== actor.ownerId) {
      throw new ReviewedDataStoryRequestError("channel is not owned by this operator");
    }
    const binding = reviewedDataStoryInitialRunChannelBinding({
      identity: channel.identity,
      contentLane: channel.contentLane,
      family: channel.family,
      pipeline: channel.pipeline,
    });
    const ledger = assertDataStorySourceLedger(body.dataStorySourceLedger);
    const pack = createReviewedEvidencePack({
      route: binding.routeSeed,
      topic: ledger.topic,
      showProfile: binding.showProfile,
      dataStorySourceLedger: ledger,
      derivedEditorialEvidencePacket: editorialEvidencePacketFromDataStoryLedger(ledger, now),
      review: body.review,
      now,
    });
    const stored = await convex.mutation(reviewedEvidencePacksApi.admit, {
      ownerId: actor.ownerId,
      pack,
      now,
    } as never) as unknown as Record<string, unknown>;
    return NextResponse.json(
      { ok: true, pack: publicPack(stored) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
