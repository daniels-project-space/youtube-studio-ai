import { NextResponse } from "next/server";

import {
  COMFY_IC_LORA_MINIMUM_VRAM_GB,
  COMFY_IC_LORA_REQUIRED_GPU_SKU,
  COMFY_IC_LORA_REQUIRED_PROVIDER,
  OFFICIAL_LTX_COMFY_IC_LORA_WORKFLOW_PROFILES,
} from "@/engine/comfyIcloraWorkerContract";
import { studioCuratedLtxCatalog } from "@/engine/curatedLoraRegistry";
import { VISUAL_TREATMENT_CATALOG } from "@/engine/visualTreatmentCatalog";
import {
  approveStudioAssetPromotionCandidateForOwner,
  getStudioAssetPromotionCandidateForApproval,
  listStudioAssetLibraryInventory,
  listStudioAssetPromotionCandidates,
  listStudioAssetReleaseFeedback,
  resolveStudioAssetApprovedImagePreview,
} from "@/lib/studioAssetLibraryRuntime";
import { resolveOwnerReviewedLtxRuntime } from "@/lib/reviewedLtxRuntimeStateRuntime";
import { listActiveMusicVideoA2VidRuntimeAdmissions } from "@/lib/musicVideoA2VidStateRuntime";
import { listAcceptedCharacterLoRAInventory } from "@/lib/narrativeSeriesStateRuntime";
import { selfHostedMusicVideoA2VidStudioReadiness } from "@/engine/selfHostedLtxMusicVideoA2Vid";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  parseFinalMasterReleaseCertificateBytes,
  verifyFinalMasterReleaseEvidenceObjects,
} from "@/lib/finalMasterReleaseCertificate";
import { getObjectBytes, getObjectIntegrity, presignDownload } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { listStudioReusableMediaInventory } from "@/lib/studioReusableMediaRuntime";

export const runtime = "nodejs";

const FINGERPRINT = /^[a-f0-9]{64}$/;

class StudioAssetPromotionRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * Studio asset inventory plus an explicit owner approval decision. This is
 * deliberately not an upload, model-download, training, or render route. Its
 * normal response never contains R2 locations or signed URLs; a separate
 * owner-authenticated preview request may mint one short-lived approved-image
 * view without exposing the backing key.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const client = convexClient();
    const requestedPreview = new URL(request.url).searchParams.get("preview");
    if (requestedPreview !== null) {
      if (!FINGERPRINT.test(requestedPreview)) {
        return NextResponse.json({ ok: false, error: "invalid Studio asset preview request" }, { status: 400 });
      }
      const preview = await resolveStudioAssetApprovedImagePreview({
        client,
        ownerId: actor.ownerId,
        assetEntryFingerprint: requestedPreview,
      });
      if (!preview) {
        // Do not reveal whether a different owner's asset exists or expose a
        // revoked/non-image resource as a browser-visible object.
        return NextResponse.json({ ok: false, error: "approved image preview unavailable" }, { status: 404 });
      }
      return NextResponse.json(
        {
          ok: true,
          preview: {
            url: await presignDownload(preview.r2Key, { expiresIn: 300 }),
            contentType: preview.contentType,
            contentSha256: preview.contentSha256,
          },
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const [assets, reusableMedia, candidates, releaseFeedback, acceptedCharacterLoRAs, directLtxRuntime, activeMusicVideoA2VidAdmissions] = await Promise.all([
      listStudioAssetLibraryInventory({ client, ownerId: actor.ownerId }),
      listStudioReusableMediaInventory({ client, ownerId: actor.ownerId }),
      listStudioAssetPromotionCandidates({ client, ownerId: actor.ownerId }),
      listStudioAssetReleaseFeedback({ client, ownerId: actor.ownerId }),
      listAcceptedCharacterLoRAInventory({ client, ownerId: actor.ownerId }),
      resolveOwnerReviewedLtxRuntime({ client, ownerId: actor.ownerId }),
      listActiveMusicVideoA2VidRuntimeAdmissions({ client, ownerId: actor.ownerId }),
    ]);
    // These official descriptors are intentionally separate from installed,
    // approved assets. A descriptor is not a downloaded model or permission
    // to create a render.
    const curatedLtxCatalog = studioCuratedLtxCatalog().map((candidate) => ({
      ...candidate,
      // A profile tells an operator which official graph family is appropriate
      // for this candidate's declared control. It is still not a local graph,
      // installed model, or execution permission.
      recommendedWorkflowProfiles: candidate.adapterClass === "ic_lora"
        ? OFFICIAL_LTX_COMFY_IC_LORA_WORKFLOW_PROFILES
          .filter((profile) => profile.guideKinds.some((kind) => candidate.controls.includes(kind)))
          .map((profile) => ({
            workflowId: profile.workflowId,
            qualityRole: profile.qualityRole,
            guideKinds: [...profile.guideKinds],
          }))
        : [],
      // IC-LoRA controls are never routed through the older direct-LTX
      // worker. This browser-safe requirement is derived from the same
      // contract that rejects a mismatched work order before spend.
      executionTarget: candidate.adapterClass === "ic_lora"
        ? {
            provider: COMFY_IC_LORA_REQUIRED_PROVIDER,
            gpuSku: COMFY_IC_LORA_REQUIRED_GPU_SKU,
            minimumVramGb: COMFY_IC_LORA_MINIMUM_VRAM_GB,
            executor: "dedicated_comfyui_ltx" as const,
          }
        : null,
    }));
    return NextResponse.json({
      ok: true,
      assets,
      reusableMedia,
      candidates,
      releaseFeedback,
      acceptedCharacterLoRAs,
      // Browser-safe readiness only. The sealed benchmark admissions and their
      // artifacts remain service-only; a catalog card is never a render grant.
      directLtxRuntime: {
        status: directLtxRuntime.status,
        gpuSku: directLtxRuntime.runtime.gpuSku,
        vramGb: directLtxRuntime.runtime.vramGb,
        benchmarkedProfileCount: directLtxRuntime.runtime.benchmarkedVideoProfileRevisions.length,
      },
      curatedLtxCatalog,
      musicVideoA2Vid: selfHostedMusicVideoA2VidStudioReadiness({
        activeRuntimeAdmissions: activeMusicVideoA2VidAdmissions,
      }),
      // Planning/QA profiles are deliberately separate from stored approved
      // assets and model descriptors. They describe what the existing Visual
      // Matter path can lock and review—not a renderer permission.
      visualTreatmentCatalog: VISUAL_TREATMENT_CATALOG.map((treatment) => ({
        key: treatment.key,
        label: treatment.label,
        description: treatment.description,
        // The catalog's family list is a supervised future seed. Today only
        // cinematic has a treatment-consuming Visual Matter path; never
        // present the remaining seeds as live compatibility.
        activePlanningFamilies: treatment.channelType.supportedFamilies.filter((family) => family === "cinematic"),
        futureFamilySeeds: treatment.channelType.supportedFamilies.filter((family) => family !== "cinematic"),
        qaBenchmarkCount: treatment.qaBenchmarks.length,
        rendererPrerequisites: [...treatment.runtime.rendererPrerequisites],
      })),
    });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not load Studio assets";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Owner decision only. The browser can name a pending candidate, but cannot
 * supply a recipe, certificate, object key, score, or promotion payload. The
 * server re-reads the retained final-master evidence before asking the
 * service-only library mutation to create the approved entry.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body: unknown = await request.json().catch(() => null);
    const action = typeof body === "object" && body !== null
      ? (body as { action?: unknown }).action
      : undefined;
    const candidateFingerprint = typeof body === "object" && body !== null
      ? (body as { candidateFingerprint?: unknown }).candidateFingerprint
      : undefined;
    if (action !== "approve-candidate" || typeof candidateFingerprint !== "string" || !FINGERPRINT.test(candidateFingerprint)) {
      throw new StudioAssetPromotionRequestError("invalid Studio asset approval request", 400);
    }

    const client = convexClient();
    const candidate = await getStudioAssetPromotionCandidateForApproval({
      client,
      ownerId: actor.ownerId,
      candidateFingerprint,
    });
    if (!candidate) {
      // Do not disclose whether another owner has a matching candidate.
      throw new StudioAssetPromotionRequestError("Studio asset candidate is unavailable", 404);
    }

    try {
      const certificate = parseFinalMasterReleaseCertificateBytes(
        await getObjectBytes(candidate.origin.finalMasterReleaseCertificateKey),
      );
      if (
        certificate.certificateFingerprint !== candidate.origin.finalMasterReleaseCertificateFingerprint
        || certificate.finalMaster.sha256 !== candidate.origin.finalMasterSha256
        || certificate.visualReview.reviewReceiptFingerprint !== candidate.origin.visualReviewReceiptFingerprint
        || certificate.qualityEvidence?.qualityEvidenceFingerprint !== candidate.origin.qualityEvidenceFingerprint
      ) {
        throw new Error("candidate no longer matches its retained final-master evidence");
      }
      const postproductionDecisionFingerprint = "postproductionDecisionFingerprint" in candidate.origin
        ? candidate.origin.postproductionDecisionFingerprint
        : undefined;
      if (
        postproductionDecisionFingerprint
        && !certificate.studioPostproductionDecisions?.some(
          (decision) => decision.receiptFingerprint === postproductionDecisionFingerprint,
        )
      ) {
        throw new Error("post-production candidate decision is absent from its retained final-master certificate");
      }
      await verifyFinalMasterReleaseEvidenceObjects({
        certificate,
        getObjectBytes,
        getObjectIntegrity,
      });
    } catch {
      throw new StudioAssetPromotionRequestError(
        "Studio asset candidate evidence is unavailable or invalid",
        422,
      );
    }
    await approveStudioAssetPromotionCandidateForOwner({
      client,
      ownerId: actor.ownerId,
      candidateFingerprint,
      approvedAt: Date.now(),
    });
    return NextResponse.json({ ok: true, candidateFingerprint });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof StudioAssetPromotionRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not approve Studio asset candidate";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
