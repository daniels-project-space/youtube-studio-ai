import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { resolveOwnerReviewedLtxRuntime } from "@/lib/reviewedLtxRuntimeStateRuntime";
import {
  channelDesignApprovalSubject,
  issueStudioActionApproval,
  youtubeChannelIntentApprovalSubject,
} from "@/lib/studioActionApproval";
import { validateChannelBuildRequestKey } from "@/lib/channelBuildRequestKey";
import {
  FAMILIES,
  FAMILY_RUNTIME_PIPELINE,
  familyEpisodeLengthError,
  familyProductionReadiness,
  productionReadyFamilyFallback,
} from "@/engine/families";
import { assessPipelineVideoRuntimeReadiness } from "@/engine/runtimeCapability";
import { getNiche } from "@/lib/nicheCatalog";
import {
  assertCanonicalChannelProgramBrief,
  briefToCreativeCapabilityIntent,
  briefToFormatSelectionInput,
  canonicalChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import { channelInceptionSlug } from "@/lib/channelInceptionIdentity";
import { channelBuildCostAuthority } from "@/lib/channelBuildCostAuthority";
import {
  dataStoryProductionReadiness,
  isDataStoryContract,
  supportsDataStoryFamily,
} from "@/engine/dataStory";
import {
  isSyntheticScenarioContract,
  syntheticScenarioContract,
} from "@/engine/syntheticScenario";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";
import { formatPreflight } from "@/engine/creative/selectFormat";
import {
  assessCreativeCapabilityAutomaticBuildAdmission,
  privateReviewCapabilityOffers,
  resolveUnhostedSupervisedCreativeCapabilityIntents,
  validateCreativeCapabilitySelections,
} from "@/engine/creative/creativeCapabilityCatalog";
import { resolveCertifiedQuizProfile } from "@/engine/certifiedQuizProfile";
import {
  assertReviewedDataStoryChannelIntake,
  isReviewedDataStoryChannelIntakeMode,
  REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE,
} from "@/engine/reviewedDataStoryChannelIntake";

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
  let body: {
    design?: Record<string, unknown>;
    programBrief?: unknown;
    requestKey?: string;
    mode?: unknown;
  };
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
  const designMode = body.design && typeof body.design === "object"
    ? body.design["supervisedDataStoryIntake"]
    : undefined;
  if (body.mode !== undefined && designMode !== undefined && body.mode !== designMode) {
    return NextResponse.json({ error: "channel-creation mode does not match the sealed design" }, { status: 400 });
  }
  const requestedMode = body.mode ?? designMode;
  if (requestedMode !== undefined && !isReviewedDataStoryChannelIntakeMode(requestedMode)) {
    return NextResponse.json({ error: "unknown channel-creation mode" }, { status: 400 });
  }
  const reviewedDataStoryIntake = isReviewedDataStoryChannelIntakeMode(requestedMode);
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Builder not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    // Advanced-editor param overrides are sanitized (unknown blocks/keys
    // dropped, numbers clamped) before reaching the modular task.
    let design = body.design;
    const requestKey = body.requestKey?.trim();
    if (!requestKey) {
      return NextResponse.json({ error: "missing channel creation requestKey" }, { status: 400 });
    }
    let programBrief: ReturnType<typeof assertCanonicalChannelProgramBrief>;
    try {
      programBrief = assertCanonicalChannelProgramBrief(design.programBrief);
      if (body.programBrief !== undefined) {
        const submittedProgramBrief = assertCanonicalChannelProgramBrief(body.programBrief);
        if (canonicalChannelProgramBrief(submittedProgramBrief) !== canonicalChannelProgramBrief(programBrief)) {
          return NextResponse.json(
            { error: "request programBrief must exactly match the request-key-bound design.programBrief" },
            { status: 400 },
          );
        }
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "invalid channel program brief" },
        { status: 400 },
      );
    }
    if (design.programRoute !== undefined) {
      return NextResponse.json({
        error: "channel program routes are server-derived from the canonical programBrief and must not be submitted by the browser",
      }, { status: 400 });
    }
    if (design.creatorIntentDiagnosis !== undefined) {
      return NextResponse.json({
        error: "creator intent diagnoses are server-derived from the canonical programBrief and program route",
      }, { status: 400 });
    }
    if (design.seriesTitle !== undefined || design.seriesCount !== undefined) {
      return NextResponse.json({
        error: "seriesTitle and seriesCount must be supplied only through programBrief.serializedProgram",
      }, { status: 400 });
    }
    const mismatchedProgramFields = [
      ...(design.family !== programBrief.family ? ["family"] : []),
      ...(design.nicheKey !== programBrief.nicheKey ? ["nicheKey"] : []),
      ...(design.subcategory !== programBrief.subcategory ? ["subcategory"] : []),
      ...(design.locale !== programBrief.locale ? ["locale"] : []),
      ...(design.concept !== programBrief.concept ? ["concept"] : []),
    ];
    if (mismatchedProgramFields.length) {
      return NextResponse.json(
        { error: `channel design ${mismatchedProgramFields.join(", ")} must match the canonical programBrief` },
        { status: 400 },
      );
    }
    // Replace every duplicated semantic field with the exact brief before the
    // idempotency check. This both binds the request key to the brief and
    // prevents later approval/dispatch code from reading mutable browser text.
    const executionDesign = { ...design };
    for (const field of [
      "family",
      "nicheKey",
      "subcategory",
      "locale",
      "concept",
      "programBrief",
      "programRoute",
      "creatorIntentDiagnosis",
    ]) {
      delete executionDesign[field];
    }
    design = {
      ...executionDesign,
      family: programBrief.family,
      nicheKey: programBrief.nicheKey,
      ...(programBrief.subcategory ? { subcategory: programBrief.subcategory } : {}),
      locale: programBrief.locale,
      concept: programBrief.concept,
      programBrief,
    };
    // Bind the key to the operator's exact submitted intent before any server
    // normalization. This makes retries stable without allowing changed input.
    const rawNarrationOverrides = design.paramOverrides && typeof design.paramOverrides === "object"
      ? (design.paramOverrides as Record<string, unknown>)["narration_tts"]
      : undefined;
    if (
      rawNarrationOverrides &&
      typeof rawNarrationOverrides === "object" &&
      (
        (rawNarrationOverrides as Record<string, unknown>)["ttsProvider"] === "qwen3" ||
        "qwenSpeaker" in rawNarrationOverrides
      )
    ) {
      return NextResponse.json({
        error: "New channel setup accepts ElevenLabs narration only.",
      }, { status: 400 });
    }
    if (!validateChannelBuildRequestKey(requestKey, design)) {
      return NextResponse.json(
        { error: "channel creation requestKey was reused with a different design" },
        { status: 409 },
      );
    }
    // Reject malformed legacy sibling fields before any broader preflight.
    // They are never route authority: the server later derives and overwrites
    // them from programBrief.programIntent before dispatch.
    if (programBrief.family === "quizyear") {
      const rawQuizOverrides = design.paramOverrides;
      const quizOverrides = rawQuizOverrides && typeof rawQuizOverrides === "object"
        ? (rawQuizOverrides as Record<string, unknown>)["quiz_year"]
        : undefined;
      if (
        quizOverrides &&
        typeof quizOverrides === "object"
        && ("categories" in quizOverrides || "topic" in quizOverrides)
      ) {
        return NextResponse.json({
          error: "QuizYear categories and topics are selected only through a certified quiz profile",
        }, { status: 400 });
      }
      try {
        if (design.quizProfile !== undefined) resolveCertifiedQuizProfile(design.quizProfile);
      } catch (error) {
        return NextResponse.json({
          error: error instanceof Error ? error.message : "invalid certified QuizYear profile",
        }, { status: 400 });
      }
    }
    if (design.paramOverrides) {
      const { sanitizeParamOverrides } = await import("@/engine/moduleCatalog");
      design = { ...design, paramOverrides: sanitizeParamOverrides(design.paramOverrides) };
    }
    let channelSlug: string;
    {
      const normalizedRequestKey = requestKey!;
      const familyKey = programBrief.family;
      const family = FAMILIES[familyKey];
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
        if (!reviewedDataStoryIntake && !dataStoryReadiness.autonomous) {
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
      const nicheKey = programBrief.nicheKey;
      const concept = programBrief.concept;
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
      // Only an owner-reviewed runtime record may supply the dynamic target.
      // Keep the lookup narrowly limited to families whose locked profile is
      // actually LTX-blocked; all other creator paths retain their existing
      // fully local/static preflight behavior.
      const staticVideoReadiness = assessPipelineVideoRuntimeReadiness(
        FAMILY_RUNTIME_PIPELINE[family.key],
      );
      const requiresReviewedLtxRuntime = staticVideoReadiness.blockers.some((blocker) =>
        blocker.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090"),
      );
      let runtimeTarget: Awaited<ReturnType<typeof resolveOwnerReviewedLtxRuntime>>["runtime"] | undefined;
      if (requiresReviewedLtxRuntime) {
        const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
        if (!convexUrl) {
          return NextResponse.json({
            error: "reviewed LTX runtime registry is unavailable because NEXT_PUBLIC_CONVEX_URL is not configured",
          }, { status: 503 });
        }
        try {
          runtimeTarget = (await resolveOwnerReviewedLtxRuntime({
            client: new StudioConvexHttpClient(convexUrl),
            ownerId: OWNER_ID,
          })).runtime;
        } catch (error) {
          return NextResponse.json({
            error: "reviewed LTX runtime registry could not be read; channel creation remains fail-closed",
            remediation: error instanceof Error ? error.message : "retry after restoring Studio registry access",
          }, { status: 503 });
        }
      }
      const creatorPreflight = formatPreflight(family.key, briefToFormatSelectionInput(programBrief, {
        ...(Number.isFinite(requestedLengthMinutes) && requestedLengthMinutes > 0
          ? { targetDurationSeconds: Math.round(requestedLengthMinutes * 60) }
          : {}),
        ...(Number.isFinite(requestedBudgetUsd) && requestedBudgetUsd > 0
          ? { maxPerVideoBudgetUsd: requestedBudgetUsd }
          : {}),
      }), { runtimeTarget });
      const capabilityIntent = briefToCreativeCapabilityIntent(programBrief);
      const unhostedSupervisedIntents = resolveUnhostedSupervisedCreativeCapabilityIntents(
        capabilityIntent,
        family.key,
      );
      if (unhostedSupervisedIntents.length) {
        const unique = (values: readonly string[]) => [...new Set(values.filter((value) => value.trim()))];
        return NextResponse.json({
          error: `${unhostedSupervisedIntents.map((intent) => intent.offer.title).join(", ")} requires private review before automatic channel creation`,
          runtimeBlockers: unique(unhostedSupervisedIntents.flatMap((intent) => intent.offer.automationAdmission.blockers)),
          sourceRequirements: unique(unhostedSupervisedIntents.flatMap((intent) => intent.offer.requirements)),
          recommendedModules: unique(unhostedSupervisedIntents.flatMap((intent) => intent.offer.modules.map((module) => module.block))),
          remediation: unique(unhostedSupervisedIntents.map((intent) => intent.offer.automationAdmission.remediation)),
          reviewHrefs: unique(unhostedSupervisedIntents.flatMap((intent) => intent.offer.reviewHref ? [intent.offer.reviewHref] : [])),
        }, { status: 409 });
      }
      // Capability selections are never trusted as a browser-side toggle. The
      // server re-resolves family compatibility, current catalog identity, and
      // intent eligibility before this payload can reach the designer.
      let selectedCapabilitySelections: Array<{ capability: string; catalogFingerprint: string }>;
      try {
        const resolvedCapabilities = validateCreativeCapabilitySelections({
          family: family.key,
          selections: design.capabilitySelections,
          intent: capabilityIntent,
        });
        // An explicit opt-in authorizes a draft design choice only. The
        // materialized catalog admission is separately authoritative for any
        // automatic build, spend reservation, or Trigger dispatch. This is
        // generic so a future evidence-bound module cannot accidentally turn
        // selectable into autonomous by omitting a bespoke route guard.
        const automaticCapabilityAdmission = assessCreativeCapabilityAutomaticBuildAdmission(
          resolvedCapabilities,
        );
        if (reviewedDataStoryIntake) {
          assertReviewedDataStoryChannelIntake({
            mode: requestedMode,
            programBrief,
            selections: resolvedCapabilities,
            publishMode: design.publishMode,
            approvedForPublish: design.approvedForPublish,
            approveSetupSpend: design.approveSetupSpend,
            runProbe: design.runProbe,
            autoYoutube: design.autoYoutube,
            dataStory: design.dataStory,
            sourceReferences: design.sourceReferences,
            claimEvidence: design.claimEvidence,
          });
        }
        if (!reviewedDataStoryIntake && !automaticCapabilityAdmission.autonomous) {
          const blocked = automaticCapabilityAdmission.blockers;
          const unique = (values: readonly string[]) => [...new Set(values.filter((value) => value.trim()))];
          return NextResponse.json({
            error: "The selected creative capability requires review or remediation before automatic channel creation",
            runtimeBlockers: unique(blocked.flatMap((item) => item.admission.blockers)),
            sourceRequirements: unique([
              ...creatorPreflight.sourceRequirements,
              ...blocked.flatMap((item) => item.offer.requirements),
            ]),
            recommendedModules: unique(blocked.flatMap((item) => item.offer.modules.map((module) => module.block))),
            remediation: unique(blocked.map((item) => item.admission.remediation)),
            reviewHrefs: unique(blocked.flatMap((item) => item.offer.reviewHref ? [item.offer.reviewHref] : [])),
            blockedCapabilities: blocked.map((item) => ({
              capability: item.selection.capability,
              title: item.offer.title,
              selectionMode: item.offer.selectionMode,
              ...(item.block ? { block: item.block } : {}),
              automationAdmission: item.admission,
              requirements: item.offer.requirements,
            })),
          }, { status: 409 });
        }
        selectedCapabilitySelections = resolvedCapabilities.map(({ selection }) => ({ ...selection }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid creative capability selection";
        return NextResponse.json(
          { error: message },
          { status: message.includes("private review only") ? 409 : 400 },
        );
      }
      if (selectedCapabilitySelections.length) {
        design = { ...design, capabilitySelections: selectedCapabilitySelections };
      }
      // A review-only catalog offer is a real destination, but never a
      // channel-build authority. This deliberately uses catalog admission
      // rather than brittle Casefile/children profile-name checks, so a new
      // supervised module acquires the same no-spend boundary automatically.
      const privateReviewOffers = privateReviewCapabilityOffers(creatorPreflight.creativeCapabilities);
      if (!reviewedDataStoryIntake && privateReviewOffers.length) {
        return NextResponse.json({
          error: `${privateReviewOffers.map((offer) => offer.title).join(", ")} is private review only and cannot start automatic channel creation`,
          runtimeBlockers: creatorPreflight.runtimeBlockers,
          sourceRequirements: creatorPreflight.sourceRequirements,
          recommendedModules: privateReviewOffers.flatMap((offer) => offer.modules.map((module) => module.block)),
          remediation: privateReviewOffers.map((offer) => offer.automationAdmission.remediation),
          reviewHrefs: privateReviewOffers.flatMap((offer) => offer.reviewHref ? [offer.reviewHref] : []),
        }, { status: 409 });
      }
      const supervisedModules = creatorPreflight.moduleAdmissions.filter(
        (module) => module.requiredForConcept && !module.autonomous,
      );
      if (!reviewedDataStoryIntake && supervisedModules.length) {
        return NextResponse.json({
          error: `${family.label} requires a supervised episode admission before automatic channel creation`,
          runtimeBlockers: creatorPreflight.runtimeBlockers,
          sourceRequirements: creatorPreflight.sourceRequirements,
          recommendedModules: supervisedModules.map((module) => module.block),
          remediation: supervisedModules.map((module) => module.remediation),
        }, { status: 409 });
      }
      // `formatPreflight` owns concept-sensitive source requirements. A family
      // can be generally certified while this specific brief is not: for
      // example, an original whiteboard story is automatic, whereas a factual
      // science/history claim needs a source-bound evidence route. Enforce the
      // combined result here, before route resolution, approvals, or Trigger.
      if (!reviewedDataStoryIntake && !creatorPreflight.productionReady) {
        return NextResponse.json({
          error: `${family.label} cannot start automatic channel creation: ${creatorPreflight.runtimeBlockers.join(" ")}`,
          runtimeBlockers: creatorPreflight.runtimeBlockers,
          sourceRequirements: creatorPreflight.sourceRequirements,
          remediation: creatorPreflight.missingRequirements,
        }, { status: 409 });
      }
      const runtimeReadiness = familyProductionReadiness(family.key, runtimeTarget);
      const certifiedAdmission = creatorPreflight.certifiedFamilyAdmission;
      if (!reviewedDataStoryIntake && !certifiedAdmission.automatic) {
        return NextResponse.json({
          error: `${family.label} cannot start automatic channel creation: ${certifiedAdmission.blockers.join(" ")}`,
          runtimeBlockers: certifiedAdmission.blockers,
          remediation: certifiedAdmission.remediation,
        }, { status: 409 });
      }
      if (!reviewedDataStoryIntake && !runtimeReadiness.productionReady) {
        const fallbackFamily = productionReadyFamilyFallback(family.key);
        return NextResponse.json({
          error: `${family.label} cannot start a validation or production run: ${runtimeReadiness.blockers.join(" ")}`,
          runtimeBlockers: runtimeReadiness.blockers,
          ...(fallbackFamily ? { fallbackFamily } : {}),
        }, { status: 409 });
      }
      // Resolve after every existing family/capability private-review guard but
      // before approvals, budget authority, Trigger, or any provider-capable
      // task. This preserves the stronger supervised admission explanation for
      // a cross-family intent while making every automatic route immutable.
      let programRoute: ReturnType<typeof resolveChannelProgramRoute>;
      try {
        programRoute = resolveChannelProgramRoute(programBrief);
      } catch (error) {
        return NextResponse.json({
          error: error instanceof Error ? error.message : "channel program route is not admitted for automatic build",
        }, { status: 409 });
      }
      if (programRoute.quizProfile) {
        if (design.quizProfile !== undefined && design.quizProfile !== programRoute.quizProfile) {
          return NextResponse.json({
            error: "certified QuizYear profile must match the canonical program intent",
          }, { status: 400 });
        }
        design = { ...design, quizProfile: programRoute.quizProfile };
      } else if (design.quizProfile !== undefined) {
        return NextResponse.json({
          error: "certified QuizYear profiles are currently supported only by the matching canonical QuizYear program intent",
        }, { status: 400 });
      }
      if (programRoute.syntheticScenarioProfile) {
        const scenario = syntheticScenarioContract(programRoute.syntheticScenarioProfile);
        if (
          design.syntheticScenario !== undefined
          && (!isSyntheticScenarioContract(design.syntheticScenario)
            || design.syntheticScenario.profile !== scenario.profile)
        ) {
          return NextResponse.json({
            error: "fictional AI scenario must match the canonical program intent",
          }, { status: 400 });
        }
        design = { ...design, syntheticScenario: scenario };
      } else if (design.syntheticScenario !== undefined) {
        return NextResponse.json({
          error: "fictional AI scenarios require the matching canonical illustrated program intent",
        }, { status: 400 });
      }
      if (programBrief.family === "quizyear") {
        try {
          const profile = resolveCertifiedQuizProfile(programRoute.quizProfile);
          design = { ...design, quizProfile: profile.key };
        } catch (error) {
          return NextResponse.json({
            error: error instanceof Error ? error.message : "invalid certified QuizYear profile",
          }, { status: 400 });
        }
      }
      const creatorIntentDiagnosis = deriveCreatorIntentDiagnosis({
        programBrief,
        programRoute,
      });
      design = { ...design, programRoute, creatorIntentDiagnosis };
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
        ...(reviewedDataStoryIntake
          ? { supervisedDataStoryIntake: REVIEWED_DATA_STORY_CHANNEL_INTAKE_MODE }
          : {}),
      };
      const fallbackName = `${getNiche(nicheKey)?.label ?? nicheKey} ${FAMILIES[familyKey].label}`;
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
      const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
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
