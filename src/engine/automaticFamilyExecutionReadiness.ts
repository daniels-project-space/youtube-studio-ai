import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import { hasNanoBanana } from "@/lib/banana";
import { hasAnyFootageProvider } from "@/lib/footage";
import { hasMusicProvider } from "@/lib/music";
import { hasMotionComic } from "@/lib/motionComic";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";
import { hasTopicraft } from "@/lib/topicraft";
import { hasFishKey } from "@/lib/tts";
import { hasNonGoogleVisionKey } from "@/lib/vision";
import { hasWhiteboardSync } from "@/lib/whiteboardSync";

/**
 * Static route admission proves a family has an allowed design. This small
 * runtime companion proves that an automatically admitted self-contained
 * renderer can actually start after secrets are hydrated, before channel
 * research, artwork, or provider work begins.
 */
export interface AutomaticFamilyExecutionReadiness {
  readonly family: FamilyKey;
  readonly ready: boolean;
  /** Which verified live foundation this assessment covers. */
  readonly scope:
    | "live_renderer_stack"
    | "universal_release_foundation"
    | "live_pipeline_stack";
  readonly blockers: readonly string[];
}

/**
 * Admission form for durable channel runs. It deliberately applies only to
 * families which the catalog has already certified as automatic; supervised
 * and malformed routes remain the responsibility of their route-specific
 * admission fences rather than being silently reclassified here.
 */
export interface AutomaticFamilyExecutionReadinessAdmission {
  readonly applies: boolean;
  readonly automatic: boolean;
  readonly reason: string;
  readonly assessment?: AutomaticFamilyExecutionReadiness;
}

export interface AutomaticFamilyExecutionCapabilityReader {
  readonly whiteboardReady: () => boolean;
  readonly comicReady: () => boolean;
  /** Eligibility for the sealed, thumbnail-only Nano Banana route. */
  readonly thumbnailRouteReady: () => boolean;
  /** Final production visual QA must never silently fall back to Gemini. */
  readonly nonGoogleVisionReady: () => boolean;
  readonly topicPlannerReady: () => boolean;
  readonly narrationReady: () => boolean;
  readonly footageReady: () => boolean;
  readonly musicReady: () => boolean;
}

const LIVE_CAPABILITIES: AutomaticFamilyExecutionCapabilityReader = {
  // The sealed self-contained plan still needs the non-Gemini planner during
  // the first run, so do not weaken these to renderer-only checks.
  // Automatic channel inception seals and wires an ElevenLabs voice casting
  // for Whiteboard before its first production run. Check that exact path,
  // rather than the reusable engine's manual Fish fallback, so the creator
  // cannot advertise an automatic setup that will fail during inception.
  whiteboardReady: () => hasWhiteboardSync({
    requiresStoryboard: true,
    ttsProvider: "elevenlabs",
  }) && hasNovitaRenderFarmConfig(),
  comicReady: () => hasMotionComic({ requiresStoryboard: true }),
  thumbnailRouteReady: () => hasNanoBanana(),
  nonGoogleVisionReady: () => hasNonGoogleVisionKey(),
  topicPlannerReady: () => hasTopicraft(),
  narrationReady: () => hasFishKey(),
  footageReady: () => hasAnyFootageProvider(),
  musicReady: () => hasMusicProvider(),
};

const TOPIC_AND_NARRATION_FAMILIES = new Set<FamilyKey>([
  "narrated_stock", "sleep", "shorts", "illustrated_explainer",
]);
const STOCK_FOOTAGE_FAMILIES = new Set<FamilyKey>([
  "narrated_stock", "sleep", "shorts",
]);
const MUSIC_FAMILIES = new Set<FamilyKey>([
  "narrated_stock", "sleep", "shorts", "whiteboard", "quizyear", "illustrated_explainer",
]);

function knownFamily(value: unknown): FamilyKey | undefined {
  return typeof value === "string" && (FAMILY_KEYS as readonly string[]).includes(value)
    ? value as FamilyKey
    : undefined;
}

/** Whether a durable run must re-check the live automatic stack after secret hydration. */
export function requiresAutomaticFamilyExecutionReadiness(family: unknown): boolean {
  const resolved = knownFamily(family);
  return resolved !== undefined && certifiedFamilyAdmission(resolved).automatic;
}

