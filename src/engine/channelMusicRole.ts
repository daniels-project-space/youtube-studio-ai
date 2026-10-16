import { z } from "zod";

export const CHANNEL_MUSIC_ROLE_VALUES = [
  "primary_music",
  "narration_bed",
  "meditation_bed",
  "sleep_sound_bed",
  "short_form_bed",
] as const;

export const ChannelMusicRoleSchema = z.enum(CHANNEL_MUSIC_ROLE_VALUES);
export type ChannelMusicRole = z.infer<typeof ChannelMusicRoleSchema>;

export const LOOPABLE_CHANNEL_MUSIC_ROLE_VALUES = [
  "primary_music",
  "meditation_bed",
  "sleep_sound_bed",
] as const;
export const LoopableChannelMusicRoleSchema = z.enum(LOOPABLE_CHANNEL_MUSIC_ROLE_VALUES);
