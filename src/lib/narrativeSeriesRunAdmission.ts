import { z } from "zod";

import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertNarrativeSeriesPlan,
  CharacterLoRARegistryEntrySchema,
  type NarrativeSeriesPlan,
} from "@/engine/narrativeSeriesIntelligence";
import { canonicalJson } from "@/lib/canonicalJson";
import { serializedProgramEpisodeIdentity } from "@/lib/serializedProgramEpisode";
import { sha256Hex } from "@/lib/sha256";

/**
 * The selector is deliberately smaller than the series plan. A run snapshot
 * carries only immutable identifiers and reloads the owner-scoped plan from
 * durable storage; it never embeds future episode prose or character data in
 * a Trigger payload.
 */
export const NARRATIVE_SERIES_RUN_SELECTOR_VERSION = "narrative-series-run-selector/v1" as const;
export const NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY = "narrativeSeriesRunSelector" as const;
export const NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK = "narrative_series_visual_controls" as const;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

const NarrativeSeriesAcceptedCharacterAdapterSelectorSchema = z.object({
  characterId: z.string().min(1).max(160),
  characterSpecFingerprint: FingerprintSchema,
  /** Fingerprint of an already accepted immutable registry entry, never a training request. */
  registryIdentity: FingerprintSchema,
}).strict();

const NarrativeSeriesRunSelectorContentObjectSchema = z.object({
  version: z.literal(NARRATIVE_SERIES_RUN_SELECTOR_VERSION),
  seriesPlanFingerprint: FingerprintSchema,
  seriesIdentity: z.string().min(1).max(720),
  routeFingerprint: FingerprintSchema,
  routeRunSeedFingerprint: FingerprintSchema,
  programBriefFingerprint: FingerprintSchema,
  acceptedCharacterAdapters: z.array(NarrativeSeriesAcceptedCharacterAdapterSelectorSchema).max(32).default([]),
}).strict();

function assertUniqueAcceptedCharacterAdapters(
  value: { readonly acceptedCharacterAdapters?: readonly NarrativeSeriesAcceptedCharacterAdapterSelector[] },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const adapter of value.acceptedCharacterAdapters ?? []) {
    const identity = `${adapter.characterId}\u0000${adapter.characterSpecFingerprint}`;
    if (seen.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedCharacterAdapters"],
        message: "a narrative series selector may name one accepted adapter per character specification",
      });
      return;
    }
    seen.add(identity);
  }
}

const NarrativeSeriesRunSelectorContentSchema = NarrativeSeriesRunSelectorContentObjectSchema
  .superRefine(assertUniqueAcceptedCharacterAdapters);

export const NarrativeSeriesRunSelectorSchema = NarrativeSeriesRunSelectorContentObjectSchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine(assertUniqueAcceptedCharacterAdapters);

export type NarrativeSeriesRunSelector = z.infer<typeof NarrativeSeriesRunSelectorSchema>;
export type NarrativeSeriesAcceptedCharacterAdapterSelector =
  z.infer<typeof NarrativeSeriesAcceptedCharacterAdapterSelectorSchema>;

function selectorContent(selector: NarrativeSeriesRunSelector) {
  const { fingerprint: _fingerprint, ...content } = selector;
  void _fingerprint;
  return content;
}

export function narrativeSeriesRunSelectorFingerprintForContent(
  value: z.input<typeof NarrativeSeriesRunSelectorContentSchema>,
): string {
  return sha256Hex(canonicalJson(NarrativeSeriesRunSelectorContentSchema.parse(value)));
}

export function createNarrativeSeriesRunSelector(
  value: z.input<typeof NarrativeSeriesRunSelectorContentSchema>,
): NarrativeSeriesRunSelector {
  const content = NarrativeSeriesRunSelectorContentSchema.parse(value);
  return Object.freeze(NarrativeSeriesRunSelectorSchema.parse({
    ...content,
    fingerprint: narrativeSeriesRunSelectorFingerprintForContent(content),
  }));
}

export function parseNarrativeSeriesRunSelector(value: unknown): NarrativeSeriesRunSelector {
  const selector = NarrativeSeriesRunSelectorSchema.parse(value);
  if (selector.fingerprint !== narrativeSeriesRunSelectorFingerprintForContent(selectorContent(selector))) {
    throw new Error("narrative series run selector fingerprint does not match its immutable content");
  }
  return Object.freeze(selector);
}

