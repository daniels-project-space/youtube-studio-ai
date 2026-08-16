import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import {
  channelDesignApprovalSubject,
  issueStudioActionApproval,
  youtubeChannelIntentApprovalSubject,
} from "@/lib/studioActionApproval";
import { validateChannelBuildRequestKey } from "@/lib/channelBuildRequestKey";
import {
  FAMILIES,
  familyEpisodeLengthError,
  familyProductionReadiness,
  productionReadyFamilyFallback,
  type FamilyKey,
} from "@/engine/families";
import { getNiche } from "@/lib/nicheCatalog";
import { channelInceptionSlug } from "@/lib/channelInceptionIdentity";
import { channelBuildCostAuthority } from "@/lib/channelBuildCostAuthority";
import {
  dataStoryProductionReadiness,
  isDataStoryContract,
  supportsDataStoryFamily,
} from "@/engine/dataStory";
import { isSyntheticScenarioContract } from "@/engine/syntheticScenario";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";
import { formatPreflight } from "@/engine/creative/selectFormat";

/**
 * POST /api/build-channel  { design, requestKey } → { id, requestKey, slug }
 * GET  /api/build-channel?id=<runId>              → { status, output }
 *
 * Starts the attested modular Channel Inception workflow only. Server-only
 * because the Trigger SDK needs Node + the secret key. Graceful 503 when the
 * engine isn't deployed yet (no TRIGGER_SECRET_KEY).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: { design?: Record<string, unknown>; requestKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // The seed-only creator predated signed intent, family/lane selection, and
  // the quality proof contract. Retire it before touching Trigger or any
  // provider-capable path rather than allowing an un-attested channel row.
  if (!body.design) {
    return NextResponse.json({
      error: "seed-only channel creation is retired; submit a structured channel design",
    }, { status: 410 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Builder not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    // Advanced-editor param overrides are sanitized (unknown blocks/keys
    // dropped, numbers clamped) before reaching the modular task.
    let design = body.design;
    const requestKey = body.requestKey?.trim();
    if (!requestKey) {
      return NextResponse.json({ error: "missing channel creation requestKey" }, { status: 400 });
    }
    // Bind the key to the operator's exact submitted intent before any server
    // normalization. This makes retries stable without allowing changed input.
    if (!validateChannelBuildRequestKey(requestKey, design)) {
      return NextResponse.json(
        { error: "channel creation requestKey was reused with a different design" },
        { status: 409 },
      );
    }
    if (design.paramOverrides) {
      const { sanitizeParamOverrides } = await import("@/engine/moduleCatalog");
      design = { ...design, paramOverrides: sanitizeParamOverrides(design.paramOverrides) };
    }
    let channelSlug: string;
    {
      const normalizedRequestKey = requestKey!;
      const familyKey = typeof design.family === "string" ? design.family : "";
      if (!(familyKey in FAMILIES)) {
        return NextResponse.json({ error: "unsupported channel family" }, { status: 400 });
      }
      const family = FAMILIES[familyKey as FamilyKey];
      if (design.dataStory !== undefined) {
        if (!isDataStoryContract(design.dataStory)) {
          return NextResponse.json({ error: "invalid source-attributed data-story contract" }, { status: 400 });
        }
        if (!supportsDataStoryFamily(family.key)) {
          return NextResponse.json({
            error: "source-attributed data story is currently supported only by Narrated + Stock Footage",
          }, { status: 400 });
        }
        const dataStoryReadiness = dataStoryProductionReadiness();
        if (!dataStoryReadiness.autonomous) {
          return NextResponse.json({
            error: `source-attributed Data Story cannot start automatic production: ${dataStoryReadiness.blockers.join(" ")}`,
            runtimeBlockers: dataStoryReadiness.blockers,
            remediation: dataStoryReadiness.remediation,
          }, { status: 409 });
        }
      }
      if (design.syntheticScenario !== undefined) {
        if (!isSyntheticScenarioContract(design.syntheticScenario)) {
          return NextResponse.json({ error: "invalid fictional AI scenario contract" }, { status: 400 });
        }
        if (family.key !== "illustrated_explainer") {
          return NextResponse.json({
            error: "fictional AI scenarios are currently supported only by Illustrated Explainer",
          }, { status: 400 });
        }
      }
      const lengthError = familyEpisodeLengthError(family.key, design.lengthMinutes);
      if (lengthError) {
        return NextResponse.json({ error: lengthError }, { status: 400 });
      }
      const nicheKey = typeof design.nicheKey === "string" ? design.nicheKey.trim() : "";
      if (!nicheKey) {
        return NextResponse.json({ error: "missing channel niche" }, { status: 400 });
      }
      const concept = typeof design.concept === "string" ? design.concept.trim() : "";
      // Cinematic is the only family where a one-line label can mean either an
      // original mini-film or a factual reconstruction. Require the explicit
      // concept that the creator advised on, then re-run that same deterministic
      // admission server-side before any provider-capable inception work.
      if (family.key === "cinematic" && concept.length < 12) {
        return NextResponse.json({
          error: "cinematic channel creation requires a specific concept so factual Casefile work can be admitted safely",
        }, { status: 400 });
      }
      const requestedLengthMinutes = Number(design.lengthMinutes);
      const requestedBudgetUsd = Number(design.budget);
      const creatorPreflight = formatPreflight(family.key, {
        concept,
        niche: getNiche(nicheKey)?.label,
        nicheKey,
        ...(Number.isFinite(requestedLengthMinutes) && requestedLengthMinutes > 0
          ? { targetDurationSeconds: Math.round(requestedLengthMinutes * 60) }
          : {}),
        ...(Number.isFinite(requestedBudgetUsd) && requestedBudgetUsd > 0
          ? { maxPerVideoBudgetUsd: requestedBudgetUsd }
          : {}),
      });
      const casefileModules = creatorPreflight.moduleAdmissions.filter(
        (module) => module.profile === "source_first_casefile/v1" ||
          module.profile === "claim_to_source_to_shot_map/v1" ||
          module.profile === "faceless_source_bound_cinematic_sequence/v1",
      );
      if (casefileModules.length) {
        return NextResponse.json({
          error: "factual cinematic Casefile concepts are private supervised episode workflows, not automatic channel creation",
          runtimeBlockers: creatorPreflight.runtimeBlockers,
          sourceRequirements: creatorPreflight.sourceRequirements,
          recommendedModules: casefileModules.map((module) => module.block),
          remediation: casefileModules.map((module) => module.remediation),
        }, { status: 409 });
      }
      const supervisedModules = creatorPreflight.moduleAdmissions.filter(
        (module) => module.requiredForConcept && !module.autonomous,
      );
      if (supervisedModules.length) {
        return NextResponse.json({
          error: `${family.label} requires a supervised episode admission before automatic channel creation`,
          runtimeBlockers: creatorPreflight.runtimeBlockers,
          sourceRequirements: creatorPreflight.sourceRequirements,
          recommendedModules: supervisedModules.map((module) => module.block),
          remediation: supervisedModules.map((module) => module.remediation),
        }, { status: 409 });
      }
      const runtimeReadiness = familyProductionReadiness(family.key);
      if (!runtimeReadiness.productionReady) {
        const fallbackFamily = productionReadyFamilyFallback(family.key);
        return NextResponse.json({
          error: `${family.label} cannot start a validation or production run: ${runtimeReadiness.blockers.join(" ")}`,
          runtimeBlockers: runtimeReadiness.blockers,
          ...(fallbackFamily ? { fallbackFamily } : {}),
        }, { status: 409 });
      }
      // This authenticated route is the only place the wizard's explicit
      // confirmations become their separate external-action authorities.
      const approvedForSetupSpend = design.approveSetupSpend === true;
      const approvedForPublish = design.approvedForPublish === true;
      const approvedForYoutubeCreation = design.autoYoutube === true;
      const approvedForProbe = design.runProbe === true;
      const minimumBudgetUsd = family.defaultRunBudgetUsd ?? 0.5;
      const maximumBudgetUsd = Math.max(100, minimumBudgetUsd);
      const perVideoBudgetUsd = Number(design.budget ?? family.defaultRunBudgetUsd ?? 5);
      if (
        !Number.isFinite(perVideoBudgetUsd) ||
        perVideoBudgetUsd < minimumBudgetUsd ||
        perVideoBudgetUsd > maximumBudgetUsd
      ) {
        return NextResponse.json({
          error: `per-video budget must be at least $${minimumBudgetUsd.toFixed(2)} and at most $${maximumBudgetUsd.toFixed(2)}`,
        }, { status: 400 });
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
        family: family.key,
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
    const handle = await (async () => {
      const { idempotencyKeys } = await import("@trigger.dev/sdk");
      const idempotencyKey = await idempotencyKeys.create(
        `design-channel:${requestKey}`,
        { scope: "global" },
      );
      return tasks.trigger(
        "design-channel",
        { ...design, ownerId: OWNER_ID },
        { idempotencyKey },
      );
    })();
    return NextResponse.json({
      id: handle.id,
      requestKey,
      slug: channelSlug,
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
