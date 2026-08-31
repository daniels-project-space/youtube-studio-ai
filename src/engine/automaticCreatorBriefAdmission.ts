/**
 * Reassert concept-sensitive automatic-creator admission for durable channels.
 *
 * A channel can remain active after catalog rules become more precise. This
 * small, provider-free gate keeps cadence and direct runs from treating the
 * family-level automatic flag as authority for a specific factual, child, or
 * otherwise supervised Brief. It deliberately reuses the exact preflight used
 * at channel creation rather than maintaining a second set of heuristics.
 */
import {
  assertPersistedProgramBriefIdentity,
  briefToFormatSelectionInput,
} from "@/engine/channelProgramBrief";
import { formatPreflight } from "@/engine/creative/selectFormat";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";

export interface AutomaticCreatorBriefAdmissionInput {
  readonly family?: unknown;
  readonly identity?: unknown;
}

export interface AutomaticCreatorBriefAdmission {
  /** Whether this is a currently certified automatic family. */
  readonly applies: boolean;
  /** True only when the persisted Brief is still valid for automatic work. */
  readonly automatic: boolean;
  readonly reason: string;
  readonly sourceRequirements: readonly string[];
}

function knownFamily(value: unknown): FamilyKey | undefined {
  return typeof value === "string" && (FAMILY_KEYS as readonly string[]).includes(value)
    ? value as FamilyKey
    : undefined;
}

/**
 * This gate is intentionally narrower than live-provider readiness: it only
 * seals what the channel is allowed to make. Provider health, route receipt,
 * and pipeline validation retain their independent pre-spend authorities.
 */
export function automaticCreatorBriefAdmission(
  input: AutomaticCreatorBriefAdmissionInput,
): AutomaticCreatorBriefAdmission {
  const family = knownFamily(input.family);
  if (!family || !certifiedFamilyAdmission(family).automatic) {
    return {
      applies: false,
      automatic: true,
      reason: "concept-sensitive automatic creator admission does not apply to this route",
      sourceRequirements: [],
    };
  }

  try {
    const programBrief = assertPersistedProgramBriefIdentity(input.identity, {
      context: "automatic creator execution channel identity",
      expectedFamily: family,
      requireProgramBrief: true,
    });
    if (!programBrief) throw new Error("canonical channel program brief is missing");
    const preflight = formatPreflight(family, briefToFormatSelectionInput(programBrief));
    if (!preflight.productionReady) {
      const detail = [
        ...preflight.missingRequirements,
        ...preflight.runtimeBlockers,
      ];
      return {
        applies: true,
        automatic: false,
        reason: detail.length
          ? `automatic creator Brief is no longer admitted: ${[...new Set(detail)].join("; ")}`
          : "automatic creator Brief is no longer admitted; repair its sealed route before retrying",
        sourceRequirements: preflight.sourceRequirements,
      };
    }
    return {
      applies: true,
      automatic: true,
      reason: "canonical creator Brief remains admitted for automatic execution",
      sourceRequirements: [],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "its canonical Brief could not be read";
    return {
      applies: true,
      automatic: false,
      reason: `automatic creator Brief must be repaired before execution: ${detail}`,
      sourceRequirements: [],
    };
  }
}