export function assessAutomaticFamilyExecutionReadiness(
  family: FamilyKey,
  capabilities: AutomaticFamilyExecutionCapabilityReader = LIVE_CAPABILITIES,
): AutomaticFamilyExecutionReadiness {
  const blockers: string[] = [];
  if (!capabilities.thumbnailRouteReady()) {
    blockers.push(
      "automatic release requires the sealed Nano Banana thumbnail route to be eligible",
    );
  }
  if (!capabilities.nonGoogleVisionReady()) {
    blockers.push(
      "automatic release requires a configured non-Google final visual-QA provider",
    );
  }
  if (TOPIC_AND_NARRATION_FAMILIES.has(family) && !capabilities.topicPlannerReady()) {
    blockers.push("automatic execution requires the non-Gemini topic-planning provider");
  }
  if (TOPIC_AND_NARRATION_FAMILIES.has(family) && !capabilities.narrationReady()) {
    blockers.push("automatic execution requires the Fish narration provider");
  }
  if (STOCK_FOOTAGE_FAMILIES.has(family) && !capabilities.footageReady()) {
    blockers.push("automatic execution requires at least one configured stock-footage provider");
  }
  if (MUSIC_FAMILIES.has(family) && !capabilities.musicReady()) {
    blockers.push("automatic execution requires a configured Mureka or Suno music provider");
  }
  if (family === "whiteboard" && !capabilities.whiteboardReady()) {
    blockers.push(
      "whiteboard automatic execution requires its non-Gemini storyboard planner, sealed ElevenLabs narration, and attested Novita image-render capability",
    );
  }
  if (family === "comic" && !capabilities.comicReady()) {
    blockers.push(
      "comic automatic execution requires its non-Gemini storyboard planner, ElevenLabs narration, and attested Novita image-render capability",
    );
  }
  if (blockers.length) {
    return {
      family,
      ready: false,
      scope: family === "whiteboard" || family === "comic"
        ? "live_renderer_stack"
        : TOPIC_AND_NARRATION_FAMILIES.has(family) || STOCK_FOOTAGE_FAMILIES.has(family) || MUSIC_FAMILIES.has(family)
          ? "live_pipeline_stack"
          : "universal_release_foundation",
      blockers,
    };
  }
  return {
    family,
    ready: true,
    scope: family === "whiteboard" || family === "comic"
      ? "live_renderer_stack"
      : TOPIC_AND_NARRATION_FAMILIES.has(family) || STOCK_FOOTAGE_FAMILIES.has(family) || MUSIC_FAMILIES.has(family)
        ? "live_pipeline_stack"
        : "universal_release_foundation",
    blockers: [],
  };
}

/**
 * Re-evaluate the live stack for an existing automatic channel before it can
 * lease a scheduled run. This catches credential/runtime drift after channel
 * setup and returns a manual gate rather than allowing a late paid-stage
 * failure. The caller must hydrate server-only secrets before using it.
 */
export function automaticFamilyExecutionReadinessAdmission(
  family: unknown,
  capabilities: AutomaticFamilyExecutionCapabilityReader = LIVE_CAPABILITIES,
): AutomaticFamilyExecutionReadinessAdmission {
  const resolved = knownFamily(family);
  if (!resolved || !certifiedFamilyAdmission(resolved).automatic) {
    return {
      applies: false,
      automatic: true,
      reason: "live automatic execution readiness does not apply to this route",
    };
  }
  const assessment = assessAutomaticFamilyExecutionReadiness(resolved, capabilities);
  return assessment.ready
    ? {
        applies: true,
        automatic: true,
        reason: "automatic live execution stack is ready",
        assessment,
      }
    : {
        applies: true,
        automatic: false,
        reason: assessment.blockers.join("; "),
        assessment,
      };
}

/** Fail before any inception provider action if a live automatic renderer is unavailable. */
export function assertAutomaticFamilyExecutionReadiness(family: FamilyKey): void {
  const assessment = assessAutomaticFamilyExecutionReadiness(family);
  if (!assessment.ready) {
    throw new Error(
      `${family} cannot start automatic channel inception: ${assessment.blockers.join("; ")}`,
    );
  }
}
