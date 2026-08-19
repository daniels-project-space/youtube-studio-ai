"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { NICHE_CATALOG_EVIDENCE, NICHES, getNiche } from "@/lib/nicheCatalog";
import { nichePreset } from "@/engine/golden";
import {
  FAMILIES,
  FAMILY_KEYS,
  FAMILY_CREW,
  CREW_ROLE_BLOCK,
  clampFamilyEpisodeLengthMinutes,
  familyDurationContract,
  familyProductionReadiness,
  formatFamilyDurationContract,
  getFamily,
  isFamilyProductionReady,
  type FamilyKey,
} from "@/engine/families";
import { ARCHETYPES } from "@/engine/archetypes";
import {
  supportsDataStoryFamily,
} from "@/engine/dataStory";
import {
  syntheticScenarioContract,
  type SyntheticScenarioProfile,
} from "@/engine/syntheticScenario";
import { MODULE_CATALOG, type ParamField } from "@/engine/moduleCatalog";
import { ModuleConfigSection, type ModuleConfigMap } from "@/components/ModuleConfigSection";
import { canonicalJson } from "@/lib/canonicalJson";
import { CHANNEL_INCEPTION_SETUP_COST_CEILING_USD } from "@/engine/channelInceptionContracts";
import {
  parsePendingChannelBuildRequest,
  reusableChannelBuildRequestKey,
  shouldRetainPendingChannelBuild,
  ChannelBuildSubmissionGate,
  type PendingChannelBuildRequest,
} from "@/lib/channelBuildRecovery";
import { channelBuildCostAuthority } from "@/lib/channelBuildCostAuthority";
import {
  normalizeYoutubeChannelName,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";
import { familySupervisedChannelInceptionCapability } from "@/engine/channelInceptionCapability";

type Phase = "form" | "building" | "error";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACTIVE_BUILD_STORAGE_KEY = "youtube-studio:active-channel-build:v1";
const PENDING_BUILD_STORAGE_KEY = "youtube-studio:pending-channel-build:v1";
const STAGE_LABELS: Record<string, string> = {
  "channel-inception-research": "Research evidence",
  "channel-inception-positioning": "Channel positioning",
  "channel-inception-seo": "SEO system",
  "channel-inception-voice": "Voice audition",
  "channel-inception-avatar": "Profile image",
  "channel-inception-banner": "Channel banner",
  "channel-inception-thumbnails": "Starter thumbnails",
  "channel-inception-pipeline": "Golden pipeline",
  "channel-inception-probe": "Private validation render",
  "channel-inception-readiness": "Production readiness",
};

interface ActiveBuildSession {
  runId: string;
  requestKey: string;
  slug: string;
  displayName: string;
  startedAt: number;
}

interface BuildProgress {
  inceptionStatus: "planned" | "running" | "complete" | "blocked";
  updatedAt: number;
  executionAuthorized: boolean;
  probeAuthorized: boolean;
  stages: Array<{
    moduleKey: string;
    status: string;
    attempts: number;
    executionPhase?: string;
    error?: string;
  }>;
}

interface Toggles {
  quotes: boolean;
  captions: boolean;
  chapters: boolean;
  notify: boolean;
  crosspost: boolean;
  shorts: boolean;
  documentaryCandidates: boolean;
  visualMatter: boolean;
}

type SupervisedCreatorSelection = {
  capabilityId: string;
  provenance?: string;
  requiredArtifacts: string[];
  reviewHref?: string;
};

type CreativeCapabilityUiOffer = {
  capability: string;
  title: string;
  description: string;
  selectionMode: "explicit_opt_in" | "private_review_only";
  reviewHref?: string;
  requirements?: string[];
  qualityFocus?: string[];
  automationAdmission?: {
    autonomous?: boolean;
    blockers?: string[];
    remediation?: string;
  };
};
const DEFAULT_TOGGLES: Toggles = {
  quotes: true,
  captions: true,
  chapters: true,
  notify: true,
  crosspost: false,
  shorts: false,
  documentaryCandidates: false,
  visualMatter: true,
};

async function browserSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Client preview of the designed block list (mirrors src/engine/designer filter).
function previewBlocks(
  familyKey: FamilyKey,
  t: Toggles,
  nicheKey?: string,
  dataStory = false,
  syntheticScenarioProfile?: SyntheticScenarioProfile,
): string[] {
  const fam = FAMILIES[familyKey];
  const base = ARCHETYPES[fam.archetypeKey]?.pipeline ?? [];
  let blocks = base
    .filter((e) => {
      if (e.block === "quote_overlays" && !t.quotes) return false;
      if (e.block === "captions" && !t.captions) return false;
      if (e.block === "notify" && !t.notify) return false;
      return true;
    })
    .map((e) => e.block);
  // Film crew (default on) — mirror the designer: niche preset roster wins, else family.
  const crew = (nichePreset(nicheKey)?.crew ?? FAMILY_CREW[familyKey] ?? []).map((r) => CREW_ROLE_BLOCK[r]).filter(Boolean);
  if (crew.length) {
    const at = blocks.indexOf("topic_select");
    const i = at >= 0 ? at + 1 : 0;
    blocks = [...blocks.slice(0, i), ...crew, ...blocks.slice(i)];
  }
  if (syntheticScenarioProfile) {
    const script = blocks.indexOf("script_gen");
    if (script >= 0) {
      blocks = [...blocks.slice(0, script), "synthetic_scenario", ...blocks.slice(script)];
      const resolvedScript = blocks.indexOf("script_gen");
      blocks = [...blocks.slice(0, resolvedScript + 1), "scenario_disclosure_gate", ...blocks.slice(resolvedScript + 1)];
    }
  }
  // The designer inserts a durable story spine for externally narrated lanes.
  // Cinematic then inserts Visual Matter immediately after it; mirror that in
  // the review preview so the optional creative module is never invisible.
  if (fam.narrated && !blocks.includes("story_spine")) {
    const narration = blocks.indexOf("narration_tts");
    if (narration >= 0) blocks = [...blocks.slice(0, narration + 1), "story_spine", ...blocks.slice(narration + 1)];
  }
  if (familyKey === "cinematic" && !blocks.includes("visual_matter")) {
    const story = blocks.indexOf("story_spine");
    if (story >= 0) blocks = [...blocks.slice(0, story + 1), "visual_matter", ...blocks.slice(story + 1)];
  }
  // Mirror the design pipeline's existing niche inserts plus the explicit
  // source-attributed data-story contract. The contract is only supported by
  // the narrated-stock timeline, so the preview never promises a no-op module
  // for a self-contained or scene-compiler renderer.
  const needsDataInserts = (dataStory && supportsDataStoryFamily(familyKey))
    || Boolean(nichePreset(nicheKey)?.insertTypes?.length);
  if (needsDataInserts && blocks.includes("timeline_assemble") && !blocks.includes("visual_inserts")) {
    const anchors = ["quote_overlays", "intro_card", "narration_tts"];
    const anchor = anchors.map((block) => blocks.indexOf(block)).find((index) => index >= 0) ?? -1;
    if (anchor >= 0) blocks = [...blocks.slice(0, anchor + 1), "visual_inserts", ...blocks.slice(anchor + 1)];
  }
  if (t.crosspost) {
    const i = blocks.findIndex((b) => b === "notify" || b === "cleanup");
    blocks = i >= 0 ? [...blocks.slice(0, i), "crosspost", ...blocks.slice(i)] : [...blocks, "crosspost"];
  }
  // Shorts spinoff — only for narrated families with an upload step (mirrors designer).
  if (t.shorts && familyKey !== "music_loop" && blocks.includes("upload_draft") && blocks.includes("narration_tts")) {
    const i = blocks.findIndex((b) => b === "notify" || b === "cleanup");
    blocks = i >= 0 ? [...blocks.slice(0, i), "shorts_spinoff", ...blocks.slice(i)] : [...blocks, "shorts_spinoff"];
  }
  if (t.documentaryCandidates && blocks.includes("upload_draft") && blocks.includes("narration_tts") && blocks.includes("metadata")) {
    const i = blocks.findIndex((b) => b === "notify" || b === "cleanup");
    blocks = i >= 0
      ? [...blocks.slice(0, i), "documentary_short_candidates", ...blocks.slice(i)]
      : [...blocks, "documentary_short_candidates"];
  }
  return blocks;
}

export default function NewChannelWizard() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState(0); // 0 niche, 1 format, 2 details, 3 review
  const [error, setError] = useState<string | null>(null);
  const [activeBuild, setActiveBuild] = useState<ActiveBuildSession | null>(null);
  const [pendingBuild, setPendingBuild] = useState<PendingChannelBuildRequest | null>(null);
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollSessionRef = useRef<ActiveBuildSession | null>(null);
  const submissionGateRef = useRef(new ChannelBuildSubmissionGate());
  const pollCallbackRef = useRef<((session: ActiveBuildSession) => void) | null>(null);

  // selections
  const [nicheKey, setNicheKey] = useState<string>("");
  const [subcategory, setSubcategory] = useState<string>("");
  const [family, setFamily] = useState<FamilyKey | "">("");
  const [name, setName] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [lengthMinutes, setLengthMinutes] = useState(10);
  const [locale, setLocale] = useState("en");
  // Default = topic/DNA-matched footage; "nature" is an explicit opt-in (it
  // hard-locks the b-roll gate to serene nature/ruins — a stoic-channel look).
  const [footageTheme, setFootageTheme] = useState("");
  const [voiceFx, setVoiceFx] = useState("none");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesCount, setSeriesCount] = useState(0);
  const [cadence, setCadence] = useState("weekly");
  const [days, setDays] = useState<number[]>([1]);
  const [budget, setBudget] = useState(5);
  const [sourceReferencesJson, setSourceReferencesJson] = useState("");
  const [claimEvidenceJson, setClaimEvidenceJson] = useState("");
  const [publishMode, setPublishMode] = useState("draft");
  const [approvedForPublish, setApprovedForPublish] = useState(false);
  const [approveSetupSpend, setApproveSetupSpend] = useState(false);
  // Creating a real external channel is consequential. Keep it opt-in even
  // though the rest of Channel Inception can run autonomously and stay draft.
  const [autoYoutube, setAutoYoutube] = useState(false);
  const [runProbe, setRunProbe] = useState(false);
  const createRequestKeyRef = useRef<{ intent: string; key: string } | null>(null);
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  // Capability acceptance never turns on from a suggestion alone. Each entry
  // stores the server-issued catalog fingerprint so stale UI advice cannot
  // mutate a pipeline after a catalog upgrade.
  const [creativeCapabilityOffers, setCreativeCapabilityOffers] = useState<CreativeCapabilityUiOffer[]>([]);
  const [capabilitySelections, setCapabilitySelections] = useState<Record<string, string>>({});
  const [capabilityCatalogFingerprint, setCapabilityCatalogFingerprint] = useState("");
  const dataStory = Boolean(capabilitySelections.source_attributed_data_story);
  const dataStorySuggested = creativeCapabilityOffers.some(
    (capability) => capability.capability === "source_attributed_data_story",
  );
  // Explicitly opt into a thought-experiment profile; no scenario is inferred
  // from a topic or advisor suggestion.
  const [syntheticScenarioProfile, setSyntheticScenarioProfile] = useState<SyntheticScenarioProfile | "">("");
  // Advanced per-module param editor: paramOverrides[blockId][key] = value.
  const [paramOverrides, setParamOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Pipeline style — per-module presets/knobs the new channel starts with
  // (validated server-side by channels.setModuleConfig in design-channel).
  const [moduleConfig, setModuleConfig] = useState<ModuleConfigMap>({});
  const [clipNote, setClipNote] = useState<string | null>(null);
  const [concept, setConcept] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [supervisedAdmission, setSupervisedAdmission] = useState<SupervisedCreatorSelection | null>(null);

  const niche = getNiche(nicheKey);
  const fam = family ? getFamily(family) : undefined;
  const duration = family ? familyDurationContract(family) : undefined;
  const costAuthority = channelBuildCostAuthority({
    approveSetupSpend,
    runProbe,
    perVideoBudgetUsd: budget,
    family: family || undefined,
  });

  const selectFamily = (
    next: FamilyKey,
    requestedSeconds?: number,
    supervised?: SupervisedCreatorSelection,
  ) => {
    if (!isFamilyProductionReady(next) && !supervised) {
      const readiness = familyProductionReadiness(next);
      setClipNote(`${FAMILIES[next].label} is registered but cannot start production today: ${readiness.blockers.join(" ")}`);
      return;
    }
    setFamily(next);
    setSupervisedAdmission(supervised ?? null);
    setCreativeCapabilityOffers([]);
    setCapabilitySelections({});
    setCapabilityCatalogFingerprint("");
    // A supervised family intake is deliberately not a channel-build
    // authorization. Clear any authority retained from an earlier autonomous
    // selection before the UI can show the review-only package.
    if (supervised) {
      setApproveSetupSpend(false);
      setRunProbe(false);
      setAutoYoutube(false);
      setPublishMode("draft");
      setApprovedForPublish(false);
      setToggles((current) => ({ ...current, crosspost: false }));
    }
    if (next !== "illustrated_explainer") setSyntheticScenarioProfile("");
    setBudget((current) => Math.max(current, FAMILIES[next].defaultRunBudgetUsd ?? 0.5));
    const authoredMinutes = requestedSeconds === undefined
      ? familyDurationContract(next).defaultSeconds / 60
      : requestedSeconds / 60;
    setLengthMinutes(clampFamilyEpisodeLengthMinutes(next, authoredMinutes));
  };

  // pick niche → default its family + subcategory + research-tuned target length
  const pickNiche = (k: string) => {
    setNicheKey(k);
    const n = getNiche(k);
    const preset = nichePreset(k);
    if (n) {
      setSubcategory(n.subcategories[0]?.name ?? "");
      if (isFamilyProductionReady(n.defaultFamily)) {
        selectFamily(n.defaultFamily, preset?.targetSeconds);
      } else {
        // A blocked renderer is not permission to turn a lofi, lore, or
        // cinematic channel into an unrelated format. Leave the format
        // unselected until an operator deliberately chooses an available lane.
        setFamily("");
        setSupervisedAdmission(null);
        const readiness = familyProductionReadiness(n.defaultFamily);
        setClipNote(`${FAMILIES[n.defaultFamily].label} is currently blocked by its production contract: ${readiness.blockers.join(" ")}. No unlike fallback was selected automatically.`);
      }
    }
  };

  const preview = useMemo(
    () => (family ? previewBlocks(family, toggles, nicheKey, dataStory, syntheticScenarioProfile || undefined) : []),
    [family, toggles, nicheKey, dataStory, syntheticScenarioProfile],
  );

  // Describe the channel in words → suggest a format + crew (operator confirms).
  function suggest() {
    const c = concept.trim();
    if (!c || suggesting) return;
    setSuggesting(true); setClipNote(null);
    (async () => {
      try {
        const res = await fetch("/api/suggest-format", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ concept: c, niche: niche?.label, nicheKey: nicheKey || undefined }) });
        const d = await res.json();
        if (!res.ok || !d.family) { setClipNote(d.error ?? "Could not suggest a format."); setSuggesting(false); return; }
        const fam = FAMILIES[d.family as FamilyKey]?.label ?? d.family;
        const alts = Array.isArray(d.alternates) && d.alternates.length
          ? ` Alternates: ${d.alternates.map((a: { family: string }) => FAMILIES[a.family as FamilyKey]?.label ?? a.family).join(", ")}.`
          : "";
        const preflight = d.preflight as {
          templateAvailable?: boolean;
          productionReady?: boolean;
          runtimeBlockers?: string[];
          planning?: {
            ready?: boolean;
            mode?: "registered_non_gemini" | "unregistered";
            capabilityId?: string;
            plannerBlock?: string;
            provenance?: string;
          };
          creatorAdmission?: {
            mode?: "registered_non_gemini" | "registered_supervised_non_gemini" | "unregistered";
            selectable?: boolean;
            privateReviewOnly?: boolean;
            capabilityId?: string;
            provenance?: string;
            requiredArtifacts?: string[];
            reviewHref?: string;
          };
          fallbackFamily?: FamilyKey;
          runtimeCompilationRequired?: boolean;
          primaryRenderer?: string;
          minimumPerVideoBudgetUsd?: number;
          missingRequirements?: string[];
          providerRequirements?: string[];
          requiredPipelineModules?: string[];
          requiredRendererChains?: string[][];
          rendererChainGuards?: Array<{ whenPresent?: string[]; requires?: string[] }>;
          qualityFocus?: string[];
          recommendedModules?: Array<{
            block?: string;
            profile?: string;
            requirements?: string[];
            automationAdmission?: {
              autonomous?: boolean;
              blockers?: string[];
              remediation?: string;
            };
          }>;
          creativeCapabilities?: CreativeCapabilityUiOffer[];
          capabilityCatalogFingerprint?: string;
          duration?: { label?: string; rationale?: string };
          validationRenderRequired?: boolean;
        } | undefined;
        const creativeCapabilities = Array.isArray(preflight?.creativeCapabilities)
          ? preflight.creativeCapabilities
          : [];
        const supervised = preflight?.creatorAdmission?.mode === "registered_supervised_non_gemini"
          && preflight.creatorAdmission.selectable
          && preflight.creatorAdmission.capabilityId
          ? {
              capabilityId: preflight.creatorAdmission.capabilityId,
              provenance: preflight.creatorAdmission.provenance,
              requiredArtifacts: [...(preflight.creatorAdmission.requiredArtifacts ?? [])],
              ...(preflight.creatorAdmission.reviewHref
                ? { reviewHref: preflight.creatorAdmission.reviewHref }
                : {}),
            }
          : undefined;
        if (preflight?.productionReady && isFamilyProductionReady(d.family as FamilyKey)) {
          selectFamily(d.family as FamilyKey);
          setCreativeCapabilityOffers(creativeCapabilities);
          setCapabilityCatalogFingerprint(preflight?.capabilityCatalogFingerprint ?? "");
        } else if (supervised) {
          selectFamily(d.family as FamilyKey, undefined, supervised);
          setCreativeCapabilityOffers(creativeCapabilities);
          setCapabilityCatalogFingerprint(preflight?.capabilityCatalogFingerprint ?? "");
        } else if (preflight?.productionReady === false) {
          setFamily("");
          setSupervisedAdmission(null);
          setCreativeCapabilityOffers([]);
          setCapabilitySelections({});
          setCapabilityCatalogFingerprint("");
        }
        const requirements = preflight?.missingRequirements?.length
          ? ` Before design can compile: ${preflight.missingRequirements.join(", ")}.`
          : preflight?.templateAvailable
            ? " The authorized design task will compile the exact pipeline and cost reservation before any validation probe can start."
            : " This template is not available for runtime design.";
        const quality = preflight?.qualityFocus?.length ? ` Quality focus: ${preflight.qualityFocus.slice(0, 3).join(", ")}.` : "";
        const providers = preflight?.providerRequirements?.length ? ` Required capabilities: ${preflight.providerRequirements.join(", ")}.` : "";
        const planningFoundation = preflight?.planning?.ready
          ? ` Creator foundation: verified no-Gemini planning${preflight.planning.plannerBlock ? ` via ${preflight.planning.plannerBlock}` : ""}${preflight.planning.capabilityId ? ` (${preflight.planning.capabilityId})` : ""}.${preflight.planning.provenance ? ` ${preflight.planning.provenance}` : ""}`
          : "";
        const chain = preflight?.requiredRendererChains?.length
          ? ` Required visual renderer path: ${preflight.requiredRendererChains.map((path) => path.join(" → ")).join(" OR ")}.`
          : preflight?.requiredPipelineModules?.length
            ? ` Required visual chain: ${preflight.requiredPipelineModules.join(" → ")}.`
          : "";
        const rendererGuards = preflight?.rendererChainGuards?.length
          ? ` Renderer guard: ${preflight.rendererChainGuards.map((guard) =>
            `when ${guard.whenPresent?.join(" + ") ?? "this renderer"} is selected, require ${guard.requires?.join(" + ") ?? "its required direction"}`,
          ).join("; ")}.`
          : "";
        const renderer = preflight?.primaryRenderer ? ` Renderer: ${preflight.primaryRenderer}.` : "";
        const budgetFloor = typeof preflight?.minimumPerVideoBudgetUsd === "number"
          ? ` Baseline standard-episode envelope: $${preflight.minimumPerVideoBudgetUsd.toFixed(2)} (exact runtime reservation is compiled before spend).`
          : "";
        const duration = preflight?.duration?.label ? ` Authored episode length: ${preflight.duration.label}.` : "";
        const runtime = preflight?.productionReady === false
          ? ` Renderer blocked: ${(preflight.runtimeBlockers ?? []).join(" ")}${preflight.fallbackFamily ? ` Operator-visible alternative: ${FAMILIES[preflight.fallbackFamily].label}.` : ""}`
          : "";
        const validation = preflight?.validationRenderRequired ? " A held-out validation render is required before promotion." : "";
        const capabilityNotes = creativeCapabilities.map((capability) => {
          const requirements = capability.requirements?.length
            ? ` Requirements: ${capability.requirements.join(", ")}.`
            : "";
          const admission = capability.automationAdmission?.autonomous === false
            ? ` Automatic production remains blocked: ${capability.automationAdmission.remediation ?? "complete its stated admission."}`
            : "";
          return capability.selectionMode === "explicit_opt_in"
            ? ` ${capability.title} is available as an explicit opt-in in Details.${requirements}${admission}`
            : ` ${capability.title} is private-review only and cannot authorize automatic build, render, spend, or publication.${requirements}`;
        }).join("");
        const supervisedNote = supervised
          ? " Private-review intake selected — it cannot start an automatic build, render, spend, or publish action."
          : "";
        const availability = supervised
          ? " (private review available; automatic renderer unavailable)"
          : d.available ? "" : " (renderer unavailable)";
        setClipNote(`Suggested format: ${fam}${availability} · pipeline crew: ${(d.crew ?? []).join(", ")}. ${d.reasoning ?? ""}${alts}${renderer}${chain}${rendererGuards}${duration}${budgetFloor}${providers}${planningFoundation}${requirements}${quality}${runtime}${validation}${capabilityNotes}${supervisedNote}`);
      } catch {
        setClipNote("Suggestion failed — pick a format manually below.");
      } finally {
        setSuggesting(false);
      }
    })();
  }

  async function create(startedAt: number) {
    setPhase("building"); setError(null); setBuildProgress(null);
    try {
      const requestedYoutubeName = normalizeYoutubeChannelName(name);
      if (autoYoutube && !requestedYoutubeName) {
        setError("Enter the exact channel name before authorizing real YouTube creation.");
        setPhase("error");
        return;
      }
      const requestedYoutubeHandle = autoYoutube
        ? suggestYoutubeHandle(requestedYoutubeName)
        : undefined;
      let sourceReferences: unknown;
      let claimEvidence: unknown;
      if (family === "documentary_collage_short") {
        try {
          sourceReferences = JSON.parse(sourceReferencesJson);
          claimEvidence = JSON.parse(claimEvidenceJson);
        } catch {
          setError("Documentary collage Shorts need valid JSON source references and claim evidence.");
          setPhase("error");
          return;
        }
        if (!Array.isArray(sourceReferences) || sourceReferences.length === 0) {
          setError("Documentary collage Shorts need at least one external source reference.");
          setPhase("error");
          return;
        }
        if (!Array.isArray(claimEvidence) || claimEvidence.length === 0) {
          setError("Documentary collage Shorts need claim evidence for every locked beat.");
          setPhase("error");
          return;
        }
      }
      const selectedCapabilitySelections = Object.entries(capabilitySelections)
        .filter(([, catalogFingerprint]) => Boolean(catalogFingerprint))
        .map(([capability, catalogFingerprint]) => ({ capability, catalogFingerprint }));
      const design: Record<string, unknown> = {
        nicheKey, subcategory, family, concept: concept.trim() || undefined, name: requestedYoutubeName || undefined,
        // Every variable-duration family receives its own authored unit. Fixed
        // engines own their timing and never receive a misleading generic value.
        lengthMinutes: fam && duration?.inputUnit !== "fixed" ? lengthMinutes : undefined,
        locale, footageTheme: family === "narrated_stock" ? footageTheme : undefined,
        voiceFx: fam?.narrated && voiceFx !== "none" ? voiceFx : undefined,
        seriesTitle: seriesTitle.trim() || undefined,
        seriesCount: seriesTitle.trim() && seriesCount > 0 ? seriesCount : undefined,
        cadence, days, budget, publishMode, approvedForPublish, toggles, autoYoutube, runProbe,
        ...(family === "documentary_collage_short" ? { sourceReferences, claimEvidence } : {}),
        ...(selectedCapabilitySelections.length ? { capabilitySelections: selectedCapabilitySelections } : {}),
        ...(family === "illustrated_explainer" && syntheticScenarioProfile
          ? { syntheticScenario: syntheticScenarioContract(syntheticScenarioProfile) }
          : {}),
        ...(autoYoutube ? { requestedYoutubeName, requestedYoutubeHandle } : {}),
        approveSetupSpend,
        setupBudgetUsd: costAuthority.setupCapUsd,
        paramOverrides: Object.keys(paramOverrides).length ? paramOverrides : undefined,
        moduleConfig: Object.keys(moduleConfig).length ? moduleConfig : undefined,
        exampleClipUrl: clipUrl.trim() || undefined,
      };
      const intent = canonicalJson(design);
      const prior = createRequestKeyRef.current;
      const persisted = parsePendingChannelBuildRequest(
        sessionStorage.getItem(PENDING_BUILD_STORAGE_KEY),
      );
      const requestKey = prior?.intent === intent
        ? prior.key
        : reusableChannelBuildRequestKey(intent, persisted) ??
          `${crypto.randomUUID()}_${await browserSha256(intent)}`;
      createRequestKeyRef.current = { intent, key: requestKey };
      const pending: PendingChannelBuildRequest = {
        version: "channel-build-pending/v1",
        intent,
        requestKey,
        design,
        displayName: name.trim() || niche?.label || "New channel",
        startedAt: persisted?.intent === intent ? persisted.startedAt : startedAt,
      };
      // Persist before dispatch. If the server accepts but its response is lost,
      // reload replays this exact globally-idempotent request instead of minting another.
      sessionStorage.setItem(PENDING_BUILD_STORAGE_KEY, JSON.stringify(pending));
      setPendingBuild(pending);
      await submitPending(pending);
    } catch {
      setError("Could not prepare the recoverable channel request."); setPhase("error");
    }
  }

  const submitPending = useCallback(async (pending: PendingChannelBuildRequest) => {
    setPhase("building"); setError(null);
    const attempt = submissionGateRef.current.begin(pending.requestKey);
    if (!attempt) return;
    try {
      const res = await fetch("/api/build-channel", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey: pending.requestKey, design: pending.design }),
        signal: attempt.controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        if (!shouldRetainPendingChannelBuild(res.status)) {
          sessionStorage.removeItem(PENDING_BUILD_STORAGE_KEY);
          setPendingBuild(null);
        }
        setError(data.error ?? "Failed to start the builder."); setPhase("error"); return;
      }
      if (typeof data.id !== "string" || typeof data.slug !== "string") {
        setError("Builder started without a recoverable run identity."); setPhase("error"); return;
      }
      const session: ActiveBuildSession = {
        runId: data.id,
        requestKey: pending.requestKey,
        slug: data.slug,
        displayName: pending.displayName,
        startedAt: pending.startedAt,
      };
      sessionStorage.setItem(ACTIVE_BUILD_STORAGE_KEY, JSON.stringify(session));
      setActiveBuild(session);
      pollCallbackRef.current?.(session);
    } catch {
      if (attempt.controller.signal.aborted) return;
      setError("The request may have started, but its response was lost. Retry uses the same request key."); setPhase("error");
    } finally {
      submissionGateRef.current.finish(attempt);
    }
  }, []);

  const poll = useCallback((session: ActiveBuildSession) => {
    pollSessionRef.current = session;
    const generation = ++pollGenerationRef.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollAbortRef.current?.abort();
    let lastTaskReadAt = 0;

    const finish = (slug: string) => {
      if (generation !== pollGenerationRef.current) return;
      sessionStorage.removeItem(ACTIVE_BUILD_STORAGE_KEY);
      sessionStorage.removeItem(PENDING_BUILD_STORAGE_KEY);
      setActiveBuild(null);
      setPendingBuild(null);
      pollSessionRef.current = null;
      router.push(`/channels/${slug}`);
    };
    const terminalError = (message: string) => {
      if (generation !== pollGenerationRef.current) return;
      // Keep both journals byte-for-byte. Reloading an accepted build resumes
      // read-only monitoring by run/slug; it must never mint a new request key
      // or automatically redispatch a paid stage after a blocker.
      pollSessionRef.current = null;
      setError(message);
      setPhase("error");
    };

    const tick = async (consecutiveErrors: number): Promise<void> => {
      if (generation !== pollGenerationRef.current) return;
      const elapsed = Date.now() - session.startedAt;
      if (elapsed > 60 * 60 * 1_000) {
        setError("The build is still running after an hour. Monitoring is paused; resume it when ready.");
        setPhase("error");
        return;
      }
      if (document.hidden) {
        pollRef.current = setTimeout(() => void tick(consecutiveErrors), 15_000);
        return;
      }

      let hadSuccessfulRead = false;
      let progressAvailable = false;
      const controller = new AbortController();
      pollAbortRef.current?.abort();
      pollAbortRef.current = controller;
      try {
        const progressResponse = await fetch(
          `/api/build-channel/progress?slug=${encodeURIComponent(session.slug)}&requestKey=${encodeURIComponent(session.requestKey)}`,
          { signal: controller.signal },
        );
        if (progressResponse.ok) {
          const progress = await progressResponse.json() as BuildProgress;
          progressAvailable = true;
          hadSuccessfulRead = true;
          if (generation !== pollGenerationRef.current) return;
          setBuildProgress(progress);
          if (progress.inceptionStatus === "complete" || progress.inceptionStatus === "planned") {
            finish(session.slug);
            return;
          }
          if (progress.inceptionStatus === "blocked") {
            const blocker = progress.stages.find((stage) => stage.status === "blocked" || stage.status === "failed");
            terminalError(blocker?.error ?? "Channel setup stopped at a blocked readiness gate.");
            return;
          }
        } else if (progressResponse.status !== 404) {
          const body = await progressResponse.json().catch(() => ({})) as { error?: string };
          if (progressResponse.status === 409) {
            terminalError(body.error ?? "Channel build identity mismatch.");
            return;
          }
        }

        const shouldReadTask = !progressAvailable || Date.now() - lastTaskReadAt >= 15_000;
        if (shouldReadTask) {
          lastTaskReadAt = Date.now();
          const taskResponse = await fetch(
            `/api/build-channel?id=${encodeURIComponent(session.runId)}`,
            { signal: controller.signal },
          );
          if (taskResponse.ok) {
            const taskState = await taskResponse.json() as {
            status?: string;
            output?: { slug?: string };
            error?: { message?: string } | string;
            };
            hadSuccessfulRead = true;
            if (taskState.status === "COMPLETED") {
              finish(taskState.output?.slug ?? session.slug);
              return;
            }
            if (["FAILED", "CRASHED", "CANCELED", "TIMED_OUT"].includes(taskState.status ?? "")) {
              const detail = typeof taskState.error === "string" ? taskState.error : taskState.error?.message;
              terminalError(detail ?? `Build ${String(taskState.status).toLowerCase()}.`);
              return;
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // A bounded retry below handles transient browser/network failures.
      } finally {
        if (pollAbortRef.current === controller) pollAbortRef.current = null;
      }

      const nextErrors = hadSuccessfulRead ? 0 : consecutiveErrors + 1;
      if (nextErrors >= 5) {
        setError("Live progress is temporarily unreachable. The build was not canceled; resume monitoring to reconnect.");
        setPhase("error");
        return;
      }
      const delay = elapsed < 30_000 ? 2_000 : elapsed < 5 * 60_000 ? 5_000 : 10_000;
      pollRef.current = setTimeout(() => void tick(nextErrors), delay);
    };

    void tick(0);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const submissionGate = submissionGateRef.current;
    pollCallbackRef.current = poll;
    const resumeVisiblePolling = () => {
      if (!document.hidden && pollSessionRef.current) poll(pollSessionRef.current);
    };
    document.addEventListener("visibilitychange", resumeVisiblePolling);
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const pending = parsePendingChannelBuildRequest(
          sessionStorage.getItem(PENDING_BUILD_STORAGE_KEY),
        );
        if (pending) {
          setPendingBuild(pending);
          createRequestKeyRef.current = { intent: pending.intent, key: pending.requestKey };
        }
        const raw = sessionStorage.getItem(ACTIVE_BUILD_STORAGE_KEY);
        let restoredActive = false;
        if (raw) {
          let session: Partial<ActiveBuildSession> | null = null;
          try { session = JSON.parse(raw) as Partial<ActiveBuildSession>; }
          catch { sessionStorage.removeItem(ACTIVE_BUILD_STORAGE_KEY); }
          if (
            session &&
            typeof session.runId === "string" &&
            typeof session.requestKey === "string" &&
            typeof session.slug === "string" &&
            typeof session.displayName === "string" &&
            typeof session.startedAt === "number"
          ) {
            const restored = session as ActiveBuildSession;
            restoredActive = true;
            setActiveBuild(restored);
            setPhase("building");
            poll(restored);
          } else if (session) {
            sessionStorage.removeItem(ACTIVE_BUILD_STORAGE_KEY);
          }
        }
        if (!restoredActive && pending) {
          setPhase("building");
          void submitPending(pending);
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(ACTIVE_BUILD_STORAGE_KEY);
        }
      }
    });
    return () => {
      cancelled = true;
      pollGenerationRef.current += 1;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollAbortRef.current?.abort();
      submissionGate.abort();
      if (pollCallbackRef.current === poll) pollCallbackRef.current = null;
      document.removeEventListener("visibilitychange", resumeVisiblePolling);
    };
  }, [poll, submitPending]);

  if (phase === "building") {
    return (
      <>
        <PageHeader title="Building channel" subtitle="Live durable progress — safe to leave and return." />
        <div className="glass" style={{ padding: "1.25rem", display: "grid", gap: "1rem", maxWidth: 760 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>{(activeBuild?.displayName ?? pendingBuild?.displayName ?? name) || niche?.label}</div>
              <div style={{ color: "var(--color-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                {buildProgress
                  ? buildProgress.inceptionStatus === "planned"
                    ? "Plan saved — no provider spend authorized"
                    : `${buildProgress.stages.filter((stage) => stage.status === "complete" || stage.status === "accepted").length}/${buildProgress.stages.length} stages finished`
                  : "Creating the durable build ledger…"}
              </div>
            </div>
            <div className="studio-pulse" aria-label="Build active" style={{ fontSize: "1.5rem" }}>✦</div>
          </div>
          {buildProgress?.stages?.length ? (
            <div style={{ display: "grid", gap: "0.45rem" }}>
              {buildProgress.stages.map((stage) => {
                const done = stage.status === "complete" || stage.status === "accepted";
                const active = stage.status === "running";
                const failed = stage.status === "blocked" || stage.status === "failed";
                return (
                  <div key={stage.moduleKey} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto", alignItems: "center", gap: "0.55rem", padding: "0.5rem 0.6rem", borderRadius: 8, background: active ? "rgba(124,124,255,0.08)" : "var(--color-surface)" }}>
                    <span style={{ color: done ? "var(--color-ok)" : failed ? "var(--color-failed)" : active ? "var(--color-accent)" : "var(--color-faint)" }}>{done ? "✓" : failed ? "!" : active ? "●" : "○"}</span>
                    <span style={{ fontSize: "0.82rem", fontWeight: active ? 600 : 500 }}>{STAGE_LABELS[stage.moduleKey] ?? stage.moduleKey}</span>
                    <span style={{ color: "var(--color-muted)", fontSize: "0.7rem" }}>{stage.status}{stage.attempts > 1 ? ` · try ${stage.attempts}` : ""}</span>
                    {stage.error && <span style={{ gridColumn: "2 / -1", color: "var(--color-failed)", fontSize: "0.72rem" }}>{stage.error}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ height: 4, borderRadius: 999, overflow: "hidden", background: "var(--color-surface)" }}>
              <div className="studio-pulse" style={{ width: "35%", height: "100%", background: "var(--color-accent)" }} />
            </div>
          )}
        </div>
      </>
    );
  }

  const canNext = step === 0
    ? !!nicheKey
    : step === 1
      ? Boolean(family && fam?.available && (isFamilyProductionReady(family) || supervisedAdmission))
      : true;
  const stepNames = ["Niche", "Format", "Details", "Review"];

  return (
    <>
      <PageHeader title="New channel" subtitle="Pick a niche, choose a format, tune the modules — the studio designs the pipeline." />

      {/* stepper */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        {stepNames.map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: i === step ? 1 : 0.5 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", fontSize: "0.72rem", fontWeight: 700,
              background: i <= step ? "var(--color-accent)" : "var(--color-surface)", color: i <= step ? "#0a0a0b" : "var(--color-muted)" }}>{i + 1}</span>
            <span style={{ fontSize: "0.82rem", fontWeight: i === step ? 600 : 500 }}>{s}</span>
            {i < stepNames.length - 1 && <span style={{ color: "var(--color-faint)" }}>›</span>}
          </div>
        ))}
      </div>

      {error && <div className="glass" role="alert" style={{ padding: "0.8rem 1rem", marginBottom: "1rem", border: "1px solid rgba(248,113,113,0.4)", color: "#fca5a5", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ display: "grid", gap: "0.25rem", minWidth: 0, flex: "1 1 320px" }}>
          <strong>Channel setup needs attention</strong>
          <span>{error}</span>
          {activeBuild && <small style={{ color: "var(--color-muted)" }}>The exact build identity is preserved. Provider work will not restart automatically.</small>}
        </span>
        <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {activeBuild && (
            <>
              <Link href={`/channels/${encodeURIComponent(activeBuild.slug)}`} style={btnPrimary}>Open channel</Link>
              <button onClick={() => { setError(null); setPhase("building"); poll(activeBuild); }} style={btnGhost}>Check progress</button>
            </>
          )}
          {!activeBuild && pendingBuild
            ? <button onClick={() => void submitPending(pendingBuild)} style={btnGhost}>Retry same request</button>
            : null}
        </span>
      </div>}

      {/* STEP 0 — niche */}
      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: "0.8rem" }}>
          {NICHES.map((n) => {
            const on = n.key === nicheKey;
            return (
              <button key={n.key} onClick={() => pickNiche(n.key)} className="glass lift" style={{ textAlign: "left", padding: "1rem", cursor: "pointer",
                border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-border)", background: on ? "rgba(124,124,255,0.08)" : undefined }}>
                <div style={{ fontSize: "1.5rem" }}>{n.icon}</div>
                <div style={{ fontWeight: 600, marginTop: "0.4rem" }}>{n.label}</div>
                <div style={{ display: "flex", gap: "0.4rem", margin: "0.4rem 0", fontSize: "0.72rem" }}>
                  <span style={{ color: "var(--color-faint)" }}>Planning seed</span>
                  <span style={{ color: n.difficulty === "Easy" ? "var(--color-ok)" : n.difficulty === "Hard" ? "var(--color-failed)" : "var(--color-accent)" }}>{n.difficulty}</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}>{n.blurb}</div>
              </button>
            );
          })}
          {niche && (
            <div className="glass" style={{ gridColumn: "1 / -1", padding: "1rem", display: "grid", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>{NICHE_CATALOG_EVIDENCE.label}</span>
              <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} style={selStyle}>
                {niche.subcategories.map((s) => <option key={s.id} value={s.name}>{s.name} — planning seed</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* STEP 1 — format */}
      {step === 1 && (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: "0.8rem" }}>
            {FAMILY_KEYS.map((k) => {
              const f = FAMILIES[k]; const on = k === family;
              const productionReady = isFamilyProductionReady(k);
              const readiness = familyProductionReadiness(k);
              const supervisedCapability = familySupervisedChannelInceptionCapability(k);
              const supervised = supervisedCapability
                ? {
                    capabilityId: supervisedCapability.id,
                    provenance: supervisedCapability.provenance,
                    requiredArtifacts: [...supervisedCapability.requiredArtifacts],
                    ...(supervisedCapability.reviewHref ? { reviewHref: supervisedCapability.reviewHref } : {}),
                  }
                : undefined;
              const selectable = f.available && (productionReady || Boolean(supervised));
              return (
                <button key={k} disabled={!selectable} onClick={() => selectable && selectFamily(k, undefined, supervised)} className="glass lift" style={{ textAlign: "left", padding: "1rem", cursor: selectable ? "pointer" : "not-allowed", opacity: selectable ? 1 : 0.55,
                  border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-border)", background: on ? "rgba(124,124,255,0.08)" : undefined }}>
                  <div style={{ fontWeight: 600 }}>{f.label}{supervised ? <span style={{ fontSize: "0.66rem", marginLeft: 6, color: "var(--color-accent)" }}>· private review only</span> : !selectable && <span style={{ fontSize: "0.66rem", marginLeft: 6, color: "var(--color-accent)" }}>· renderer blocked — no spend</span>}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.35rem" }}>{f.description}</div>
                  {supervised
                    ? <div style={{ fontSize: "0.7rem", color: "var(--color-muted)", marginTop: "0.35rem" }}>Select to see the private-review requirements; no automatic build, render, spend, or publish can start here.</div>
                    : !selectable && readiness.blockers[0] && <div style={{ fontSize: "0.7rem", color: "var(--color-muted)", marginTop: "0.35rem" }}>{readiness.blockers[0]}</div>}
                </button>
              );
            })}
          </div>
          <label style={lblStyle}><span style={capStyle}>Channel name (optional — auto-generated if blank)</span>
            <input value={name} onChange={(e) => {
              setName(e.target.value);
              if (!normalizeYoutubeChannelName(e.target.value)) setAutoYoutube(false);
            }} placeholder="e.g. Stoic Truths" style={inpStyle} /></label>
          <label style={lblStyle}><span style={capStyle}>Reference video URL (optional — retained as operator context; no automatic copying or clip analysis)</span>
            <input value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} placeholder="paste a YouTube link whose qualities you want to discuss" style={inpStyle} />
          </label>
          <label style={lblStyle}><span style={capStyle}>Describe the channel in words (the deterministic advisor suggests a compatible format and production contract)</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. calm daily stoicism lessons over cinematic nature b-roll" style={{ ...inpStyle, flex: 1 }} />
              <button onClick={suggest} disabled={!concept.trim() || suggesting} style={{ ...btnGhost, opacity: !concept.trim() || suggesting ? 0.5 : 1, whiteSpace: "nowrap" }}>{suggesting ? "Thinking…" : "Suggest"}</button>
            </div>
          </label>
          {clipNote && <div className="glass" style={{ padding: "0.7rem 0.9rem", fontSize: "0.8rem", color: "var(--color-muted)", border: "1px solid var(--color-accent)" }}>{clipNote}</div>}
        </div>
      )}

      {/* STEP 2 — details */}
      {step === 2 && (
        <div style={{ display: "grid", gap: "1rem", maxWidth: 720 }}>
          <div className="glass" style={{ padding: "1rem", display: "grid", gap: "0.9rem" }}>
            {duration?.inputUnit !== "fixed" && duration && (
              <Row label="Target length">
                <input
                  type="number"
                  min={duration.inputUnit === "minutes" ? duration.minimumSeconds / 60 : duration.minimumSeconds}
                  max={duration.inputUnit === "minutes" ? duration.maximumSeconds / 60 : duration.maximumSeconds}
                  step={duration.inputUnit === "minutes" ? duration.stepSeconds / 60 : duration.stepSeconds}
                  value={duration.inputUnit === "minutes" ? lengthMinutes : Math.round(lengthMinutes * 60)}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    setLengthMinutes(clampFamilyEpisodeLengthMinutes(
                      family as FamilyKey,
                      duration.inputUnit === "minutes" ? raw : raw / 60,
                    ));
                  }}
                  style={{ ...inpStyle, width: 90 }}
                />
                <span style={muted}>{duration.inputUnit === "minutes" ? "min" : "sec"} · {formatFamilyDurationContract(family as FamilyKey)} authored range</span>
              </Row>
            )}
            {duration?.inputUnit === "fixed" && family && (
              <Row label="Episode cadence"><span style={muted}>{formatFamilyDurationContract(family)} · {duration.rationale}</span></Row>
            )}
            <Row label="Language"><select value={locale} onChange={(e) => setLocale(e.target.value)} style={selStyle}><option value="en">English</option><option value="es">Spanish</option><option value="de">German</option></select></Row>
            {family === "narrated_stock" && (
              <Row label="Footage theme"><select value={footageTheme} onChange={(e) => setFootageTheme(e.target.value)} style={selStyle}><option value="">Topic-matched (channel DNA)</option><option value="nature">Nature / landscapes / ruins</option></select></Row>
            )}
            {fam?.narrated && (
              <Row label="Voice effect"><select value={voiceFx} onChange={(e) => setVoiceFx(e.target.value)} style={selStyle}><option value="none">None (clean)</option><option value="radio">Old radio (vintage AM)</option></select></Row>
            )}
            {creativeCapabilityOffers
              .filter((capability) => capability.selectionMode === "explicit_opt_in")
              .map((capability) => {
                const selected = Boolean(capabilitySelections[capability.capability]);
                return (
                  <Row key={capability.capability} label={capability.title}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", cursor: "pointer", fontSize: "0.8rem", color: "var(--color-muted)" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setCapabilitySelections((current) => {
                            const next = { ...current };
                            if (checked) next[capability.capability] = capabilityCatalogFingerprint;
                            else delete next[capability.capability];
                            return next;
                          });
                        }}
                      />
                      <span>
                        {dataStorySuggested && capability.capability === "source_attributed_data_story"
                          ? "Advisor recommended this for the described channel. "
                          : ""}
                        {capability.description} {capability.requirements?.join(" ")}
                        {capability.automationAdmission?.autonomous === false
                          ? ` Automatic production remains blocked: ${capability.automationAdmission.remediation ?? "complete its stated admission."}`
                          : ""}
                      </span>
                    </label>
                  </Row>
                );
              })}
            {family === "illustrated_explainer" && (
              <Row label="Fictional AI format">
                <select
                  value={syntheticScenarioProfile}
                  onChange={(event) => setSyntheticScenarioProfile(event.target.value as SyntheticScenarioProfile | "")}
                  style={selStyle}
                >
                  <option value="">Standard illustrated explainer</option>
                  <option value="ai_town">AI runs a fictional town</option>
                  <option value="ai_decision">What would AI do?</option>
                  <option value="ai_pov">AI POV story</option>
                </select>
                {syntheticScenarioProfile && (
                  <div style={{ ...muted, marginTop: "0.4rem" }}>
                    Adds a mandatory “Fictional AI Scenario” opening, an assumptions gate, local scenario-board visuals, and a required Nano Banana thumbnail. It does not simulate or claim real AI results; Google is used only for the final thumbnail image.
                  </div>
                )}
              </Row>
            )}
            {family === "documentary_collage_short" && (
              <>
                <label style={lblStyle}>
                  <span style={capStyle}>External source references (required JSON)</span>
                  <textarea
                    value={sourceReferencesJson}
                    onChange={(e) => setSourceReferencesJson(e.target.value)}
                    rows={5}
                    placeholder={'[{"id":"source:archive","type":"archive","title":"Archive title","citation":"Publisher, date","url":"https://example.org/record"}]'}
                    style={{ ...inpStyle, resize: "vertical", fontFamily: "monospace" }}
                  />
                  <span style={muted}>Every source must be externally reachable with a stable URL.</span>
                </label>
                <label style={lblStyle}>
                  <span style={capStyle}>Claim evidence (required JSON)</span>
                  <textarea
                    value={claimEvidenceJson}
                    onChange={(e) => setClaimEvidenceJson(e.target.value)}
                    rows={6}
                    placeholder={'[{"claimId":"claim:1","sourceId":"source:archive","excerpt":"Exact supporting passage or finding.","locator":"p. 14"}]'}
                    style={{ ...inpStyle, resize: "vertical", fontFamily: "monospace" }}
                  />
                  <span style={muted}>Provide at least one cited excerpt for each of the seven locked narrative beats.</span>
                </label>
              </>
            )}
            <Row label="Series (optional)">
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input value={seriesTitle} onChange={(e) => setSeriesTitle(e.target.value)} placeholder='e.g. "7 Days of Stoic Calm"' style={{ ...inpStyle, width: 220 }} />
                {seriesTitle.trim() && <>
                  <input type="number" min={0} max={100} value={seriesCount} onChange={(e) => setSeriesCount(+e.target.value)} style={{ ...inpStyle, width: 70 }} />
                  <span style={muted}>parts (0 = open)</span>
                </>}
              </div>
            </Row>
            <Row label="Cadence"><select value={cadence} onChange={(e) => setCadence(e.target.value)} style={selStyle}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></Row>
            {(cadence === "weekly" || cadence === "biweekly") && (
              <Row label="Upload days">
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {DOW.map((d, i) => { const on = days.includes(i); return (
                    <button key={i} onClick={() => setDays((p) => on ? p.filter((x) => x !== i) : [...p, i].sort())} style={{ width: 34, height: 30, borderRadius: 7, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--color-border)"}`, background: on ? "var(--color-accent)" : "var(--color-surface)", color: on ? "#0a0a0b" : "var(--color-muted)" }}>{d[0]}</button>); })}
                </div>
              </Row>
            )}
            {supervisedAdmission ? (
              <div className="glass" style={{ padding: "0.75rem 0.85rem", fontSize: "0.8rem", color: "var(--color-muted)", border: "1px solid rgba(124,124,255,0.45)" }}>
                Private-review intake only: no setup spend, validation render, YouTube creation, publishing, cross-posting, or production budget can be authorized here.
              </div>
            ) : (
              <>
                <Row label="Auto-publish"><select value={publishMode} onChange={(e) => { setPublishMode(e.target.value); setApprovedForPublish(false); }} style={selStyle}><option value="draft">Private draft</option><option value="scheduled">Scheduled</option><option value="public">Public</option></select></Row>
                <Row label="One-time setup">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={approveSetupSpend}
                      onChange={(e) => {
                        setApproveSetupSpend(e.target.checked);
                        if (!e.target.checked) { setRunProbe(false); setAutoYoutube(false); }
                      }}
                    />
                    <span style={muted}>authorize up to ${CHANNEL_INCEPTION_SETUP_COST_CEILING_USD.toFixed(2)} for research, identity, art and starter thumbnails</span>
                  </label>
                </Row>
                <Row label="Auto-create YouTube channel">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      disabled={!approveSetupSpend || !normalizeYoutubeChannelName(name)}
                      checked={autoYoutube}
                      onChange={(e) => setAutoYoutube(e.target.checked)}
                    />
                    <span style={muted}>
                      {normalizeYoutubeChannelName(name)
                        ? `create exactly “${normalizeYoutubeChannelName(name)}” as @${suggestYoutubeHandle(name)} (explicit opt-in)`
                        : "enter a channel name first so the exact external identity can be approved"}
                    </span>
                  </label>
                </Row>
                <Row label="Paid validation render">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.84rem", cursor: "pointer" }}>
                    <input type="checkbox" disabled={!approveSetupSpend} checked={runProbe} onChange={(e) => setRunProbe(e.target.checked)} />
                    <span style={muted}>run one bounded private proof · up to ${costAuthority.validationCapUsd.toFixed(2)} extra</span>
                  </label>
                </Row>
                <Row label="Production budget / video"><input type="number" min={fam?.defaultRunBudgetUsd ?? 0.5} max={Math.max(100, fam?.defaultRunBudgetUsd ?? 0.5)} step={0.5} value={budget} onChange={(e) => setBudget(+e.target.value)} style={{ ...inpStyle, width: 90 }} /> <span style={muted}>USD{family === "documentary_collage_short" ? " · native master requires at least $30" : family === "cinematic" ? " · locked Novita chain requires at least $130" : ""}</span></Row>
              </>
            )}
          </div>
          <div className="glass" style={{ padding: "1rem", display: "grid", gap: "0.6rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Advanced — optional modules</div>
            {([["quotes", "Quote cards"], ["captions", "Burned captions"], ["chapters", "Chapter cards"], ["notify", "Telegram notify"], ["crosspost", "Cross-post (TikTok/Reels)"], ["shorts", "Auto Short (9:16, private)"], ["documentaryCandidates", "Find documentary Short candidates (no crop/upload)"]] as [keyof Toggles, string][]).filter(([key]) => !supervisedAdmission || key !== "crosspost").map(([k, lbl]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.84rem", cursor: "pointer" }}>
                <input type="checkbox" checked={toggles[k]} onChange={(e) => setToggles((p) => ({ ...p, [k]: e.target.checked }))} /> {lbl}
              </label>
            ))}
            {family === "cinematic" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.84rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={toggles.visualMatter}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setToggles((current) => ({ ...current, visualMatter: enabled }));
                    setModuleConfig((current) => {
                      const visualMatter = { ...(current.visual_matter ?? {}) };
                      if (enabled) delete visualMatter.enabled;
                      else visualMatter.enabled = false;
                      const next = { ...current };
                      if (Object.keys(visualMatter).length) next.visual_matter = visualMatter;
                      else delete next.visual_matter;
                      return next;
                    });
                  }}
                />
                Visual Matter (mood board, character/settings sheets, storyboard locks)
              </label>
            )}
          </div>
        </div>
      )}

      {/* STEP 3 — review */}
      {step === 3 && fam && (
        <div style={{ display: "grid", gap: "1rem", maxWidth: 760 }}>
          {!fam.available && <div className="glass" style={{ padding: "0.8rem 1rem", border: "1px solid rgba(245,158,11,0.45)", color: "#fbbf24", fontSize: "0.84rem" }}>⚠ {fam.label}: visual engine “{fam.visualEngine}” not built yet — channel will be created as a DRAFT until it ships.</div>}
          {!isFamilyProductionReady(fam.key) && <div className="glass" style={{ padding: "0.8rem 1rem", border: "1px solid rgba(245,158,11,0.45)", color: "#fbbf24", fontSize: "0.84rem" }}>⚠ {familyProductionReadiness(fam.key).blockers.join(" ")}</div>}
          {supervisedAdmission && (
            <div className="glass" style={{ padding: "0.9rem 1rem", border: "1px solid rgba(124,124,255,0.55)", color: "#d7d9ff", display: "grid", gap: "0.45rem", fontSize: "0.84rem" }}>
              <strong>Private-review intake selected</strong>
              <span>This registered route is not automatic production and cannot render, spend, create a YouTube channel, or publish.</span>
              {supervisedAdmission.requiredArtifacts.length > 0 && <span>Required before a separately authorized next stage: {supervisedAdmission.requiredArtifacts.join(" · ")}.</span>}
              {supervisedAdmission.provenance && <span style={{ color: "var(--color-muted)", fontSize: "0.76rem" }}>{supervisedAdmission.provenance}</span>}
              {supervisedAdmission.reviewHref && <Link href={supervisedAdmission.reviewHref} style={{ ...btnGhost, justifySelf: "start" }}>Open private review desk</Link>}
            </div>
          )}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.5rem", fontSize: "0.86rem" }}>
            <SummaryRow k="Niche" v={`${niche?.label}${subcategory ? " · " + subcategory : ""}`} />
            <SummaryRow k="Format" v={fam.label} />
            <SummaryRow k="Visual engine" v={fam.visualEngine} />
            {duration && <SummaryRow k="Episode unit" v={duration.inputUnit === "fixed"
              ? formatFamilyDurationContract(family as FamilyKey)
              : duration.inputUnit === "minutes"
                ? `${lengthMinutes} min · ${formatFamilyDurationContract(family as FamilyKey)} contract`
                : `${Math.round(lengthMinutes * 60)} sec · ${formatFamilyDurationContract(family as FamilyKey)} contract`} />}
            {fam.narrated && <SummaryRow k="Language" v={locale.toUpperCase()} />}
            {fam.narrated && voiceFx !== "none" && <SummaryRow k="Voice effect" v={voiceFx === "radio" ? "Old radio" : voiceFx} />}
            {dataStory && <SummaryRow k="Data story" v="Source-attributed charts only · 3+ named-source numeric sentences required" />}
            {syntheticScenarioProfile && <SummaryRow k="Fictional AI format" v={`${syntheticScenarioProfile === "ai_town" ? "AI runs a fictional town" : syntheticScenarioProfile === "ai_decision" ? "What would AI do?" : "AI POV story"} · disclosure gate + local scenario visuals`} />}
            {seriesTitle.trim() && <SummaryRow k="Series" v={`${seriesTitle.trim()}${seriesCount > 0 ? ` · ${seriesCount} parts` : " · open-ended"}`} />}
            <SummaryRow k="Cadence" v={`${cadence}${(cadence === "weekly" || cadence === "biweekly") && days.length ? " · " + days.map((d) => DOW[d]).join(",") : ""} · ${publishMode}`} />
            {supervisedAdmission ? (
              <SummaryRow k="Authority" v="Private review only · $0 provider spend · no render, YouTube creation, or publishing" />
            ) : (
              <>
                <SummaryRow k="Setup" v={approveSetupSpend ? `Approved · capped at $${CHANNEL_INCEPTION_SETUP_COST_CEILING_USD.toFixed(2)}` : "Plan only · $0 provider spend"} />
                {runProbe && <SummaryRow k="Private validation" v={`Approved separately · capped at $${costAuthority.validationCapUsd.toFixed(2)}`} />}
                <SummaryRow k="Maximum setup + validation" v={`$${costAuthority.combinedSetupAndValidationCapUsd.toFixed(2)}`} />
                <SummaryRow k="Future production videos" v={`$${costAuthority.perVideoProductionBudgetUsd.toFixed(2)} maximum each`} />
              </>
            )}
          </div>
          {!supervisedAdmission && (publishMode !== "draft" || toggles.crosspost) && (
            <label className="glass" style={{ padding: "0.9rem 1rem", display: "flex", alignItems: "flex-start", gap: "0.65rem", fontSize: "0.82rem", cursor: "pointer", border: "1px solid rgba(245,158,11,0.45)" }}>
              <input type="checkbox" checked={approvedForPublish} onChange={(e) => setApprovedForPublish(e.target.checked)} />
              <span>I explicitly approve automatic external publishing for this channel. This includes scheduled/public YouTube uploads and any enabled cross-posting.</span>
            </label>
          )}
          <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.6rem" }}>{supervisedAdmission ? "Proposed family modules (not an executable build)" : `Designed pipeline (${preview.length} modules)`}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
              {preview.map((b, i) => (
                <span key={b + i} style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 6, background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>{b}</span>
              ))}
            </div>
          </div>

          {/* Advanced per-module param editor — tune any module's knobs. */}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.8rem" }}>
            <button onClick={() => setShowAdvanced((s) => !s)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "none", border: "none", color: "var(--color-fg)", cursor: "pointer", font: "inherit", fontSize: "0.8rem", fontWeight: 600, padding: 0 }}>
              <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
              Advanced — tune module parameters
              {Object.keys(paramOverrides).length > 0 && <span style={{ fontSize: "0.66rem", color: "var(--color-accent)" }}>· {Object.keys(paramOverrides).length} edited</span>}
            </button>
            {showAdvanced && (
              <div style={{ display: "grid", gap: "0.9rem" }}>
                {MODULE_CATALOG.filter((m) => preview.includes(m.block)).map((m) => (
                  <div key={m.block} style={{ display: "grid", gap: "0.5rem", paddingBottom: "0.7rem", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{m.label}</span>
                      {m.optional && <span style={{ fontSize: "0.62rem", color: "var(--color-accent)" }}>optional</span>}
                      <span style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>{m.description}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.5rem 1rem" }}>
                      {m.params.map((f) => (
                        <ParamControl key={f.key} field={f}
                          value={paramOverrides[m.block]?.[f.key]}
                          onChange={(v) => setParamOverrides((p) => {
                            const block = { ...(p[m.block] ?? {}) };
                            if (v === "" || v === undefined || v === null) delete block[f.key]; else block[f.key] = v;
                            const next = { ...p };
                            if (Object.keys(block).length) next[m.block] = block; else delete next[m.block];
                            return next;
                          })} />
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: "0.72rem", color: "var(--color-faint)" }}>Blank fields keep the smart default. Numbers are clamped to safe bounds on save.</div>
              </div>
            )}
          </div>

          {/* Pipeline style — per-module presets/knobs (e.g. captions on/off). */}
          <div className="glass" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: "0.85rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Pipeline style</div>
              <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: 2 }}>
                Pick a preset per module and flip toggles — wired into every render. Editable later in Settings.
              </div>
            </div>
            <ModuleConfigSection value={moduleConfig} onChange={setModuleConfig} activeBlockIds={preview} />
          </div>
        </div>
      )}

      {/* nav */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.6rem", maxWidth: 760 }}>
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ ...btnGhost, opacity: step === 0 ? 0.4 : 1 }}>Back</button>
        {step < 3
          ? <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} style={{ ...btnPrimary, opacity: canNext ? 1 : 0.5 }}>Next</button>
          : supervisedAdmission
            ? supervisedAdmission.reviewHref
              ? <Link href={supervisedAdmission.reviewHref} style={btnPrimary}>Open private review desk</Link>
              : <button disabled style={{ ...btnPrimary, opacity: 0.5 }}>Private review package required</button>
            : <button onClick={() => void create(Date.now())} disabled={(publishMode !== "draft" || toggles.crosspost) && !approvedForPublish} style={{ ...btnPrimary, opacity: (publishMode !== "draft" || toggles.crosspost) && !approvedForPublish ? 0.5 : 1 }}>{approveSetupSpend ? "Build channel" : "Save channel plan"}</button>}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
    <span style={{ fontSize: "0.84rem", fontWeight: 500 }}>{label}</span><div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>{children}</div></div>;
}
function ParamControl({ field, value, onChange }: { field: ParamField; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span style={{ fontSize: "0.74rem", color: "var(--color-muted)" }}>{field.label}</span>;
  if (field.type === "toggle") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", cursor: "pointer" }} title={field.help}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : undefined)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
        {label}
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={{ ...selStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }}>
          <option value="">Default</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === "number") {
    return (
      <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
        {label}
        <input type="number" min={field.min} max={field.max} step={field.step}
          value={value === undefined || value === null ? "" : (value as number)}
          placeholder="default"
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          style={{ ...inpStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }} />
      </label>
    );
  }
  return (
    <label style={{ display: "grid", gap: "0.25rem" }} title={field.help}>
      {label}
      <input value={(value as string) ?? ""} placeholder="default"
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{ ...inpStyle, fontSize: "0.8rem", padding: "0.4rem 0.55rem" }} />
    </label>
  );
}
function SummaryRow({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><span style={{ color: "var(--color-muted)" }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{v}</span></div>;
}

const inpStyle: CSSProperties = { padding: "0.6rem 0.8rem", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-fg)", font: "inherit", fontSize: "0.9rem" };
const selStyle: CSSProperties = { ...inpStyle, cursor: "pointer" };
const lblStyle: CSSProperties = { display: "grid", gap: "0.4rem" };
const capStyle: CSSProperties = { fontSize: "0.78rem", color: "var(--color-muted)" };
const muted: CSSProperties = { fontSize: "0.8rem", color: "var(--color-muted)" };
const btnPrimary: CSSProperties = { background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10, padding: "0.6rem 1.4rem", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer" };
const btnGhost: CSSProperties = { background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.6rem 1.4rem", fontSize: "0.9rem", cursor: "pointer" };
