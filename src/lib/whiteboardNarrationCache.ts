import { createHash } from "node:crypto";

export type WhiteboardNarrationRequest = {
  provider: "fish" | "elevenlabs";
  voiceId: string;
  speed: number | null;
  text: string;
};

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function whiteboardNarrationCacheReceipt(request: WhiteboardNarrationRequest, audio: Uint8Array) {
  if (!request.voiceId.trim() || !request.text.trim() || audio.byteLength === 0) throw new Error("whiteboard narration cache input is incomplete");
  const requestSha256 = sha256(JSON.stringify({ provider: request.provider, voiceId: request.voiceId, speed: request.speed, text: request.text }));
  return { version: "whiteboard-narration-cache/v1", requestSha256, audioSha256: sha256(audio), audioBytes: audio.byteLength };
}

export function assertWhiteboardNarrationCache(receipt: unknown, request: WhiteboardNarrationRequest, audio: Uint8Array): void {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("whiteboardSync: cached narration receipt is invalid");
  const expected = whiteboardNarrationCacheReceipt(request, audio);
  const actual = receipt as Record<string, unknown>;
  if (actual.version !== expected.version || actual.requestSha256 !== expected.requestSha256 ||
      actual.audioSha256 !== expected.audioSha256 || actual.audioBytes !== expected.audioBytes) {
    throw new Error("whiteboardSync: cached narration does not match its text, provider, voice, speed and audio receipt; preserving paid cache");
  }
}