/** Parse the episode-local subset emitted by narrative_series_visual_controls. */
export function parseNarrativeSeriesAcceptedCharacterAdapters(
  value: unknown,
): readonly NarrativeSeriesAcceptedCharacterAdapterSelector[] {
  const adapters = z.array(NarrativeSeriesAcceptedCharacterAdapterSelectorSchema).max(32).parse(value);
  const seen = new Set<string>();
  for (const adapter of adapters) {
    const identity = `${adapter.characterId}\u0000${adapter.characterSpecFingerprint}`;
    if (seen.has(identity)) {
      throw new Error("narrative series episode character adapters contain a duplicate character specification");
    }
    seen.add(identity);
  }
  return Object.freeze(adapters);
}

export interface NarrativeSeriesRunAdmission {
  readonly selector: NarrativeSeriesRunSelector;
  readonly plan: NarrativeSeriesPlan;
  readonly route: ChannelProgramRouteRunSeed;
}

function assertOwnerChannelBinding(input: {
  readonly plan: NarrativeSeriesPlan;
  readonly ownerId: string;
  readonly channelId: string;
}): void {
  if (input.plan.accountId !== input.ownerId || input.plan.channelId !== input.channelId) {
    throw new Error("narrative series plan is not bound to this owner and channel");
  }
}

/**
 * Validate one immutable plan against the exact frozen Program Route seed.
 * This works for a fresh admission and a resume: the latter never needs to
 * substitute the mutable current channel brief into its frozen selector.
 */
export function assertNarrativeSeriesRunAdmission(input: {
  readonly selector: unknown;
  readonly plan: unknown;
  readonly ownerId: string;
  readonly channelId: string;
  readonly routeSeed: unknown;
}): NarrativeSeriesRunAdmission {
  const selector = parseNarrativeSeriesRunSelector(input.selector);
  const plan = assertNarrativeSeriesPlan(input.plan);
  const route = parseChannelProgramRouteRunSeed(input.routeSeed);
  const serialIdentity = serializedProgramEpisodeIdentity(route);
  if (!route.serializedProgram || !serialIdentity) {
    throw new Error("narrative series selector requires a frozen serialized_program/v1 route");
  }
  assertOwnerChannelBinding({ plan, ownerId: input.ownerId, channelId: input.channelId });
  const routeRunSeedFingerprint = channelProgramRouteRunSeedFingerprint(route);
  if (
    selector.seriesPlanFingerprint !== plan.fingerprint ||
    selector.seriesIdentity !== plan.seriesIdentity ||
    selector.seriesIdentity !== serialIdentity.value ||
    selector.routeFingerprint !== route.routeFingerprint ||
    selector.routeRunSeedFingerprint !== routeRunSeedFingerprint ||
    selector.programBriefFingerprint !== route.programBriefFingerprint ||
    selector.programBriefFingerprint !== plan.programBriefFingerprint
  ) {
    throw new Error("narrative series selector does not match the immutable plan and frozen Program Route");
  }
  if (
    plan.seriesTitle !== route.serializedProgram.seriesTitle ||
    plan.knownSeriesEpisodeCount !== route.serializedProgram.seriesCount
  ) {
    throw new Error("narrative series plan does not match the frozen serialized-program title or episode limit");
  }
  const plannedCharacterIds = new Set(
    plan.episodes.flatMap((episode) => episode.recurringCharacterIds),
  );
  for (const adapter of selector.acceptedCharacterAdapters) {
    if (!plannedCharacterIds.has(adapter.characterId)) {
      throw new Error("narrative series selector names an accepted character adapter outside its immutable plan");
    }
  }
  return Object.freeze({ selector, plan, route });
}

/** The only series data frozen into a PipelineInvocationSnapshot. */
export function narrativeSeriesRunAdmissionSeed(
  admission: NarrativeSeriesRunAdmission,
): Readonly<Record<typeof NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY, NarrativeSeriesRunSelector>> {
  return Object.freeze({
    [NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY]: admission.selector,
  });
}

/**
 * A selected planned narrative run cannot be claimed through generic calendar
 * or render-group topic shortcuts. Those paths have no immutable episode
 * number/receipt and would bypass the serial reservation transaction.
 */
export function assertNarrativeSeriesNoGenericTopicFastPath(input: {
  readonly selector: unknown | undefined;
  readonly plannedTopic: unknown;
  readonly reuseTopic: unknown;
}): void {
  if (input.selector === undefined) return;
  parseNarrativeSeriesRunSelector(input.selector);
  if (typeof input.plannedTopic === "string" && input.plannedTopic.trim()) {
    throw new Error(
      "narrative series selector owns topic admission; generic plannedTopic cannot bypass its serial episode receipt",
    );
  }
  if (typeof input.reuseTopic === "string" && input.reuseTopic.trim()) {
    throw new Error(
      "narrative series selector owns topic admission; generic reuseTopic cannot bypass its serial episode receipt",
    );
  }
}

