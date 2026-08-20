/**
 * The immutable semantic promise of a channel.
 *
 * This deliberately points at the existing family and niche catalogs rather
 * than copying their definitions. Budget, schedule, approvals, provider
 * choices, and pipeline overrides remain execution concerns outside this
 * contract.
 */
import { z } from "zod";

import { FAMILIES, type FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { getNiche, getSubcategory } from "@/lib/nicheCatalog";
import { sha256Hex } from "@/lib/sha256";
import type { CreativeCapabilityIntent } from "@/engine/creative/creativeCapabilityCatalog";
import type { FormatSelectionInput } from "@/engine/creative/selectFormat";

export const CHANNEL_PROGRAM_BRIEF_VERSION = "channel-program-brief/v1" as const;
export const CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS = 1_200;

const MAX_LOCALE_CHARS = 64;
const MAX_SUBCATEGORY_CHARS = 240;
const MAX_TOPIC_CHARS = 180;
const CATALOG_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function canonicalLocale(value: string | undefined): string {
  const locale = normalizedText(value ?? "en");
  if (locale.length < 2 || locale.length > MAX_LOCALE_CHARS) {
    throw new Error("channel program brief locale must be a bounded BCP 47 language tag");
  }
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (!canonical) throw new Error("empty canonical locale");
    return canonical;
  } catch {
    throw new Error(`channel program brief locale is invalid: ${locale}`);
  }
}

function canonicalFamily(value: string): FamilyKey {
  const family = normalizedText(value);
  if (!(family in FAMILIES)) {
    throw new Error(`channel program brief family is invalid: ${family || "(empty)"}`);
  }
  return family as FamilyKey;
}

function canonicalNiche(value: string) {
  const nicheKey = normalizedText(value);
  const niche = getNiche(nicheKey);
  if (!niche) {
    throw new Error(`channel program brief niche is invalid: ${nicheKey || "(empty)"}`);
  }
  return niche;
}

function canonicalBoundedText(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = normalizedText(value);
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(
      `channel program brief ${field} must contain ${minimum}–${maximum} characters after normalization`,
    );
  }
  return normalized;
}

function canonicalOptionalText(
  value: string | undefined,
  field: string,
  minimum: number,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizedText(value);
  if (!normalized) return undefined;
  return canonicalBoundedText(value, field, minimum, maximum);
}

function canonicalTopics(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const [index, topic] of value.entries()) {
    const normalized = canonicalBoundedText(topic, `sampleTopics[${index}]`, 2, MAX_TOPIC_CHARS);
    const identity = normalized.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    seen.add(identity);
    topics.push(normalized);
  }
  if (topics.length < 1 || topics.length > 12) {
    throw new Error("channel program brief sampleTopics must contain 1–12 distinct normalized topics");
  }
  return topics;
}

const DraftInputSchema = z.object({
  nicheKey: z.string().max(160),
  subcategory: z.string().max(MAX_SUBCATEGORY_CHARS).optional(),
  locale: z.string().max(MAX_LOCALE_CHARS).optional(),
  concept: z.string().max(600),
  audience: z.string().max(160).optional(),
  sampleTopics: z.array(z.string().max(MAX_TOPIC_CHARS)).min(1).max(12).optional(),
}).strict();

const CreateInputSchema = DraftInputSchema.extend({
  /** Accepted by create() to make handoff from a full brief ergonomic. */
  version: z.literal(CHANNEL_PROGRAM_BRIEF_VERSION).optional(),
  family: z.string().max(80),
  catalogFingerprint: z.string().regex(CATALOG_FINGERPRINT_PATTERN).optional(),
}).strict();

const SubmittedInputSchema = DraftInputSchema.extend({
  version: z.literal(CHANNEL_PROGRAM_BRIEF_VERSION),
  family: z.string().max(80),
  catalogFingerprint: z.string().regex(CATALOG_FINGERPRINT_PATTERN),
}).strict();

export interface ChannelProgramBriefDraft {
  nicheKey: string;
  /** The current canonical subcategory value from the selected niche catalog. */
  subcategory?: string;
  locale: string;
  concept: string;
  audience?: string;
  /** Order expresses the creator's declared priority and is never sorted. */
  sampleTopics?: readonly string[];
}

export interface ChannelProgramBrief extends ChannelProgramBriefDraft {
  version: typeof CHANNEL_PROGRAM_BRIEF_VERSION;
  family: FamilyKey;
  /** SHA-256 of the current catalog identity that gives the brief its meaning. */
  catalogFingerprint: string;
}

