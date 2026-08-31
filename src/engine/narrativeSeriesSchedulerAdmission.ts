import { z } from "zod";

import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  channelProgramBriefFingerprint,
  parseChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import { assertNarrativeSeriesPlan } from "@/engine/narrativeSeriesIntelligence";
import {
  assertNarrativeSeriesRunAdmission,
  createNarrativeSeriesRunSelector,
  type NarrativeSeriesRunSelector,
} from "@/lib/narrativeSeriesRunAdmission";

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

const NarrativeSeriesPlanPointerSchema = z.object({
  version: z.literal("narrative-series-intelligence/v1"),
  fingerprint: FingerprintSchema,
  seriesIdentity: z.string().min(1).max(720),
  researchEvidenceFingerprint: FingerprintSchema,
  planningHorizonEpisodes: z.number().int().min(1).max(24),
}).strict();

export type NarrativeSeriesSchedulerRequirement =
  | Readonly<{ status: "not_serialized" }>
  | Readonly<{ status: "blocked"; reason: string }>
  | Readonly<{
      status: "plan_required";
      planFingerprint: string;
      ownerId: string;
      channelId: string;
      identity: unknown;
    }>;

export type NarrativeSeriesSchedulerAdmission =
  | Readonly<{ status: "not_serialized" }>
  | Readonly<{ status: "blocked"; reason: string }>
  | Readonly<{ status: "eligible"; selector: NarrativeSeriesRunSelector }>;

function identityRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Decide whether a channel needs the route-owned narrative scheduler path
 * without reading a plan, creating a run, or accessing a provider.  Ordinary
 * channels preserve their existing calendar behavior.  A serialized channel
 * without the immutable inception pointer is deliberately blocked rather than
 * falling back to a generic planner topic.
 */
export function narrativeSeriesSchedulerRequirement(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly identity: unknown;
}): NarrativeSeriesSchedulerRequirement {
  const identity = identityRecord(input.identity);
  if (!identity?.programBrief) return Object.freeze({ status: "not_serialized" as const });

  let brief: ReturnType<typeof parseChannelProgramBrief>;
  try {
    brief = parseChannelProgramBrief(identity.programBrief);
  } catch (error) {
    return Object.freeze({
      status: "blocked" as const,
      reason: `serialized-program brief is invalid: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (!brief.serializedProgram) {
    return identity.narrativeSeriesPlan === undefined
      ? Object.freeze({ status: "not_serialized" as const })
      : Object.freeze({
          status: "blocked" as const,
          reason: "non-serialized channel retains a narrative series plan pointer",
        });
  }
  let pointer: z.infer<typeof NarrativeSeriesPlanPointerSchema>;
  try {
    pointer = NarrativeSeriesPlanPointerSchema.parse(identity.narrativeSeriesPlan);
  } catch (error) {
    return Object.freeze({
      status: "blocked" as const,
      reason: `serialized channel needs its immutable narrative horizon: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return Object.freeze({
    status: "plan_required" as const,
    planFingerprint: pointer.fingerprint,
    ownerId: input.ownerId,
    channelId: input.channelId,
    identity: input.identity,
  });
}

/**
 * Re-check the full immutable horizon after it is read owner-scoped from
 * storage.  This is intentionally independent of the scheduler so both an
 * automatic cadence and a future explicit series-start action use the same
 * no-fallback contract.
 */
export function admitNarrativeSeriesSchedulerRun(input: {
  readonly requirement: NarrativeSeriesSchedulerRequirement;
  readonly plan: unknown;
}): NarrativeSeriesSchedulerAdmission {
  if (input.requirement.status === "not_serialized") return input.requirement;
  if (input.requirement.status === "blocked") return input.requirement;
  try {
    const identity = identityRecord(input.requirement.identity);
    if (!identity) throw new Error("channel identity is missing");
    const brief = parseChannelProgramBrief(identity.programBrief);
    const route = parseChannelProgramRoute(identity.programRoute);
    const routeSeed = channelProgramRouteRunSeed({ route, programBrief: brief });
    const pointer = NarrativeSeriesPlanPointerSchema.parse(identity.narrativeSeriesPlan);
    const plan = assertNarrativeSeriesPlan(input.plan);
    if (
      plan.fingerprint !== input.requirement.planFingerprint
      || plan.fingerprint !== pointer.fingerprint
      || plan.seriesIdentity !== pointer.seriesIdentity
    ) {
      throw new Error("stored narrative horizon does not match the channel identity pointer");
    }
    const selector = createNarrativeSeriesRunSelector({
      version: "narrative-series-run-selector/v1",
      seriesPlanFingerprint: plan.fingerprint,
      seriesIdentity: plan.seriesIdentity,
      routeFingerprint: route.fingerprint,
      routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(routeSeed),
      programBriefFingerprint: channelProgramBriefFingerprint(brief),
      acceptedCharacterAdapters: [],
    });
    assertNarrativeSeriesRunAdmission({
      selector,
      plan,
      ownerId: input.requirement.ownerId,
      channelId: input.requirement.channelId,
      routeSeed,
    });
    return Object.freeze({ status: "eligible" as const, selector });
  } catch (error) {
    return Object.freeze({
      status: "blocked" as const,
      reason: `narrative series cadence is not bound to its current immutable route: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
