export interface StudioEngineH3Media {
  version: "studio-engine-h3-media/v1";
  sha256: string;
  width: 1280;
  height: 736;
  codec: "h264";
  fps: 24;
  frames: number;
  durationSec: number;
}

export function assertStudioEngineH3Media(value: unknown, sha256: string, durationSec: number): asserts value is StudioEngineH3Media {
  const media = value as Partial<StudioEngineH3Media> | null;
  if (!media || media.version !== "studio-engine-h3-media/v1" || media.sha256 !== sha256 ||
      !/^[a-f0-9]{64}$/.test(sha256) || media.width !== 1280 || media.height !== 736 ||
      media.codec !== "h264" || media.fps !== 24 || !Number.isSafeInteger(media.frames) ||
      media.frames! < 114 || media.frames! > 126 || !Number.isFinite(media.durationSec) ||
      Math.abs(media.durationSec! - media.frames! / 24) > 0.000001 ||
      Math.abs(media.durationSec! - durationSec) > 0.000001) {
    throw new Error("Engine H3 physical media does not match its admitted video contract");
  }
}
