import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { resolveTitleProfile, type TitleProfileId } from "@/lib/metacraft";

/**
 * The automatic video plan is the small, immutable control-plane receipt that
 * turns the old "smart" hints into one deterministic decision before any paid
 * block runs.  It is deliberately provider-neutral: provider routing remains
 * in AutomaticProviderPlan, while this receipt owns format, frame intent and
 * artifact ownership for the whole video.
 */
export const AUTOMATIC_VIDEO_PLAN_VERSION = "automatic-video-plan/v1" as const;

export type AutomaticFrameStrategy = {
  discoverySurface: "search" | "browse" | "hybrid";
  audienceIntent: "answer" | "reveal" | "experience";
  tone: "calm" | "direct" | "intriguing" | "playful" | "cinematic";
  format: "long_form" | "short_form" | "serialized" | "music_loop";
  scriptEvidenceRequired: true;
  openingWindowSec: 30;
};

export type AutomaticVideoPlan = {
  version: typeof AUTOMATIC_VIDEO_PLAN_VERSION;
  mode: "fully_automatic";
  /** The exact compiled module order. Duplicate producers are not allowed. */
  moduleIds: readonly string[];
  titleProfile: TitleProfileId;
  frameStrategy: AutomaticFrameStrategy;
  /** Stable input identity used by the baseline/scorecard comparison. */
  inputContractFingerprint: string;
  artifactPolicy: {
    ownership: "content_addressed_no_overwrite";
    supersession: "explicit_revision_only";
    release: "private_first_reversible";
  };
  retryPolicy: {
    resumeCompletedStages: true;
    retryAcceptedPaidWork: false;
    maxOrchestratorAttempts: 2;
  };
  fingerprint: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function frameStrategyFor(args: {
  titleProfile: TitleProfileId;
  family?: string;
  niche?: string;
}): AutomaticFrameStrategy {
  const context = `${args.family ?? ""} ${args.niche ?? ""}`.toLowerCase();
  const music = args.titleProfile === "music_loop" || /lofi|ambient|sleep|study|music/.test(context);
  const serialized = args.titleProfile === "serialized_lore" || /lore|series|serialized|canon/.test(context);
  const short = args.titleProfile === "short_form" || /shorts|short_form/.test(context);
  const discoverySurface = args.titleProfile === "searchable_long" || args.titleProfile === "children_quiz"
    ? "search"
    : args.titleProfile === "motivational" || args.titleProfile === "short_form"
      ? "browse"
      : "hybrid";
  const audienceIntent = music ? "experience" : args.titleProfile === "motivational" ? "reveal" : "answer";
  const tone = music ? "calm" : serialized ? "cinematic" : args.titleProfile === "motivational" ? "intriguing" : short ? "playful" : "direct";
  return {
    discoverySurface,
    audienceIntent,
    tone,
    format: music ? "music_loop" : serialized ? "serialized" : short ? "short_form" : "long_form",
    scriptEvidenceRequired: true,
    openingWindowSec: 30,
  };
}

export function createAutomaticVideoPlan(input: {
  moduleIds: readonly string[];
  family?: string;
  contentLane?: string;
  niche?: string;
  titleProfile?: string;
}): AutomaticVideoPlan {
  const normalizedModuleIds = input.moduleIds.map(clean).filter(Boolean);
  if (new Set(normalizedModuleIds).size !== normalizedModuleIds.length) {
    throw new Error("automatic video plan module list is invalid: duplicate producer");
  }
  const moduleIds = normalizedModuleIds;
  if (moduleIds.length === 0) throw new Error("automatic video plan requires compiled modules");
  if (moduleIds.some((id) => /[\u0000\n\r]/.test(id))) throw new Error("automatic video plan module id is invalid");
  const titleProfile = resolveTitleProfile(input.titleProfile, {
    family: input.family,
    contentLane: input.contentLane,
    niche: input.niche,
  });
  const frameStrategy = frameStrategyFor({ titleProfile, family: input.family, niche: input.niche });
  const inputContract = {
    version: AUTOMATIC_VIDEO_PLAN_VERSION,
    moduleIds,
    family: clean(input.family),
    contentLane: clean(input.contentLane),
    niche: clean(input.niche),
    titleProfile,
    frameStrategy,
  };
  const body = {
    version: AUTOMATIC_VIDEO_PLAN_VERSION,
    mode: "fully_automatic" as const,
    moduleIds,
    titleProfile,
    frameStrategy,
    inputContractFingerprint: sha256Hex(canonicalJson(inputContract)),
    artifactPolicy: {
      ownership: "content_addressed_no_overwrite" as const,
      supersession: "explicit_revision_only" as const,
      release: "private_first_reversible" as const,
    },
    retryPolicy: {
      resumeCompletedStages: true as const,
      retryAcceptedPaidWork: false as const,
      maxOrchestratorAttempts: 2 as const,
    },
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export function assertAutomaticVideoPlan(value: unknown): AutomaticVideoPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("automatic video plan is invalid");
  const plan = value as AutomaticVideoPlan;
  if (plan.version !== AUTOMATIC_VIDEO_PLAN_VERSION || plan.mode !== "fully_automatic") throw new Error("automatic video plan version/mode is invalid");
  if (!Array.isArray(plan.moduleIds) || plan.moduleIds.length === 0 || new Set(plan.moduleIds).size !== plan.moduleIds.length) {
    throw new Error("automatic video plan module list is invalid");
  }
  if (plan.frameStrategy?.scriptEvidenceRequired !== true || plan.frameStrategy?.openingWindowSec !== 30) {
    throw new Error("automatic video plan frame contract is invalid");
  }
  if (plan.artifactPolicy?.ownership !== "content_addressed_no_overwrite" || plan.artifactPolicy?.supersession !== "explicit_revision_only") {
    throw new Error("automatic video plan artifact policy is invalid");
  }
  if (plan.retryPolicy?.resumeCompletedStages !== true || plan.retryPolicy?.retryAcceptedPaidWork !== false) {
    throw new Error("automatic video plan retry policy is invalid");
  }
  const { fingerprint, ...body } = plan;
  if (typeof fingerprint !== "string" || fingerprint !== sha256Hex(canonicalJson(body))) {
    throw new Error("automatic video plan fingerprint mismatch");
  }
  return plan;
}