function resolvedCatalogIdentity(
  family: FamilyKey,
  nicheKey: string,
  subcategory?: string,
) {
  const familyDefinition = FAMILIES[family];
  const niche = canonicalNiche(nicheKey);
  const resolvedSubcategory = subcategory
    ? getSubcategory(niche.key, subcategory)
    : undefined;
  if (subcategory && (!resolvedSubcategory || resolvedSubcategory.name !== subcategory)) {
    throw new Error(
      `channel program brief subcategory is invalid for ${niche.key}: ${subcategory}`,
    );
  }
  return {
    family: {
      key: familyDefinition.key,
      label: familyDefinition.label,
    },
    niche: {
      key: niche.key,
      label: niche.label,
    },
    ...(resolvedSubcategory
      ? {
        subcategory: {
          id: resolvedSubcategory.id,
          displayName: resolvedSubcategory.name,
        },
      }
      : {}),
  };
}

/**
 * Catalog identity includes only keys and display labels relevant to format
 * selection and positioning—not mutable execution, pricing, or availability.
 */
function currentCatalogFingerprint(
  family: FamilyKey,
  nicheKey: string,
  subcategory?: string,
): string {
  return sha256Hex(canonicalJson(resolvedCatalogIdentity(family, nicheKey, subcategory)));
}

function canonicalDraft(value: z.infer<typeof DraftInputSchema>): ChannelProgramBriefDraft {
  const niche = canonicalNiche(value.nicheKey);
  const requestedSubcategory = canonicalOptionalText(
    value.subcategory,
    "subcategory",
    2,
    MAX_SUBCATEGORY_CHARS,
  );
  const subcategory = requestedSubcategory
    ? getSubcategory(niche.key, requestedSubcategory)?.name
    : undefined;
  if (requestedSubcategory && !subcategory) {
    throw new Error(
      `channel program brief subcategory is invalid for ${niche.key}: ${requestedSubcategory}`,
    );
  }
  const audience = canonicalOptionalText(value.audience, "audience", 2, 160);
  const sampleTopics = canonicalTopics(value.sampleTopics);
  return {
    nicheKey: niche.key,
    ...(subcategory ? { subcategory } : {}),
    locale: canonicalLocale(value.locale),
    concept: canonicalBoundedText(value.concept, "concept", 12, 600),
    ...(audience ? { audience } : {}),
    ...(sampleTopics ? { sampleTopics } : {}),
  };
}

function canonicalIssue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function hasCanonicalText(value: string): boolean {
  return value === normalizedText(value);
}

function assertCanonicalDraftShape(value: ChannelProgramBriefDraft, ctx: z.RefinementCtx): void {
  const niche = getNiche(value.nicheKey);
  if (!niche) canonicalIssue(ctx, ["nicheKey"], "channel program brief niche must be a current catalog key");
  if (!hasCanonicalText(value.nicheKey)) {
    canonicalIssue(ctx, ["nicheKey"], "channel program brief nicheKey must be canonical");
  }
  if (value.subcategory !== undefined) {
    if (!hasCanonicalText(value.subcategory)) {
      canonicalIssue(ctx, ["subcategory"], "channel program brief subcategory must be canonical");
    }
    if (!niche || getSubcategory(niche.key, value.subcategory)?.name !== value.subcategory) {
      canonicalIssue(ctx, ["subcategory"], "channel program brief subcategory must be a current canonical niche value");
    }
  }
  if (!hasCanonicalText(value.locale)) {
    canonicalIssue(ctx, ["locale"], "channel program brief locale must be canonical");
  }
  try {
    if (canonicalLocale(value.locale) !== value.locale) {
      canonicalIssue(ctx, ["locale"], "channel program brief locale must use canonical BCP 47 casing");
    }
  } catch (error) {
    canonicalIssue(ctx, ["locale"], error instanceof Error ? error.message : "invalid locale");
  }
  if (!hasCanonicalText(value.concept)) {
    canonicalIssue(ctx, ["concept"], "channel program brief concept must be canonical");
  }
  if (value.audience !== undefined && !hasCanonicalText(value.audience)) {
    canonicalIssue(ctx, ["audience"], "channel program brief audience must be canonical");
  }
  if (value.sampleTopics) {
    const seen = new Set<string>();
    value.sampleTopics.forEach((topic, index) => {
      if (!hasCanonicalText(topic)) {
        canonicalIssue(ctx, ["sampleTopics", index], "channel program brief sample topic must be canonical");
      }
      const identity = topic.toLocaleLowerCase("en-US");
      if (seen.has(identity)) {
        canonicalIssue(ctx, ["sampleTopics", index], "channel program brief sample topics must be distinct after normalization");
      }
      seen.add(identity);
    });
  }
}

