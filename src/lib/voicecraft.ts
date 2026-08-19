/**
 * VOICECRAFT — the narration voice engine (golden candidate #5, banana-shaped):
 * channel identity in → provider-metadata candidate and physics-tuned voice out.
 *
 * Doctrine: voice is the #1 retention factor, so it gets the same golden
 * treatment as words and pixels. This module intentionally does not use a
 * remote audio judge: Google/Gemini is thumbnail-only. Production proof is a
 * persisted human audition plus local FFmpeg evidence on the actual take.
 *
 *   1. PROFILE — profileVoiceBank() records provider-declared labels as
 *      transparent discovery metadata; it never claims those labels are a
 *      substitute for hearing the voice.
 *   2. CAST — automatic audio casting/recruitment is deliberately unavailable.
 *      Use deterministicVoiceCast for candidate discovery, then persist a
 *      human-reviewed audition before production narration.
 *   3. PHYSICS — narrationPhysics(): speed (VERIFIED LIVE: v3 accepts
 *      voice_settings.speed 0.7–1.2 — also Fish prosody), v3 stability
 *      (0/0.5/1), style, tag density, sentence air — per archetype.
 *   4. GATE — narration_tts performs FFmpeg duration/loudness evidence on its
 *      paid cold-open and final mix before either can reach the timeline.
 *   5. AUDITIONS — auditionBank(): every banked voice renders the ONE
 *      standard ~10s line (AUDITION_LINE) to R2; the channel-settings picker
 *      streams the clips so the operator hears identical text per voice and
 *      recasts a channel in one click (pipeline narration_tts params).
 *
 * FULLY STANDALONE — one import surface. Deps: ELEVENLABS_API_KEY (vault);
 * R2 storage only for audition clips. Convex is an injected client (bank
 * persistence) — never required by the render path. The only engine import
 * is pure-data golden.ts doctrine.
 *
 *   import { selectDeterministicElevenVoice } from "@/lib/deterministicVoiceCast";
 *   import { renderNarration } from "@/lib/voicecraft";
 *   const candidate = await selectDeterministicElevenVoice({ niche });
 *   // Persist a human audition before any production use of candidate.voiceId.
 *   const bytes = await renderNarration({ text, elevenVoiceId: candidate.voiceId,
 *     physics: candidate.physics });
 *
 * Consumers: design-channel casting · narration_tts physics + cold-open gate ·
 * channel-settings narrator picker (voiceBank rows + audition clips).
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { synthNarration, stripAudioTags, type ElevenSettings, type TtsStitch } from "@/lib/tts";
import {
  type NarrationPhysics,
} from "@/engine/golden";

export { narrationPhysicsFor as narrationPhysics, NARRATION_PHYSICS, V3_TAG_PALETTES, type NarrationPhysics } from "@/engine/golden";
export { stripAudioTags } from "@/lib/tts";

const ELEVEN = "https://api.elevenlabs.io/v1";

export function hasVoicecraft(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function elevenKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("voicecraft: ELEVENLABS_API_KEY is not configured");
  return k;
}

/* ------------------------------ the bank -------------------------------- */

export interface AccountVoice {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description?: string;
  previewUrl?: string;
}

export interface VoiceProfile {
  gender: string; // male | female | neutral
  ageFeel: string; // young | middle_aged | old
  register: string; // deep | low | mid | high
  pace: string; // slow | measured | brisk | fast
  energy: string; // calm | controlled | warm | bright | intense
  texture: string; // <=6 words
  character: string; // <=30 words, judge-facing
  bestFor: string[]; // ranked archetype keys
  confidence: number; // 1-10
}

export interface VoiceCard extends AccountVoice {
  profile: VoiceProfile;
}