/** A fresh selected series run is deliberately not sourced from contentPlan. */
export function assertNarrativeSeriesNoGenericSchedule(input: {
  readonly selector: unknown | undefined;
  readonly scheduledPlan: unknown | undefined;
  readonly reuse: unknown | undefined;
}): void {
  if (input.selector === undefined) return;
  parseNarrativeSeriesRunSelector(input.selector);
  if (input.scheduledPlan !== undefined) {
    throw new Error("narrative series selector cannot be combined with a generic content-plan schedule");
  }
  if (input.reuse !== undefined) {
    throw new Error("narrative series selector cannot be combined with generic render-group reuse");
  }
}

/**
 * A control bridge is intentionally latent until a future route is both
 * serialized and cinematic. Registering the block never turns a family on.
 */
export function assertNarrativeSeriesVisualControlComposition(input: {
  readonly selector: unknown | undefined;
  readonly routeSeed: unknown | undefined;
  readonly contentLaneKey: string;
  readonly orderedBlocks: readonly string[];
}): void {
  const controlCount = input.orderedBlocks
    .filter((block) => block === NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK)
    .length;
  if (input.selector === undefined) {
    if (controlCount) {
      throw new Error("narrative visual controls require an immutable narrative series selector");
    }
    return;
  }
  parseNarrativeSeriesRunSelector(input.selector);
  if (input.routeSeed === undefined) {
    throw new Error("narrative series visual controls require a frozen Program Route seed");
  }
  const route = parseChannelProgramRouteRunSeed(input.routeSeed);
  if (!route.serializedProgram) {
    throw new Error("narrative series visual controls require a serialized_program/v1 route");
  }
  if (route.contentLaneKey !== input.contentLaneKey) {
    throw new Error("narrative series visual controls content lane does not match the frozen Program Route");
  }
  if (input.contentLaneKey !== "cinematic_ai") {
    if (controlCount) {
      throw new Error("narrative series visual controls are only compatible with the cinematic_ai lane");
    }
    return;
  }
  const required = [
    "serialized_program_episode_context",
    "story_spine",
    "episode_graph",
    NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK,
    "visual_matter",
  ] as const;
  const positions = new Map<string, number>();
  for (const block of required) {
    const matches = input.orderedBlocks
      .map((candidate, index) => candidate === block ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1) {
      throw new Error(
        `narrative cinematic series requires exactly one ${block} in its visual-control composition`,
      );
    }
    positions.set(block, matches[0]!);
  }
  if (required.some((block, index) =>
    index > 0 && (positions.get(required[index - 1]!) ?? -1) >= (positions.get(block) ?? Number.MAX_SAFE_INTEGER),
  )) {
    throw new Error(
      "narrative cinematic series requires serialized_program_episode_context < story_spine < episode_graph < narrative_series_visual_controls < visual_matter",
    );
  }
}

/**
 * Checks only accepted, immutable adapter rows. The runtime never receives a
 * training request and this helper intentionally has no training side effect.
 */
export function assertNarrativeSeriesAcceptedCharacterAdapters(input: {
  readonly admission: NarrativeSeriesRunAdmission;
  readonly entries: readonly unknown[];
}): readonly NarrativeSeriesAcceptedCharacterAdapterSelector[] {
  const expected = input.admission.selector.acceptedCharacterAdapters;
  if (expected.length !== input.entries.length) {
    throw new Error("narrative series accepted character adapter lookup count does not match its selector");
  }
  const byIdentity = new Map(expected.map((entry) => [
    `${entry.characterId}\u0000${entry.characterSpecFingerprint}`,
    entry,
  ]));
  for (const row of input.entries) {
    const entry = CharacterLoRARegistryEntrySchema.parse(row);
    const selector = byIdentity.get(`${entry.characterId}\u0000${entry.characterSpecFingerprint}`);
    if (!selector) {
      throw new Error("accepted character LoRA is not named by the frozen narrative series selector");
    }
    if (
      entry.status !== "accepted" ||
      entry.accountId !== input.admission.plan.accountId ||
      entry.channelId !== input.admission.plan.channelId ||
      entry.registryIdentity !== selector.registryIdentity
    ) {
      throw new Error("narrative series character adapter is not the accepted immutable registry entry");
    }
  }
  return Object.freeze([...expected]);
}