/** A strict schema for an already-normalized draft used by the format advisor. */
export const ChannelProgramBriefDraftSchema = z.object({
  nicheKey: z.string().min(1).max(160),
  subcategory: z.string().min(2).max(MAX_SUBCATEGORY_CHARS).optional(),
  locale: z.string().min(2).max(MAX_LOCALE_CHARS),
  concept: z.string().min(12).max(600),
  audience: z.string().min(2).max(160).optional(),
  sampleTopics: z.array(z.string().min(2).max(MAX_TOPIC_CHARS)).min(1).max(12).optional(),
}).strict().superRefine((value, ctx) => assertCanonicalDraftShape(value, ctx));

/** A strict schema for the durable, already-normalized full brief. */
export const ChannelProgramBriefSchema = z.object({
  version: z.literal(CHANNEL_PROGRAM_BRIEF_VERSION),
  family: z.string().min(1).max(80),
  catalogFingerprint: z.string().regex(CATALOG_FINGERPRINT_PATTERN),
  nicheKey: z.string().min(1).max(160),
  subcategory: z.string().min(2).max(MAX_SUBCATEGORY_CHARS).optional(),
  locale: z.string().min(2).max(MAX_LOCALE_CHARS),
  concept: z.string().min(12).max(600),
  audience: z.string().min(2).max(160).optional(),
  sampleTopics: z.array(z.string().min(2).max(MAX_TOPIC_CHARS)).min(1).max(12).optional(),
}).strict().superRefine((value, ctx) => {
  if (!(value.family in FAMILIES)) {
    canonicalIssue(ctx, ["family"], "channel program brief family must be a current catalog key");
  }
  if (!hasCanonicalText(value.family)) {
    canonicalIssue(ctx, ["family"], "channel program brief family must be canonical");
  }
  assertCanonicalDraftShape(value, ctx);
  try {
    const family = canonicalFamily(value.family);
    const expectedCatalogFingerprint = currentCatalogFingerprint(
      family,
      value.nicheKey,
      value.subcategory,
    );
    if (value.catalogFingerprint !== expectedCatalogFingerprint) {
      canonicalIssue(
        ctx,
        ["catalogFingerprint"],
        "channel program brief catalogFingerprint must match the current resolved catalog identity",
      );
    }
  } catch (error) {
    canonicalIssue(
      ctx,
      ["catalogFingerprint"],
      error instanceof Error ? error.message : "invalid current catalog identity",
    );
  }
});

/** Parse creator input into a normalized advisor-ready semantic draft. */
export function parseChannelProgramBriefDraft(value: unknown): ChannelProgramBriefDraft {
  const raw = DraftInputSchema.parse(value);
  return ChannelProgramBriefDraftSchema.parse(canonicalDraft(raw)) as ChannelProgramBriefDraft;
}

/** Construct a complete normalized brief after the existing family advisor is accepted. */
export function createChannelProgramBrief(value: unknown): ChannelProgramBrief {
  const raw = CreateInputSchema.parse(value);
  const family = canonicalFamily(raw.family);
  const draft = canonicalDraft(raw);
  const brief: ChannelProgramBrief = {
    version: CHANNEL_PROGRAM_BRIEF_VERSION,
    family,
    catalogFingerprint: currentCatalogFingerprint(family, draft.nicheKey, draft.subcategory),
    ...draft,
  };
  return ChannelProgramBriefSchema.parse(brief) as ChannelProgramBrief;
}

/**
 * Parse a submitted full brief without rewriting it. Use create() while a
 * creator is still assembling a draft; after submission the exact canonical
 * representation is part of the request identity.
 */
export function parseChannelProgramBrief(value: unknown): ChannelProgramBrief {
  const raw = SubmittedInputSchema.parse(value);
  const canonical = createChannelProgramBrief(raw);
  if (canonicalJson(raw) !== canonicalJson(canonical)) {
    throw new Error("channel program brief is noncanonical; submit the canonical brief unchanged");
  }
  return canonical;
}

/**
 * Require that a submitted full brief is already exactly canonical. This is
 * the server-boundary guard: no caller may silently alter signed/request-keyed
 * input after it has been submitted.
 */
export function assertCanonicalChannelProgramBrief(value: unknown): ChannelProgramBrief {
  return parseChannelProgramBrief(value);
}

/** Options for validating a program brief already persisted inside channel identity. */
export interface PersistedProgramBriefIdentityOptions {
  /** Reject a persisted brief for a different channel family before any work begins. */
  expectedFamily?: FamilyKey;
  /** Bind a retry or maintenance run to this exact immutable program fingerprint. */
  expectedProgramBrief?: ChannelProgramBrief;
  /** Legacy maintenance callers may omit a brief; admitted retry paths may not. */
  requireProgramBrief?: boolean;
  /** Stable operation name included in fail-closed diagnostics. */
  context?: string;
}

/**
 * Validate the canonical brief nested in persisted channel identity.
 *
 * A canonical brief owns its catalog niche key. The duplicate identity key is
 * retained for legacy storage lookups, but it must agree before a brief-bearing
 * row can begin research, creative work, or a retry.
 */
