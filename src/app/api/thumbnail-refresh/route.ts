import { NextResponse } from "next/server";

import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { presignDownload } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { listThumbnailRefreshInventory } from "@/lib/thumbnailRefreshRuntime";
import { thumbnailRefreshRuntimeApi } from "@/lib/thumbnailRefreshRuntime";
import {
  THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
  assertThumbnailRefreshCandidateDispatch,
  thumbnailRefreshCandidateApprovalSubject,
  thumbnailRefreshDispatchKey,
  thumbnailRefreshTriggerRequest,
} from "@/lib/thumbnailRefreshCandidate";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import type { Id } from "../../../../convex/_generated/dataModel";

export const runtime = "nodejs";

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * Browser-safe inventory of thumbnail provenance. The Convex record may carry
 * an internal R2 key; this projection intentionally reduces it to presence so
 * an operator can review status without gaining a storage locator.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const inventory = await listThumbnailRefreshInventory({
      client: convexClient(),
      ownerId: actor.ownerId,
    });
    const searchParams = new URL(request.url).searchParams;
    const previewRunId = searchParams.get("previewRunId");
    const candidatePreviewRunId = searchParams.get("candidatePreviewRunId");
    if (previewRunId !== null || candidatePreviewRunId !== null) {
      // The browser may ask only for the opaque run identity it already owns.
      // Resolve the R2 key server-side from the owner-scoped inventory; never
      // let a client supply or receive a storage locator.
      const requestedRunId = previewRunId ?? candidatePreviewRunId!;
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(requestedRunId)) {
        return NextResponse.json({ ok: false, error: "invalid thumbnail preview request" }, { status: 400 });
      }
      const item = candidatePreviewRunId
        ? inventory.find((candidate) => candidate.candidateRunId === candidatePreviewRunId)
        : inventory.find((candidate) => String(candidate.runId) === previewRunId);
      const key = candidatePreviewRunId ? item?.candidateThumbnailKey : item?.thumbnailKey;
      if (!key || key.includes("..")) {
        return NextResponse.json({ ok: false, error: "retained thumbnail preview unavailable" }, { status: 404 });
      }
      return NextResponse.json(
        {
          ok: true,
          preview: {
            url: await presignDownload(key, { expiresIn: 300 }),
          },
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        inventory: inventory.map((item) => ({
          runId: item.runId,
          channelId: item.channelId,
          channelName: item.channelName,
          channelSlug: item.channelSlug,
          title: item.title,
          createdAt: item.createdAt,
          status: item.status,
          youtubeVideoId: item.youtubeVideoId ?? null,
          thumbnailPresent: Boolean(item.thumbnailKey),
          thumbnailEvidenceStatus: item.thumbnailEvidenceStatus,
          refreshAction: item.refreshAction,
          evidenceReason: item.evidenceReason,
          releaseEvidenceStatus: item.releaseEvidenceStatus,
          thumbnailReplayStatus: item.thumbnailReplayStatus,
          thumbnailReplayReason: item.thumbnailReplayReason,
          legacyCleanupAction: item.legacyCleanupAction,
          legacyCleanupReason: item.legacyCleanupReason,
          legacyCleanupExplanation: item.legacyCleanupExplanation,
          ...(item.retirementId ? {
            retirement: {
              id: item.retirementId,
              status: item.retirementStatus,
              error: item.retirementError,
              verified: Boolean(item.retirementReceiptFingerprint),
            },
          } : {}),
          ...(item.candidateRunId ? {
            candidate: {
              runId: item.candidateRunId,
              status: item.candidateStatus,
              dispatchState: item.candidateDispatchState,
              error: item.candidateDispatchLastError,
              costTotal: item.candidateCostTotal ?? 0,
              thumbnailPresent: Boolean(item.candidateThumbnailKey),
            },
          } : {}),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: "Could not load thumbnail review inventory" },
      { status: 500 },
    );
  }
}

function candidateRequestBody(value: unknown): { sourceRunId: string; confirmed: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("thumbnail refresh request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unexpected = Object.keys(body).filter((key) => !["sourceRunId", "confirmCandidateSpend"].includes(key));
  if (unexpected.length) throw new Error(`unrecognized thumbnail refresh fields: ${unexpected.join(", ")}`);
  if (body.confirmCandidateSpend !== true) {
    throw new Error("confirmCandidateSpend must be true before creating a paid private thumbnail candidate");
  }
  if (
    typeof body.sourceRunId !== "string" ||
    !/^[A-Za-z0-9_-]{8,256}$/.test(body.sourceRunId)
  ) throw new Error("sourceRunId is invalid");
  return { sourceRunId: body.sourceRunId, confirmed: true };
}

/**
 * Create one separate, production-QA thumbnail candidate. The source run and
 * current YouTube image are never changed here; external replacement remains
 * a later explicit acceptance action.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "thumbnail candidate worker is not deployed" }, { status: 503 });
    }
    const body = candidateRequestBody(await request.json());
    const convex = convexClient();
    const shell = await convex.mutation(thumbnailRefreshRuntimeApi.createCandidateShell, {
      ownerId: actor.ownerId,
      sourceRunId: body.sourceRunId as Id<"runs">,
      now: Date.now(),
    } as never) as unknown as {
      candidateRunId: Id<"runs">;
      channelId: Id<"channels">;
      sourceRunId: Id<"runs">;
      replayFingerprint: string;
      candidateStatus: string;
      dispatchState?: string;
    };
    if (
      shell.dispatchState === "queued" ||
      shell.dispatchState === "consumed" ||
      shell.dispatchState === "blocked"
    ) {
      const status = shell.dispatchState === "queued" ? 202 : 200;
      return NextResponse.json({
        ok: true,
        state: shell.dispatchState,
        candidateStatus: shell.candidateStatus,
        candidateRunId: String(shell.candidateRunId),
        sourceRunId: String(shell.sourceRunId),
        sourceChanged: false,
        youtubeChanged: false,
        maximumCostUsd: THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
      }, { status, headers: { "Cache-Control": "private, no-store" } });
    }
    let dispatch = await convex.query(thumbnailRefreshRuntimeApi.getCandidateDispatch, {
      ownerId: actor.ownerId,
      candidateRunId: shell.candidateRunId,
    } as never) as unknown;
    if (!dispatch) {
      const maximumCostUsd = THUMBNAIL_REFRESH_MAXIMUM_COST_USD;
      const provisionalDispatchKey = thumbnailRefreshDispatchKey({
        ownerId: actor.ownerId,
        sourceRunId: String(shell.sourceRunId),
        replayFingerprint: shell.replayFingerprint,
      });
      const approval = issueStudioActionApproval({
        action: "thumbnail-refresh-candidate",
        ownerId: actor.ownerId,
        subject: thumbnailRefreshCandidateApprovalSubject({
          ownerId: actor.ownerId,
          channelId: String(shell.channelId),
          sourceRunId: String(shell.sourceRunId),
          candidateRunId: String(shell.candidateRunId),
          replayFingerprint: shell.replayFingerprint,
          maximumCostUsd,
          dispatchKey: provisionalDispatchKey,
        }),
        actor: `authenticated-operator:${actor.ownerId}`,
        evidence: "Owner requested one separate production-QA thumbnail candidate; source and YouTube media remain unchanged",
        maxCostUsd: maximumCostUsd,
      });
      await convex.mutation(thumbnailRefreshRuntimeApi.claimCandidateApproval, {
        ownerId: actor.ownerId,
        channelId: shell.channelId,
        sourceRunId: shell.sourceRunId,
        candidateRunId: shell.candidateRunId,
        replayFingerprint: shell.replayFingerprint,
        maximumCostUsd,
        approval,
        approvalFingerprint: studioActionApprovalFingerprint(approval),
        now: Date.now(),
      } as never);
      dispatch = await convex.query(thumbnailRefreshRuntimeApi.getCandidateDispatch, {
        ownerId: actor.ownerId,
        candidateRunId: shell.candidateRunId,
      } as never);
    }
    const sealed = assertThumbnailRefreshCandidateDispatch(dispatch);
    const triggerRequest = thumbnailRefreshTriggerRequest(sealed);
    const attempt = sealed.dispatchAttempt + 1;
    try {
      const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
      const idempotencyKey = await idempotencyKeys.create(triggerRequest.idempotencySeed, { scope: "global" });
      const handle = await tasks.trigger(triggerRequest.taskId, triggerRequest.payload, {
        concurrencyKey: triggerRequest.concurrencyKey,
        idempotencyKey,
      });
      await convex.mutation(thumbnailRefreshRuntimeApi.markCandidateDispatchQueued, {
        ownerId: actor.ownerId,
        candidateRunId: shell.candidateRunId,
        triggerRunId: handle.id,
        attempt,
        now: Date.now(),
      } as never);
    } catch (error) {
      await convex.mutation(thumbnailRefreshRuntimeApi.recordCandidateDispatchFailure, {
        ownerId: actor.ownerId,
        candidateRunId: shell.candidateRunId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      } as never);
      // The durable pending outbox retries this exact global Trigger identity.
    }
    return NextResponse.json({
      ok: true,
      state: "queued",
      candidateRunId: String(shell.candidateRunId),
      sourceRunId: String(shell.sourceRunId),
      sourceChanged: false,
      youtubeChanged: false,
      maximumCostUsd: THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not create thumbnail candidate";
    const status = /invalid|must|unrecognized|requires|retained|source|replay/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
