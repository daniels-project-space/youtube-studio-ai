import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { NextResponse } from "next/server";

import {
  ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT,
  ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256,
  ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  ernieThumbnailBatchApplyApprovalSubject,
} from "@/lib/ernieThumbnailRefreshBatch";
import { StudioAuthError } from "@/lib/operatorSession";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import { AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX } from "@/lib/studioActionApprovalContract";

export const runtime = "nodejs";

function body(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ERNIE thumbnail batch request must be an object");
  }
  const input = value as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => key !== "confirmReplaceAll");
  if (unexpected.length) throw new Error(`Unrecognized ERNIE thumbnail batch fields: ${unexpected.join(", ")}`);
}

/**
 * Starts exactly one reviewed, SHA-pinned native-ERNIE thumbnail batch. This
 * endpoint is intentionally session-free and idempotent: the caller supplies
 * neither media, target IDs, storage keys nor authority to alter the pinned
 * manifest. The worker revalidates all 30 source PNGs and exact video bindings.
 */
export async function POST(request: Request) {
  try {
    const ownerId = ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID;
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "ERNIE thumbnail batch worker is not deployed" }, { status: 503 });
    }
    body(await request.json());
    const batchFingerprint = ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256;
    const approval = issueStudioActionApproval({
      action: "thumbnail-ernie-batch-apply",
      ownerId,
      subject: ernieThumbnailBatchApplyApprovalSubject({ ownerId, batchFingerprint }),
      actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${ownerId}`,
      evidence: `Standing owner thumbnail policy admitted all ${ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT} SHA-pinned native ERNIE thumbnails for their exact reviewed YouTube video bindings.`,
    });
    const approvalFingerprint = studioActionApprovalFingerprint(approval);
    const idempotencyKey = await idempotencyKeys.create(
      `ernie-thumbnail-batch-apply:${ownerId}:${batchFingerprint}:automatic-policy-v2`,
      { scope: "global" },
    );
    const handle = await tasks.trigger("ernie-thumbnail-batch-apply", {
      ownerId,
      batchFingerprint,
      approval,
      approvalFingerprint,
    }, {
      concurrencyKey: ownerId,
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