export function assertPersistedProgramBriefIdentity(
  identityValue: unknown,
  options: PersistedProgramBriefIdentityOptions = {},
): ChannelProgramBrief | undefined {
  const context = options.context ?? "channel identity";
  const identity = identityValue && typeof identityValue === "object" && !Array.isArray(identityValue)
    ? identityValue as { programBrief?: unknown; nicheKey?: unknown }
    : undefined;
  const rawProgramBrief = identity?.programBrief;
  if (rawProgramBrief === undefined) {
    if (options.requireProgramBrief) {
      throw new Error(`${context} is missing a canonical program brief`);
    }
    return undefined;
  }
  const programBrief = assertCanonicalChannelProgramBrief(rawProgramBrief);
  if (identity?.nicheKey !== programBrief.nicheKey) {
    throw new Error(
      `${context} nicheKey ${String(identity?.nicheKey)} must match canonical program brief nicheKey ${programBrief.nicheKey}`,
    );
  }
  if (options.expectedFamily !== undefined && programBrief.family !== options.expectedFamily) {
    throw new Error(
      `${context} program brief family ${programBrief.family} does not match expected family ${options.expectedFamily}`,
    );
  }
  if (
    options.expectedProgramBrief !== undefined &&
    channelProgramBriefFingerprint(programBrief) !== channelProgramBriefFingerprint(options.expectedProgramBrief)
  ) {
    throw new Error(`${context} program brief does not match the expected canonical program brief`);
  }
  return programBrief;
}

/** Stable canonical JSON used by identities, receipts, and durable snapshots. */
export function canonicalChannelProgramBrief(value: unknown): string {
  return canonicalJson(assertCanonicalChannelProgramBrief(value));
}

/** Stable content identity for the semantic program promise. */
export function channelProgramBriefFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(assertCanonicalChannelProgramBrief(value)));
}

function nicheDisplayName(brief: ChannelProgramBrief): string {
  const niche = getNiche(brief.nicheKey);
  if (!niche) throw new Error(`channel program brief niche is invalid: ${brief.nicheKey}`);
  return brief.subcategory ? `${niche.label} — ${brief.subcategory}` : niche.label;
}

function appendBounded(current: string, segment: string): string {
  if (current.length >= CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS) return current;
  const separator = current ? "\n" : "";
  const available = CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS - current.length - separator.length;
  if (available <= 0) return current;
  if (segment.length <= available) return `${current}${separator}${segment}`;
  return `${current}${separator}${segment.slice(0, Math.max(0, available - 1)).trimEnd()}…`;
}

/** Deterministic, bounded text for positioning prompts and audit displays. */
export function channelProgramBriefPositioningText(value: unknown): string {
  const brief = assertCanonicalChannelProgramBrief(value);
  const segments = [
    `Concept: ${brief.concept}`,
    `Niche: ${nicheDisplayName(brief)}`,
    `Locale: ${brief.locale}`,
    ...(brief.audience ? [`Audience: ${brief.audience}`] : []),
    ...(brief.sampleTopics?.length ? [`Sample topics: ${brief.sampleTopics.join(" | ")}`] : []),
  ];
  return segments.reduce(appendBounded, "");
}

/** Adapter only: keeps the format advisor's existing input contract intact. */
export function briefToFormatSelectionInput(
  value: unknown,
  options: Pick<FormatSelectionInput, "targetDurationSeconds" | "maxPerVideoBudgetUsd"> = {},
): FormatSelectionInput {
  const brief = assertCanonicalChannelProgramBrief(value);
  return {
    concept: brief.concept,
    niche: nicheDisplayName(brief),
    nicheKey: brief.nicheKey,
    ...(brief.audience ? { audience: brief.audience } : {}),
    ...(brief.sampleTopics?.length ? { sampleTopics: [...brief.sampleTopics] } : {}),
    ...(options.targetDurationSeconds !== undefined
      ? { targetDurationSeconds: options.targetDurationSeconds }
      : {}),
    ...(options.maxPerVideoBudgetUsd !== undefined
      ? { maxPerVideoBudgetUsd: options.maxPerVideoBudgetUsd }
      : {}),
  };
}

/** Adapter only: keeps the declarative creative-capability catalog authoritative. */
export function briefToCreativeCapabilityIntent(
  value: unknown,
): CreativeCapabilityIntent {
  const brief = assertCanonicalChannelProgramBrief(value);
  return {
    concept: brief.concept,
    niche: nicheDisplayName(brief),
    nicheKey: brief.nicheKey,
    ...(brief.audience ? { audience: brief.audience } : {}),
    ...(brief.sampleTopics?.length ? { sampleTopics: [...brief.sampleTopics] } : {}),
  };
}
