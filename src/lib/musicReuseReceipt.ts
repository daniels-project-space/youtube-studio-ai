import { z } from "zod";
import { sha256BytesHex } from "@/lib/sha256";

export const MUSIC_REUSE_RECEIPT_VERSION = "music_reuse/v1" as const;

export const MusicReuseReceiptSchema = z.object({
  version: z.literal(MUSIC_REUSE_RECEIPT_VERSION),
  ownerId: z.string().trim().min(1).max(300),
  baseRunId: z.string().trim().min(1).max(300),
  baseChannelId: z.string().trim().min(1).max(300),
  siblingChannelId: z.string().trim().min(1).max(300),
  musicKey: z.string().trim().min(1).max(2_000),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  audioByteLength: z.number().int().min(1).max(250_000_000),
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
  return receipt;
}
