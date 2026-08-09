import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import {
  channelDesignApprovalSubject,
  issueStudioActionApproval,
  youtubeChannelIntentApprovalSubject,
} from "@/lib/studioActionApproval";
import { validateChannelBuildRequestKey } from "@/lib/channelBuildRequestKey";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import { getNiche } from "@/lib/nicheCatalog";
import { channelInceptionSlug } from "@/lib/channelInceptionIdentity";
import { channelBuildCostAuthority } from "@/lib/channelBuildCostAuthority";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";

/**
 * POST /api/build-channel  { seed: string }   → { id }  (Trigger run handle)
 * GET  /api/build-channel?id=<runId>          → { status, output }
 *
 * Fires + polls the autonomous `build-channel-package` task. Server-only (the
 * Trigger SDK needs Node + the secret key). Graceful 503 when the engine isn't
 * deployed yet (no TRIGGER_SECRET_KEY).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: { seed?: string; design?: Record<string, unknown>; requestKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const seed = body.seed?.trim();
  if (!seed && !body.design) {
    return NextResponse.json({ error: "missing seed or design" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Builder not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    // Structured wizard design → modular `design-channel`; legacy single seed →
    // `build-channel-package`. Advanced-editor param overrides are sanitized
    // (unknown blocks/keys dropped, numbers clamped) before reaching the task.
    let design = body.design;
    const requestKey = body.requestKey?.trim();
    if (design && !requestKey) {
      return NextResponse.json({ error: "missing channel creation requestKey" }, { status: 400 });
    }
    // Bind the key to the operator's exact submitted intent before any server
    // normalization. This makes retries stable without allowing changed input.
    if (design && requestKey && !validateChannelBuildRequestKey(requestKey, design)) {
      return NextResponse.json(
        { error: "channel creation requestKey was reused with a different design" },
        { status: 409 },
      );
    }
    if (design && design.paramOverrides) {
      const { sanitizeParamOverrides } = await import("@/engine/moduleCatalog");
      design = { ...design, paramOverrides: sanitizeParamOverrides(design.paramOverrides) };
    }
    let channelSlug: string | undefined;
    if (design) {
      const normalizedRequestKey = requestKey!;
      const familyKey = typeof design.family === "string" ? design.family : "";
      if (!(familyKey in FAMILIES)) {
        return NextResponse.json({ error: "unsupported channel family" }, { status: 400 });
      }
      const family = FAMILIES[familyKey as FamilyKey];
      const nicheKey = typeof design.nicheKey === "string" ? design.nicheKey.trim() : "";
      if (!nicheKey) {
        return NextResponse.json({ error: "missing channel niche" }, { status: 400 });
      }
      // This authenticated route is the only place the wizard's explicit
      // confirmations become their separate external-action authorities.
      const approvedForSetupSpend = design.approveSetupSpend === true;
      const approvedForPublish = design.approvedForPublish === true;
      const approvedForYoutubeCreation = design.autoYoutube === true;
      const approvedForProbe = design.runProbe === true;
      const minimumBudgetUsd = family.defaultRunBudgetUsd ?? 0.5;
      const perVideoBudgetUsd = Number(design.budget ?? family.defaultRunBudgetUsd ?? 5);
      if (
        !Number.isFinite(perVideoBudgetUsd) ||
        perVideoBudgetUsd < minimumBudgetUsd ||
        perVideoBudgetUsd > 100
      ) {
        return NextResponse.json({ error: "per-video budget must be greater than $0 and at most $100" }, { status: 400 });
      }
      if (familyKey === "documentary_collage_short") {
        if (!Array.isArray(design.sourceReferences) || design.sourceReferences.length === 0) {
          return NextResponse.json({
            error: "documentary collage Shorts require a non-empty sourceReferences array",
          }, { status: 400 });
        }
        if (!Array.isArray(design.claimEvidence) || design.claimEvidence.length === 0) {
          return NextResponse.json({
            error: "documentary collage Shorts require a non-empty claimEvidence array",
          }, { status: 400 });
        }
      }
      if ((approvedForProbe || approvedForYoutubeCreation) && !approvedForSetupSpend) {
        return NextResponse.json(
          { error: "approve the one-time setup spend before enabling validation or YouTube creation" },
          { status: 400 },
        );
      }
      const costAuthority = channelBuildCostAuthority({
        approveSetupSpend: approvedForSetupSpend,
        runProbe: approvedForProbe,
        perVideoBudgetUsd,
      });
      const submittedName = normalizeYoutubeChannelName(
        typeof design.name === "string" ? design.name : "",
      );
      let requestedYoutubeName: string | undefined;
      let requestedYoutubeHandle: string | undefined;
      if (approvedForYoutubeCreation) {
        if (!submittedName) {
          return NextResponse.json(
            { error: "name the channel before authorizing real YouTube creation" },
            { status: 400 },
          );
        }
        requestedYoutubeName = normalizeYoutubeChannelName(
          typeof design.requestedYoutubeName === "string"
            ? design.requestedYoutubeName
            : "",
        );
        requestedYoutubeHandle = normalizeYoutubeHandle(
          typeof design.requestedYoutubeHandle === "string"
            ? design.requestedYoutubeHandle
            : "",
        );
        const expectedHandle = suggestYoutubeHandle(submittedName);
        if (
          requestedYoutubeName !== submittedName ||
          requestedYoutubeHandle !== expectedHandle
        ) {
          return NextResponse.json(
            { error: "YouTube approval identity no longer matches the visible name and handle" },
            { status: 409 },
          );
        }
      }
      design = {
        ...design,
        budget: perVideoBudgetUsd,
        ...(approvedForYoutubeCreation
          ? { requestedYoutubeName, requestedYoutubeHandle }
          : {}),
        requestKey: normalizedRequestKey,
        approveSetupSpend: approvedForSetupSpend,
        setupBudgetUsd: costAuthority.setupCapUsd,
        approvedForPublish,
      };
      const fallbackName = `${getNiche(nicheKey)?.label ?? nicheKey} ${FAMILIES[familyKey as FamilyKey].label}`;
      channelSlug = channelInceptionSlug(submittedName || fallbackName, normalizedRequestKey);
      const subject = channelDesignApprovalSubject(OWNER_ID, design);
      const actor = `authenticated-operator:${OWNER_ID}`;
      design = {
        ...design,
        inceptionApproval: approvedForSetupSpend
          ? issueStudioActionApproval({
              action: "channel-inception-execute",
              ownerId: OWNER_ID,
              subject,
              actor,
              evidence: "explicit one-time setup-spend confirmation in channel creation wizard",
              maxCostUsd: costAuthority.setupCapUsd,
            })
          : undefined,
        probeApproval: approvedForProbe
          ? issueStudioActionApproval({
              action: "channel-inception-probe",
              ownerId: OWNER_ID,
              subject,
              actor,
              evidence: "explicit paid validation-render confirmation in channel creation wizard",
              maxCostUsd: costAuthority.validationCapUsd,
            })
          : undefined,
        publishingApproval: approvedForPublish
          ? issueStudioActionApproval({
              action: "channel-publish",
              ownerId: OWNER_ID,
              subject,
              actor,
              evidence: "explicit external publishing confirmation in channel creation wizard",
            })
          : undefined,
        youtubeCreationApproval: approvedForYoutubeCreation
          ? issueStudioActionApproval({
              action: "youtube-channel-create",
              ownerId: OWNER_ID,
              subject: youtubeChannelIntentApprovalSubject({
                ownerId: OWNER_ID,
                intentKey: normalizedRequestKey,
                name: requestedYoutubeName!,
                handle: requestedYoutubeHandle!,
              }),
              actor,
              evidence: "explicit YouTube channel creation confirmation in channel creation wizard",
            })
          : undefined,
      };
    }
    const handle = design
      ? await (async () => {
          const { idempotencyKeys } = await import("@trigger.dev/sdk");
          const idempotencyKey = await idempotencyKeys.create(
            `design-channel:${requestKey!}`,
            { scope: "global" },
          );
          return tasks.trigger(
            "design-channel",
            { ...design, ownerId: OWNER_ID },
            { idempotencyKey },
          );
        })()
      : await tasks.trigger("build-channel-package", { seed, ownerId: OWNER_ID });
    return NextResponse.json({
      id: handle.id,
      ...(design && requestKey ? { requestKey, slug: channelSlug } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "inactive", inactive: true }, { status: 503 });
  }
  try {
    const { runs } = await import("@trigger.dev/sdk");
    const run = await runs.retrieve(id);
    return NextResponse.json({
      status: run.status,
      output: run.output ?? null,
      error: run.error ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retrieve failed" },
      { status: 500 },
    );
  }
}