/** The operator's saved ElevenLabs voices (requires voices_read scope). */
export async function listAccountVoices(): Promise<AccountVoice[]> {
  const res = await fetch(`${ELEVEN}/voices`, { headers: { "xi-api-key": elevenKey() } });
  if (!res.ok) throw new Error(`voicecraft: GET /voices HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; description?: string; preview_url?: string }[] };
  return (j.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category ?? "unknown",
    labels: v.labels ?? {},
    description: v.description ?? undefined,
    previewUrl: v.preview_url ?? undefined,
  }));
}

function providerLabel(labels: Record<string, string>, key: string): string {
  return String(labels[key] ?? labels[key.replace(/_/g, " ")] ?? "").trim().toLowerCase();
}

function metadataVoiceProfile(v: AccountVoice): VoiceProfile | null {
  const gender = providerLabel(v.labels, "gender") || "neutral";
  const rawAge = providerLabel(v.labels, "age");
  const ageFeel = /young|teen|child/.test(rawAge) ? "young"
    : /old|senior|mature/.test(rawAge) ? "old"
      : "middle_aged";
  const useCase = providerLabel(v.labels, "use_case");
  const bestFor = USE_CASE_ARCHETYPES[useCase] ?? [];
  const description = String(v.description ?? "").replace(/\s+/g, " ").trim();
  const usableLabels = [providerLabel(v.labels, "gender"), rawAge, useCase].filter(Boolean).length;
  if (!usableLabels && !description) return null;
  return {
    gender,
    ageFeel,
    register: "mid",
    pace: "measured",
    energy: "controlled",
    texture: "provider metadata only",
    character: description.slice(0, 120) || `${ageFeel.replace(/_/g, " ")} ${gender} narrator`,
    bestFor,
    // This is deliberately below a human audition. It supports deterministic
    // discovery only; production still requires the existing signed audition.
    confidence: usableLabels >= 2 ? 6 : 5,
  };
}

/** Build a transparent provider-metadata card; human audition owns how it sounds. */
export async function profileVoice(v: AccountVoice, log: (m: string) => void = () => {}): Promise<VoiceProfile | null> {
  const profile = metadataVoiceProfile(v);
  if (profile) log(`voicecraft: profiled "${v.name}" from provider metadata; human audition remains required`);
  return profile;
}

/**
 * Profile every saved voice into the Convex bank (skips fresh rows unless
 * `force`). Preview audio is free — profiling costs zero TTS characters
 * except for previewless (cloned) voices, which get one ~100-char sample.
 */
export async function profileVoiceBank(o: {
  convex: ConvexHttpClient;
  ownerId: string;
  force?: boolean;
  log?: (m: string) => void;
}): Promise<VoiceCard[]> {
  const log = o.log ?? (() => {});
  const [account, existing] = await Promise.all([
    listAccountVoices(),
    o.convex.query(api.voiceBank.listProfiles, { ownerId: o.ownerId }).catch(() => []) as Promise<
      { voiceId: string; profile: VoiceProfile }[]
    >,
  ]);
  const known = new Map(existing.map((r) => [r.voiceId, r.profile]));
  const todo = account.filter((v) => o.force || !known.has(v.voiceId));
  log(`voicecraft: bank has ${account.length} voices, ${known.size} profiled, ${todo.length} to profile`);

  const cards: VoiceCard[] = account
    .filter((v) => known.has(v.voiceId))
    .map((v) => ({ ...v, profile: known.get(v.voiceId)! }));

  // Modest concurrency: each profile = one preview download + one Gemini listen.
  const POOL = 3;
  for (let i = 0; i < todo.length; i += POOL) {
    const batch = todo.slice(i, i + POOL);
    const profiled = await Promise.all(
      batch.map(async (v) => ({ v, profile: await profileVoice(v, log).catch((e) => { log(`voicecraft: profile "${v.name}" failed (${e instanceof Error ? e.message.slice(0, 80) : e})`); return null; }) })),
    );
    for (const { v, profile } of profiled) {
      if (!profile) continue;
      cards.push({ ...v, profile });
      try {
        await o.convex.mutation(api.voiceBank.upsertProfile, {
          ownerId: o.ownerId,
          voiceId: v.voiceId,
          name: v.name,
          provider: "elevenlabs",
          category: v.category,
          labels: v.labels,
          previewUrl: v.previewUrl,
          profile,
        });
        log(`voicecraft: profiled "${v.name}" — ${profile.gender}/${profile.ageFeel}/${profile.register}, best for ${profile.bestFor.join("+") || "?"}`);
      } catch (e) {
        log(`voicecraft: bank write failed for "${v.name}" (${e instanceof Error ? e.message.slice(0, 80) : e})`);
      }
    }
  }
  return cards;
}

/* ---------------------------- audition clips ---------------------------- */

/**
 * The ONE standard audition line every bank voice renders (~10s) so the
 * channel-settings picker compares voices on identical text.
 */
export const AUDITION_LINE =
  "Here is how this channel could sound. [pause] A story begins quietly, gathers weight, and lands exactly where it should — every single time.";

export const AUDITION_PREFIX = "voicebank/auditions/";

/**
 * Render the standard audition clip for every banked voice missing one and
 * attach its R2 key to the voice card (the settings picker streams these via
 * /api/asset-url). One-time ~150 chars per voice; skips fresh rows.
 */
export async function auditionBank(o: {
  convex: ConvexHttpClient;
  ownerId: string;
  force?: boolean;
  log?: (m: string) => void;
}): Promise<number> {
  const log = o.log ?? (() => {});
  const rows = (await o.convex.query(api.voiceBank.listProfiles, { ownerId: o.ownerId })) as {
    voiceId: string;
    name: string;
    auditionKey?: string;
  }[];
  let made = 0;
  for (const r of rows) {
    if (r.auditionKey && !o.force) continue;
    try {
      const bytes = await synthNarration({ text: AUDITION_LINE, provider: "elevenlabs", elevenVoiceId: r.voiceId });
      const key = `${AUDITION_PREFIX}${r.voiceId}.mp3`;
      const { putObject } = await import("@/lib/storage");
      await putObject(key, bytes, { contentType: "audio/mpeg" });
      await o.convex.mutation(api.voiceBank.setAudition, { ownerId: o.ownerId, voiceId: r.voiceId, auditionKey: key });
      made++;
      log(`voicecraft: audition clip rendered — ${r.name}`);
    } catch (e) {
      log(`voicecraft: audition clip FAILED for ${r.name} (${e instanceof Error ? e.message.slice(0, 90) : e}) — continuing`);
    }
  }
  log(`voicecraft: audition bank — ${made} new clip(s), ${rows.length} voices total`);
  return made;
}

/* ----------------------------- voice library ---------------------------- */

export interface LibraryVoice {
  publicOwnerId: string;
  voiceId: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  useCase?: string;
  previewUrl?: string;
  /** "professional" = ElevenLabs-reviewed Professional Voice Clone. */
  category?: string;
  /** How many accounts saved this voice — the library's strongest quality proxy. */
  clonedByCount?: number;
  /** Characters rendered with it in the last year. */
  usage1y?: number;
}

/** Search the ElevenLabs community voice library (bank expansion source). */
export async function searchVoiceLibrary(o: {
  gender?: string;
  age?: string;
  accent?: string;
  useCase?: string;
  search?: string;
  pageSize?: number;
}): Promise<LibraryVoice[]> {
  const q = new URLSearchParams();
  if (o.gender && o.gender !== "any") q.set("gender", o.gender);
  if (o.age && o.age !== "any") q.set("age", o.age);
  if (o.accent) q.set("accent", o.accent);
  if (o.useCase) q.set("use_cases", o.useCase);
  if (o.search) q.set("search", o.search);
  q.set("page_size", String(o.pageSize ?? 8));
  q.set("language", "en");
  const res = await fetch(`${ELEVEN}/shared-voices?${q}`, { headers: { "xi-api-key": elevenKey() } });
  if (!res.ok) return [];
  const j = (await res.json()) as { voices?: { public_owner_id: string; voice_id: string; name: string; gender?: string; age?: string; accent?: string; use_case?: string; preview_url?: string; category?: string; cloned_by_count?: number; usage_character_count_1y?: number }[] };
  return (j.voices ?? []).map((v) => ({
    publicOwnerId: v.public_owner_id,
    voiceId: v.voice_id,
    name: v.name,
    gender: v.gender,
    age: v.age,
    accent: v.accent,
    useCase: v.use_case,
    previewUrl: v.preview_url,
    category: v.category,
    clonedByCount: v.cloned_by_count ?? 0,
    usage1y: v.usage_character_count_1y ?? 0,
  }));
}

/** Add a library voice to the operator's bank; returns its NEW account voice id. */
export async function addLibraryVoice(v: LibraryVoice, newName?: string): Promise<string> {
  const res = await fetch(`${ELEVEN}/voices/add/${v.publicOwnerId}/${v.voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": elevenKey(), "content-type": "application/json" },
    body: JSON.stringify({ new_name: newName ?? v.name }),
  });
  if (!res.ok) throw new Error(`voicecraft: add library voice HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { voice_id?: string };
  return j.voice_id ?? v.voiceId;
}

/** Remove a voice from the operator's account (failed validation / eviction). */
export async function removeAccountVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${ELEVEN}/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": elevenKey() },
  });
  if (!res.ok) throw new Error(`voicecraft: delete voice HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

/**
 * RECRUIT — quality-gated bank expansion (operator law 2026-06-13 after a
 * low-quality library add: "new voices from the library have to be highly
 * rated and validated"). Three gates, in order:
 *   1. METRICS — ElevenLabs-reviewed professional clones only, genuinely
 *      popular (cloned_by_count ≥ 100 OR ≥ 2M chars rendered in the last year).
 *   2. PREVIEW JUDGE — Gemini hears the previews and scores BOTH spec fit and
 *      production quality ≥ 8.
 *   3. POST-ADD VALIDATION — the voice is added, OUR calibration line is
 *      rendered through it, and the take must pass judgeNarrationTake; a
 *      failure REMOVES the voice from the account and tries the next one.
 * Returns the profiled VoiceCard of the recruit (already in the Convex bank).
 */
export async function recruitVoice(o: {
  convex: ConvexHttpClient;
  ownerId: string;
  physics: NarrationPhysics & { archetype?: string };
  searchTerms?: string[];
  useCase?: string;
  log?: (m: string) => void;
}): Promise<VoiceCard> {
  void o;
  throw new Error(
    "voicecraft: automatic voice-library recruitment is disabled because the former remote audio judge is not thumbnail-safe; add a voice only after a human audition and persisted production evidence.",
  );
}

/* -------------------------------- casting ------------------------------- */

export interface CastResult {
  voiceId: string;
  name: string;
  character: string;
  score: number;
  why: string;
  auditioned: { name: string; score: number; note: string }[];
  physics: NarrationPhysics & { archetype: string };
}


/** Vendor use_case labels → the archetypes they're natural casting for. */
const USE_CASE_ARCHETYPES: Record<string, string[]> = {
  social_media: ["chaos-commentator", "insider-explainer", "igniter"],
  narrative_story: ["narrator-teacher", "dramatist", "quiet-mentor", "investigator", "gentle-guide"],
  informative_educational: ["teacher", "teacher-advisor", "trusted-explainer", "calm-analyst"],
  conversational: ["enthusiast-critic", "operator-mentor", "insider-explainer"],
  entertainment_tv: ["chaos-commentator", "enthusiast-critic", "dramatist"],
  advertisement: ["igniter", "operator-mentor"],
};

/**
 * Cast the channel's narrator from the profiled bank: deterministic prefilter
 * on the archetype's casting spec, then Gemini auditions the top cards on
 * their REAL preview audio and gates the winner ≥7. Loud failure carries
 * voice-library suggestions so the operator can expand the bank in one click.
 */
export async function castVoice(o: {
  convex: ConvexHttpClient;
  ownerId: string;
  channelName: string;
  niche?: string;
  persona?: string;
  /** Style-DNA narrative register (outranks the archetype baseline). */
  register?: string;
  log?: (m: string) => void;
}): Promise<CastResult> {
  void o;
  throw new Error(
    "voicecraft: automatic audio casting is disabled because the former remote audio judge is not thumbnail-safe; use deterministicVoiceCast for provider-metadata discovery, then save a human-reviewed production cast.",
  );
}

/* ------------------------------- rendering ------------------------------ */

/** Render narration with the archetype's physics applied (eleven v3 + speed). */
export async function renderNarration(o: {
  text: string;
  elevenVoiceId: string;
  physics: NarrationPhysics;
  seed?: number;
  stitch?: TtsStitch;
  onRequestId?: (id: string) => void;
  onBillableCharacters?: (characters: number) => void;
}): Promise<Uint8Array> {
  const eleven: ElevenSettings = {
    stability: o.physics.stability,
    ...(o.physics.style ? { style: o.physics.style } : {}),
    ...(o.seed ? { seed: o.seed } : {}),
  };
  return synthNarration({
    text: o.text,
    provider: "elevenlabs",
    elevenVoiceId: o.elevenVoiceId,
    speed: o.physics.speed,
    eleven,
    stitch: o.stitch,
    onRequestId: o.onRequestId,
    onBillableCharacters: o.onBillableCharacters,
  });
}

export interface TakeVerdict {
  pass: boolean;
  register: number;
  pace: number;
  performance: number;
  clean: number;
  why: string;
}

/**
 * Gemini LISTENS to one rendered take and gates it against the physics.
 * Pass `durationSec` when known: a DETERMINISTIC duration gate runs first —
 * v3 can produce runaway takes (a tag-heavy slow script once rendered 13
 * minutes for 65 words) and an audio model fed truncated inline audio will
 * happily pass them. Code catches what ears cannot.
 */
export async function judgeNarrationTake(o: {
  mp3: Uint8Array;
  physics: NarrationPhysics & { archetype?: string };
  text: string;
  durationSec?: number;
  /**
   * Kept for source compatibility. Production narration uses the local FFmpeg
   * evidence block; this legacy byte-only helper cannot assess delivery safely.
   */
  channel?: unknown;
  log?: (m: string) => void;
  /** Retained for source compatibility; no remote audio judge is invoked. */
  onAudioJudgeCall?: () => void;
}): Promise<TakeVerdict> {
  void o.channel;
  void o.onAudioJudgeCall;
  const durationSec = o.durationSec ?? o.mp3.length / 16_000;
  const words = stripAudioTags(o.text).split(/\s+/).filter(Boolean).length;
  const expected = words / (Number(process.env.NARRATION_WPS) || 3.1) / Math.max(0.7, o.physics.speed)
    + (o.text.match(/\[(long )?pause\]/g)?.length ?? 0) * 1.5;
  const durationPlausible = durationSec >= expected * 0.3 && durationSec <= expected * 2.5 + 12;
  const why = durationPlausible
    ? "remote audio judging is disabled; use the persisted human audition plus local FFmpeg narration evidence"
    : `duration blowout: ${durationSec.toFixed(0)}s rendered vs ~${expected.toFixed(0)}s expected (${words} words)`;
  o.log?.(`voicecraft: legacy take judge unavailable — ${why}`);
  return { register: 0, pace: 0, performance: 0, clean: 0, why, pass: false };
}

/**
 * Cold-open gate — render the first lines ONCE and judge them BEFORE the
 * full-script spend. One seed-bumped retry, then loud failure. Costs ~250
 * chars per run and protects the entire paid render.
 */
export async function gateColdOpen(o: {
  text: string;
  elevenVoiceId: string;
  physics: NarrationPhysics & { archetype?: string };
  seed?: number;
  log?: (m: string) => void;
  onBillableCharacters?: (characters: number) => void;
  onAudioJudgeCall?: () => void;
  /** Retained for source compatibility; no remote audio judge is invoked. */
  channel?: unknown;
}): Promise<{ verdict: TakeVerdict; seed: number }> {
  void o;
  throw new Error(
    "voicecraft: legacy cold-open audio judging is disabled; production narration uses the persisted human audition and local FFmpeg performance evidence before upload.",
  );
}
