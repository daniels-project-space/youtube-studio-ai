export type MusicProvider = "mureka" | "suno" | "minimax_music3";

export interface MusicTrack {
  /** Best available URL for this clip (WAV when the upgrade succeeded, else mp3). */
  url: string;
  /** Lossless WAV URL when the conversion succeeded. */
  wavUrl?: string;
  /** Provider clip id (Suno audioId). */
  audioId?: string;
  durationSec?: number;
}
