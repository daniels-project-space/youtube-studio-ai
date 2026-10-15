import { z } from "zod";

export const showBibleVoiceSchema = z.object({
  positioning: z.string().max(2000).optional(),
  vibe: z.string().max(1000).optional(),
  worksInSpace: z.array(z.string().max(500)).max(10).optional(),
  avoidInSpace: z.array(z.string().max(500)).max(10).optional(),
});

export type ShowBibleVoice = z.infer<typeof showBibleVoiceSchema>;

export type ShowBibleVoicePromptInput = {
  positioning?: string;
  vibe?: string;
  worksInSpace?: readonly string[];
  avoidInSpace?: readonly string[];
};

function compact(value: string | undefined, max: number): string | undefined {
  const result = value?.replace(/\s+/g, " ").trim().slice(0, max);
  return result || undefined;
}

export function showBibleVoicePromptLines(voice?: ShowBibleVoicePromptInput): string[] {
  if (!voice) return [];
  return [
    compact(voice.positioning, 350) ? `Channel positioning: ${compact(voice.positioning, 350)}` : "",
    compact(voice.vibe, 160) ? `Channel tonal signature: ${compact(voice.vibe, 160)}` : "",
    ...(voice.worksInSpace ?? []).slice(0, 4).map((item) => compact(item, 140))
      .filter((item): item is string => Boolean(item)).map((item) => `Channel pattern to preserve: ${item}`),
    ...(voice.avoidInSpace ?? []).slice(0, 4).map((item) => compact(item, 140))
      .filter((item): item is string => Boolean(item)).map((item) => `Channel anti-pattern to reject: ${item}`),
  ].filter(Boolean);
}

export function parseShowBibleVoice(value: unknown): ShowBibleVoice | undefined {
  if (value === undefined || value === null) return undefined;
  return showBibleVoiceSchema.parse(value);
}

export function requireAuthoredShowBibleVoice(value: unknown, consumer: string): ShowBibleVoice {
  let voice: ShowBibleVoice | undefined;
  try {
    voice = parseShowBibleVoice(value);
  } catch {
    throw new Error(`${consumer} FAILED: requires an authored Show Bible with positioning, vibe, works, and anti-patterns`);
  }
  if (
    !voice?.positioning?.trim() ||
    !voice.vibe?.trim() ||
    !voice.worksInSpace?.some((item) => item.trim()) ||
    !voice.avoidInSpace?.some((item) => item.trim())
  ) {
    throw new Error(`${consumer} FAILED: requires an authored Show Bible with positioning, vibe, works, and anti-patterns`);
  }
  return voice;
}
