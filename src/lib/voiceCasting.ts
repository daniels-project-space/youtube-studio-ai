/**
 * VOICE CASTING — the architect's ears for narration. The DNA describes the
 * register ("calm authority, restraint dominant"); this auditions REAL
 * ElevenLabs voices with a channel-true line and has Gemini (native audio)
 * judge each take against the register. Winner feeds the architect, which
 * sets ttsProvider/elevenVoiceId. Evidence → audition → judge → cast: a
 * founding decision made once, on real sound, not on a label.
 */
import { join } from "node:path";
import { writeBytes, makeRunTempDir } from "@/lib/files";
import { claudeJson } from "@/lib/anthropic";
import type { StyleDNA } from "@/engine/creative/types";

/** Premade ElevenLabs voices (work with TTS-scoped keys — no voices_read needed). */
export const CASTING_POOL = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", character: "warm British baritone — documentary gravitas, measured" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", character: "deep British news-anchor — authoritative, precise" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", character: "American mid-deep — trustworthy explainer, friendly authority" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", character: "older American — weathered storyteller, intimate" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", character: "American female — clear, modern, engaging educator" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", character: "Swedish-English female — calm, soothing, contemplative" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", character: "young American male — energetic, contemporary" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", character: "warm American female — friendly narrator, upbeat-calm" },
] as const;

export interface CastResult {
  voiceId: string;
  name: string;
  character: string;
  score: number;
  why: string;
  auditioned: { name: string; score: number; note: string }[];
}

export async function castVoice(args: {
  channelName: string;
  niche?: string;
  dna: StyleDNA;
  runId?: string;
  log?: (m: string) => void;
}): Promise<CastResult | null> {
  const log = args.log ?? (() => {});
  if (!process.env.ELEVENLABS_API_KEY || !process.env.GEMINI_API_KEY) return null;
  try {
    const register = JSON.stringify(args.dna.narrative ?? {});
    // 1. Shortlist 4 by character-vs-register + write the audition line.
    const pick = await claudeJson<{ shortlist?: string[]; line?: string }>({
      maxTokens: 500,
      temperature: 0.4,
      system: "You are a casting director for narration voices. Return ONLY JSON.",
      prompt:
        `Channel "${args.channelName}" (${args.niche ?? "?"}). Narrative register: ${register}\n` +
        `VOICES:\n${CASTING_POOL.map((v) => `- ${v.name}: ${v.character}`).join("\n")}\n` +
        `Pick the 4 most promising names for this register, and write ONE audition line (2 sentences, ~30 words, ` +
        `channel-true content, include one inline audio tag like [pause] where the register would breathe). ` +
        `Return STRICT JSON {"shortlist":["name",...],"line":string}.`,
    });
    const shortlist = CASTING_POOL.filter((v) => (pick.shortlist ?? []).includes(v.name)).slice(0, 4);
    const line = pick.line ?? `History does not repeat itself. [pause] But it rhymes — and the rhyme is where the money hides.`;
    if (shortlist.length < 2) return null;

    // 2. Auditions (eleven_v3, ~30 words each — pennies).
    const tmp = await makeRunTempDir(args.runId ?? `cast_${args.channelName.replace(/\W+/g, "_")}`);
    const takes: { v: (typeof CASTING_POOL)[number]; path: string }[] = [];
    for (const v of shortlist) {
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${v.id}?output_format=mp3_44100_64`,
          {
            method: "POST",
            headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
            body: JSON.stringify({ text: line, model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
          },
        );
        if (!res.ok) continue;
        const p = join(tmp, `audition_${v.name}.mp3`);
        await writeBytes(p, new Uint8Array(await res.arrayBuffer()));
        takes.push({ v, path: p });
      } catch { /* one bad audition is fine */ }
    }
    if (takes.length < 2) return null;
    log(`voiceCasting: ${takes.length} auditions recorded ("${line.slice(0, 60)}…")`);

    // 3. Gemini LISTENS and judges each take against the register.
    const { readFile } = await import("node:fs/promises");
    const { geminiAudioJudge } = await import("@/lib/gemini");
    const parts: { name: string; b64: string }[] = [];
    for (const t of takes) parts.push({ name: t.v.name, b64: Buffer.from(await readFile(t.path)).toString("base64") });
    const verdict = await geminiAudioJudge({
      audios: parts.map((p) => p.b64),
      prompt:
        `You are casting the NARRATOR for "${args.channelName}". Required register: ${register}\n` +
        `You will hear ${takes.length} auditions of the same line, in order: ${takes.map((t, i) => `${i + 1}=${t.v.name}`).join(", ")}.\n` +
        `Judge each on register fit (authority/warmth/pace as required), naturalness, and how the [pause]/breaths land. ` +
        `Return STRICT JSON {"takes":[{"idx":1-based,"score":1-10,"note":"<=15 words"}],"winner":1-based,"why":"<=40 words"}.`,
    });
    const wIdx = Math.min(takes.length - 1, Math.max(0, (verdict.winner ?? 1) - 1));
    const winner = takes[wIdx].v;
    const auditioned = takes.map((t, i) => {
      const tv = (verdict.takes ?? []).find((x) => (x.idx ?? 0) - 1 === i);
      return { name: t.v.name, score: tv?.score ?? 0, note: tv?.note ?? "" };
    });
    log(`voiceCasting: WINNER ${winner.name} — ${verdict.why ?? ""} (${auditioned.map((a) => `${a.name}:${a.score}`).join(", ")})`);
    return {
      voiceId: winner.id,
      name: winner.name,
      character: winner.character,
      score: auditioned[wIdx]?.score ?? 0,
      why: verdict.why ?? "",
      auditioned,
    };
  } catch (e) {
    log(`voiceCasting failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
