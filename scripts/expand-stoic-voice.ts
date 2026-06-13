/**
 * Bank expansion for the stoic spec (operator feedback 2026-06-13): "even
 * deeper voice with no accent" — search the ElevenLabs community library for
 * VERY deep neutral-American narrative males, audition their previews against
 * the updated quiet-mentor casting law (alongside the bank's best American
 * deep males), add the winner to the account, profile it into the bank.
 * Casting itself stays with castVoice() — this only widens its talent pool.
 *
 * Run:  set -a; . .env.local; set +a; npx tsx scripts/expand-stoic-voice.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { geminiAudioJson } from "@/lib/gemini";
import {
  searchVoiceLibrary,
  addLibraryVoice,
  profileVoice,
  NARRATION_PHYSICS,
  type LibraryVoice,
} from "@/lib/voicecraft";

const OWNER = "owner_daniel";

async function b64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}

async function main() {
  await bootstrapSecrets();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const convex = new ConvexHttpClient(url!);
  const spec = NARRATION_PHYSICS["quiet-mentor"].cast;
  console.log(`spec: ${spec.character}`);

  // Library candidates: deep American narrative males, two query angles.
  const [a, b] = await Promise.all([
    searchVoiceLibrary({ gender: "male", accent: "american", useCase: "narrative_story", search: "deep", pageSize: 10 }),
    searchVoiceLibrary({ gender: "male", accent: "american", useCase: "narrative_story", pageSize: 10 }),
  ]);
  const seen = new Set<string>();
  const candidates: LibraryVoice[] = [...a, ...b].filter((v) => {
    if (seen.has(v.voiceId) || !v.previewUrl) return false;
    seen.add(v.voiceId);
    return true;
  });
  console.log(`library candidates: ${candidates.length} — ${candidates.slice(0, 8).map((c) => c.name).join(", ")}`);
  if (candidates.length === 0) throw new Error("no library candidates found");

  // Audition up to 6 library previews against the spec.
  const audios: string[] = [];
  const heard: LibraryVoice[] = [];
  for (const c of candidates) {
    if (heard.length >= 6) break;
    const audio = await b64(c.previewUrl!);
    if (!audio) continue;
    audios.push(audio);
    heard.push(c);
  }
  const verdict = await geminiAudioJson<{ takes?: { idx?: number; score?: number; note?: string }[]; winner?: number; why?: string }>({
    audios,
    maxTokens: 900,
    prompt:
      `You are casting a narrator. REQUIRED SOUND: ${spec.character}.\n` +
      `You will hear ${heard.length} samples, in order: ${heard.map((c, i) => `${i + 1}=${c.name}`).join(", ")}.\n` +
      `Score each 1-10 on fit. DEPTH and a neutral American accent dominate — any non-American accent caps the score at 4.\n` +
      `Return STRICT JSON {"takes":[{"idx":1-based,"score":n,"note":"<=12 words"}],"winner":1-based,"why":"<=30 words"}.`,
  });
  const wIdx = Math.min(heard.length - 1, Math.max(0, (verdict.winner ?? 1) - 1));
  const winScore = (verdict.takes ?? []).find((t) => t.idx === wIdx + 1)?.score ?? 0;
  console.log(
    `auditions: ${heard.map((c, i) => `${c.name}:${(verdict.takes ?? []).find((t) => t.idx === i + 1)?.score ?? "?"}`).join(" · ")}`,
  );
  if (winScore < 8) throw new Error(`no library candidate scored ≥8 (best ${winScore}) — widen the search`);
  const winner = heard[wIdx];
  console.log(`WINNER: ${winner.name} (${winScore}/10) — ${verdict.why}`);

  // Add to the account + profile into the bank.
  const newId = await addLibraryVoice(winner);
  console.log(`added to account as ${newId}`);
  const accountVoice = {
    voiceId: newId,
    name: winner.name,
    category: "professional",
    labels: { gender: winner.gender ?? "male", age: winner.age ?? "middle_aged", accent: winner.accent ?? "american", use_case: winner.useCase ?? "narrative_story" },
    previewUrl: winner.previewUrl,
  };
  const profile = await profileVoice(accountVoice, (m) => console.log(`  ${m}`));
  if (!profile) throw new Error("profiling the added voice failed");
  await convex.mutation(api.voiceBank.upsertProfile, {
    ownerId: OWNER,
    voiceId: newId,
    name: winner.name,
    provider: "elevenlabs",
    category: "professional",
    labels: accountVoice.labels,
    previewUrl: winner.previewUrl,
    profile,
  });
  console.log(`bank updated: ${winner.name} — ${profile.character} (bestFor ${profile.bestFor.join("+")})`);
}

main().catch((e) => {
  console.error("expand failed:", e);
  process.exit(1);
});
