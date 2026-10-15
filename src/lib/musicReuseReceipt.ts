import { z } from "zod";
import { sha256BytesHex } from "@/lib/sha256";
import { groupMusicSoundProfileFingerprint } from "@/lib/groupMusicProfile";

export const MUSIC_REUSE_RECEIPT_VERSION = "music_reuse/v2" as const;

const ContentDigestSchema = z.object({
  key: z.string().trim().min(1).max(2_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const MusicReuseReceiptSchema = z.object({
  version: z.literal(MUSIC_REUSE_RECEIPT_VERSION),
  ownerId: z.string().trim().min(1).max(300),
  baseRunId: z.string().trim().min(1).max(300),
  baseChannelId: z.string().trim().min(1).max(300),
  siblingChannelId: z.string().trim().min(1).max(300),
  family: z.string().trim().min(1).max(120),
  contentLaneKey: z.string().trim().min(1).max(120),
  provider: z.enum(["mureka", "suno", "minimax_music3"]),
  musicKey: z.string().trim().min(1).max(2_000),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  audioByteLength: z.number().int().min(1).max(250_000_000),
  soundProfileFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  baseMusicKey: z.string().trim().min(1).max(2_000),
  providerEvidence: z.object({
    program: ContentDigestSchema,
    source: ContentDigestSchema,
    quality: ContentDigestSchema,
    auditionWav: ContentDigestSchema,
  }).strict(),
}).strict();

export type MusicReuseReceipt = z.infer<typeof MusicReuseReceiptSchema>;

export function createMusicReuseReceipt(input: Omit<MusicReuseReceipt, "version">): MusicReuseReceipt {
  return MusicReuseReceiptSchema.parse({ version: MUSIC_REUSE_RECEIPT_VERSION, ...input });
}

export function assertMusicReuseReceipt(input: {
  receipt: unknown;
  ownerId: string;
  siblingChannelId: string;
  musicKey: string;
  audioBytes?: Uint8Array;
  currentFamily?: string;
  currentContentLaneKey?: string;
  currentProvider?: string;
  currentStyleDNA?: unknown;
}): MusicReuseReceipt {
  if (input.receipt === undefined) throw new Error("music reuse receipt is required");
  let receipt: MusicReuseReceipt;
  try {
    receipt = MusicReuseReceiptSchema.parse(input.receipt);
  } catch {
    throw new Error("music reuse receipt is malformed");
  }
  if (receipt.ownerId !== input.ownerId || receipt.siblingChannelId !== input.siblingChannelId ||
      receipt.musicKey !== input.musicKey || (input.audioBytes !== undefined &&
      (receipt.audioByteLength !== input.audioBytes.byteLength || receipt.audioSha256 !== sha256BytesHex(input.audioBytes)))) {
    throw new Error("music reuse receipt does not match this owner, sibling, key, or exact audio bytes");
  }
  const baseAudioPrefix = `owner/${receipt.ownerId}/runs/${receipt.baseRunId}/audio/`;
  const groupEvidencePrefix = `owner/${receipt.ownerId}/group/`;
  if (!receipt.baseMusicKey.startsWith(baseAudioPrefix) || receipt.baseMusicKey.includes("..") ||
      Object.values(receipt.providerEvidence).some(({ key }) => !key.startsWith(groupEvidencePrefix) ||
        !key.includes(`/bundle/${receipt.baseRunId}/music-evidence/`) || key.includes(".."))) {
    throw new Error("music reuse receipt evidence keys are outside the exact base-run and durable group namespaces");
  }
  if (receipt.provider === "minimax_music3") {
    throw new Error("MiniMax music reuse is disabled until its native worker evidence can be transferred and reverified");
  }
  const currentProfile = groupMusicSoundProfileFingerprint({
    family: input.currentFamily ?? receipt.family,
    contentLaneKey: input.currentContentLaneKey ?? receipt.contentLaneKey,
    provider: input.currentProvider ?? receipt.provider,
    styleDNA: input.currentStyleDNA,
  });
  if (currentProfile !== receipt.soundProfileFingerprint) {
    throw new Error("music reuse receipt sound profile does not match the current channel identity");
  }
  return receipt;
}
