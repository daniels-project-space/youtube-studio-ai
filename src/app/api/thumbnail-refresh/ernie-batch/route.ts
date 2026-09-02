import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { NextResponse } from "next/server";

import {
  ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT,
  ERNIE_THUMBNAIL_REFRESH_BATCH_CONFIRMATION,
  ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256,
  ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  ernieThumbnailBatchApplyApprovalSubject,
} from "@/lib/ernieThumbnailRefreshBatch";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";

export const runtime = "nodejs";

function body(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ERNIE thumbnail batch request must be an object");
  }
  const input = value as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => key !== "confirmReplaceAll");
  if (unexpected.length) throw new Error(`Unrecognized ERNIE thumbnail batch fields: ${unexpected.join(", ")}`);
  if (input.confirmReplaceAll !== ERNIE_THUMBNAIL_REFRESH_BATCH_CONFIRMATION) {
    throw new Error(`Type ${ERNIE_THUMBNAIL_REFRESH_BATCH_CONFIRMATION} to apply the reviewed batch`);
  }
}

/**
 * Starts exactly one reviewed, SHA-pinned native-ERNIE thumbnail batch. The
 * browser supplies neither media, target video IDs, nor storage keys. The
 * worker revalidates all 30 source PNGs and creates an auditable replacement
 * plan for every exact video before the normal serialized YouTube task runs.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (actor.ownerId !== ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID) {
      return NextResponse.json({ ok: false, error: "This reviewed ERNIE batch belongs to a different Studio owner" }, { status: 403 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "ERNIE thumbnail batch worker is not deployed" }, { status: 503 });
    }
    body(await request.json());
    const batchFingerprint = ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256;
    const approval = issueStudioActionApproval({
      action: "thumbnail-ernie-batch-apply",
      ownerId: actor.ownerId,
      subject: ernieThumbnailBatchApplyApprovalSubject({ ownerId: actor.ownerId, batchFingerprint }),
      actor: `authenticated-operator:${actor.ownerId}`,
      evidence: `Owner confirmed all ${ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT} SHA-pinned native ERNIE thumbnails for their exact reviewed YouTube video bindings.`,
    });
    const approvalFingerprint = studioActionApprovalFingerprint(approval);
    const idempotencyKey = await idempotencyKeys.create(
      `ernie-thumbnail-batch-apply:${actor.ownerId}:${batchFingerprint}`,
      { scope: "global" },
    );
    const handle = await tasks.trigger("ernie-thumbnail-batch-apply", {
      ownerId: actor.ownerId,
      batchFingerprint,
      approval,
      approvalFingerprint,
    }, {
      concurrencyKey: actor.ownerId,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      state: "queued",
      batchCount: ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT,
      triggerRunId: handle.id,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not queue the reviewed ERNIE thumbnail batch";
    const status = /type|unrecognized|different Studio owner/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
