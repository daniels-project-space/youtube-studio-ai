import { createPackageToOpeningPlan, type PackageToOpeningPlan } from "@/engine/packageToOpening";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const THUMBNAIL_REFRESH_SUCCESSOR_VERSION = "thumbnail-refresh-private-successor/v1" as const;

type RecordValue = Record<string, unknown>;

export type ThumbnailRefreshSuccessorChannel = Readonly<{
  ownerId: string;
  channelId: string;
  name: string;
  status?: string;
  family?: string;
  contentLane?: unknown;
  pipeline?: readonly { block?: unknown }[];
  styleDNA?: unknown;
  thumbnailPlaybook?: unknown;
  identity?: unknown;
}>;

export type ThumbnailRefreshSuccessorMaterial = Readonly<{
  version: typeof THUMBNAIL_REFRESH_SUCCESSOR_VERSION;
  mode: "private_successor";
  ownerId: string;
  channelId: string;
  runId: string;
  family: string;
  contentLane: unknown;
  styleDNA: unknown;
  thumbnailPlaybook?: unknown;
  topic: string;
  title: string;
  thumbnailDescription: string;
  packageToOpeningPlan: PackageToOpeningPlan;
  store: Readonly<Record<string, unknown>>;
  replayFingerprint: string;
}>;

export type ThumbnailRefreshSuccessorAssessment =
  | {
      readonly status: "ready_for_private_successor";
      readonly reason: string;
      readonly material: ThumbnailRefreshSuccessorMaterial;
    }
  | {
      readonly status: "private_successor_unavailable";
      readonly reason: string;
      readonly missing: readonly string[];
    };

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim()
    : undefined;
}

function familyFor(channel: ThumbnailRefreshSuccessorChannel): string | undefined {
  const explicit = text(channel.family) ?? text(record(channel.contentLane)?.family);
  if (explicit) return explicit;
  const lane = text(record(channel.contentLane)?.key);
  if (!lane) return undefined;
  if (lane === "whiteboard_explainer") return "whiteboard";
  if (lane === "motion_comic") return "comic";
  if (lane === "ambient_guided") return "sleep";
  if (/lofi|music_loop/.test(lane)) return "music_loop";
  if (/narrated|documentary|stock/.test(lane)) return "narrated_stock";
  return undefined;
}

function successorBrief(args: {
  title: string;
  channelName: string;
  niche?: string;
  styleDNA?: unknown;
}): string {
  const dna = record(args.styleDNA);
  const thumbnail = record(dna?.thumbnail);
  const subject = text(thumbnail?.subject) ?? text(dna?.recurringSubject);
  const setting = text(dna?.setting);
  const composition = text(thumbnail?.composition);
  const styleContext = [subject, setting, composition].filter(Boolean).join("; ");
  return [
    `Create a new premium mobile-first thumbnail for the retained video “${args.title}” on ${args.channelName}.`,
    `Show one instantly readable visual idea tied to the title${args.niche ? ` and ${args.niche}` : ""}; make the hero subject unmistakable at phone size.`,
    styleContext ? `Use the channel's current visual identity: ${styleContext}.` : "Use the channel's current thumbnail playbook as the visual authority.",
    "Keep the composition focused, high-contrast, and free of generic filler; reserve clean space for the module's own concise typography.",
  ].join(" ").slice(0, 1_800);
}

/**
 * Build a separately identified private candidate when a historic run cannot
 * prove an exact replay. The current channel module is snapshotted and hashed;
 * later config drift invalidates the candidate before paid execution.
 */
export function assessThumbnailRefreshSuccessor(input: {
  ownerId: string;
  channelId: string;
  runId: string;
  title?: unknown;
  topic?: unknown;
  sourceVideoKey?: unknown;
  channel: ThumbnailRefreshSuccessorChannel;
}): ThumbnailRefreshSuccessorAssessment {
  const identity = record(input.channel.identity);
  const title = text(input.title);
  const family = familyFor(input.channel);
  const contentLane = record(input.channel.contentLane);
  const hasStyle = Boolean(record(input.channel.styleDNA) || record(input.channel.thumbnailPlaybook));
  const thumbnailStages = (input.channel.pipeline ?? [])
    .filter((entry) => record(entry)?.block === "thumbnail_gen").length;
  const sourceVideoKey = text(input.sourceVideoKey);
  const missing = [
    input.channel.ownerId !== input.ownerId || input.channel.channelId !== input.channelId
      ? "owner-bound channel"
      : null,
    !title ? "retained video title" : null,
    !family ? "current channel family" : null,
    !contentLane ? "current content lane" : null,
    thumbnailStages !== 1 ? "one current thumbnail module" : null,
    !hasStyle ? "current Style DNA or thumbnail playbook" : null,
    input.channel.status === "archived" ? "non-archived channel" : null,
    family === "music_loop" && !sourceVideoKey ? "retained Lo-Fi final video" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length || !title || !family || !contentLane) {
    return {
      status: "private_successor_unavailable",
      reason: `A private successor cannot run until the channel retains ${missing.join(", ")}.`,
      missing,
    };
  }

  const topic = text(input.topic) ?? title;
  const niche = text(identity?.niche);
  const thumbnailDescription = successorBrief({
    title,
    channelName: input.channel.name,
    niche,
    styleDNA: input.channel.styleDNA,
  });
  const packageToOpeningPlan = createPackageToOpeningPlan({
    title,
    thumbnailDescription,
    topic,
    family,
    contentLane,
  });
  const store: Record<string, unknown> = {
    title,
    thumbnailDescription,
    topic,
    packageToOpeningPlan,
    channelName: input.channel.name,
    styleGrammar: text(identity?.styleGrammar) ?? "",
    styleDNA: input.channel.styleDNA ?? null,
    family,
    persona: text(identity?.persona) ?? "",
    niche: niche ?? "",
    contentLane,
    ...(record(input.channel.thumbnailPlaybook)
      ? { thumbnailPlaybook: input.channel.thumbnailPlaybook }
      : {}),
    ...(record(identity?.thumbnailIdentity)
      ? { thumbnailIdentity: identity?.thumbnailIdentity }
      : {}),
    ...(text(record(identity?.creativeBrief)?.criticDoctrine)
      ? { criticDoctrine: record(identity?.creativeBrief)?.criticDoctrine }
      : {}),
    ...(sourceVideoKey ? { videoKey: sourceVideoKey } : {}),
  };
  const materialWithoutFingerprint = {
    version: THUMBNAIL_REFRESH_SUCCESSOR_VERSION,
    mode: "private_successor" as const,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    family,
    contentLane,
    styleDNA: input.channel.styleDNA ?? null,
    ...(record(input.channel.thumbnailPlaybook)
      ? { thumbnailPlaybook: input.channel.thumbnailPlaybook }
      : {}),
    topic,
    title,
    thumbnailDescription,
    packageToOpeningPlan,
    store,
  };
  return {
    status: "ready_for_private_successor",
    reason: "The retained video is bound to a fresh private candidate using the channel's current thumbnail module and snapshotted style.",
    material: {
      ...materialWithoutFingerprint,
      replayFingerprint: sha256Hex(canonicalJson(materialWithoutFingerprint)),
    },
  };
}
