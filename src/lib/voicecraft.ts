/**
 * VOICECRAFT — the narration voice engine (golden candidate #5, banana-shaped):
 * channel identity in → profiled, judged, physics-tuned voice out.
 *
 * Doctrine: voice is the #1 retention factor, so it gets the same golden
 * treatment as words and pixels — REAL evidence (the operator's actual
 * ElevenLabs voice bank, heard and profiled), deterministic matching, an
 * audio judge gate, and per-archetype delivery physics:
 *
 *   1. PROFILE — profileVoiceBank(): every saved ElevenLabs voice is LISTENED
 *      to (its preview mp3 — free) by Gemini audio and distilled into a
 *      structured Voice Card (gender / age-feel / register / pace / energy /
 *      texture / character / best-fit archetypes), persisted in Convex
 *      (voiceProfiles). Casting matches on what voices SOUND like, not labels.
 *   2. CAST — castVoice(): the niche's NARRATION_PHYSICS casting spec
 *      (operator's voice law: stoic = deep dark male slow; finance =
 *      energetic-or-smooth male faster; social chaos = younger female fast;
 *      meditation = calm professional mature female slow; …) deterministically
 *      prefilters the bank, then Gemini AUDITIONS the top cards on their real
 *      preview audio and gates the winner ≥7. No fit → voice-library search
 *      suggestions in the loud failure.
 *   3. PHYSICS — narrationPhysics(): speed (VERIFIED LIVE: v3 accepts
 *      voice_settings.speed 0.7–1.2 — also Fish prosody), v3 stability
 *      (0/0.5/1), style, tag density, sentence air — per archetype.
 *   4. GATE — gateColdOpen(): before a paid full-script render, the first
 *      lines are rendered once and JUDGED (register / pace / tag performance /
 *      clean ≥7); one seed-bumped retry, then loud failure.
 *
 *   5. RECRUIT — recruitVoice(): quality-gated library expansion (reviewed
 *      professional clones, ≥100 saves or ≥2M chars/yr, preview judged on fit
 *      AND production quality ≥8, then VALIDATED on our own render post-add —
 *      a failure removes the voice and tries the next candidate).
 *   6. AUDITIONS — auditionBank(): every banked voice renders the ONE
 *      standard ~10s line (AUDITION_LINE) to R2; the channel-settings picker
 *      streams the clips so the operator hears identical text per voice and
 *      recasts a channel in one click (pipeline narration_tts params).
 *
 * FULLY STANDALONE — one import surface, same shape as banana / scriptcraft /
 * metacraft / topicraft. Deps: ELEVENLABS_API_KEY + GEMINI_API_KEY (vault);
 * R2 storage only for audition clips. Convex is an injected client (bank
 * persistence) — never required by the render path. The only engine import
 * is pure-data golden.ts doctrine.
 *
 *   import { castVoice, profileVoiceBank, auditionBank, recruitVoice,
 *            narrationPhysics, renderNarration, gateColdOpen,
 *            judgeNarrationTake, hasVoicecraft } from "@/lib/voicecraft";
 *   const cast = await castVoice({ convex, ownerId, channelName, niche, log });
 *   const bytes = await renderNarration({ text, elevenVoiceId: cast.voiceId,
 *     physics: cast.physics });
 *
 * Consumers: design-channel casting · narration_tts physics + cold-open gate ·
 * channel-settings narrator picker (voiceBank rows + audition clips).
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { synthNarration, stripAudioTags, type ElevenSettings, type TtsStitch } from "@/lib/tts";
import { geminiAudioJson, hasGeminiKey } from "@/lib/gemini";
import {
  narrationPhysicsFor,
  NARRATION_PHYSICS,
  V3_TAG_PALETTES,
  type NarrationPhysics,
} from "@/engine/golden";

export { narrationPhysicsFor as narrationPhysics, NARRATION_PHYSICS, V3_TAG_PALETTES, type NarrationPhysics } from "@/engine/golden";
export { stripAudioTags } from "@/lib/tts";

const ELEVEN = "https://api.elevenlabs.io/v1";

export function hasVoicecraft(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY) && hasGeminiKey();
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

const ARCHETYPE_KEYS = Object.keys(NARRATION_PHYSICS);

async function audioOf(v: AccountVoice, log: (m: string) => void): Promise<string | null> {
  if (v.previewUrl) {
    try {
      const res = await fetch(v.previewUrl, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer()).toString("base64");
    } catch {
      /* fall through to a tiny sample */
    }
  }
  // No preview (e.g. a cloned voice) — render one short calibration line.
  try {
    const bytes = await synthNarration({
      text: "This is a short calibration take for the voice bank. Listen to the register, the pace, the texture.",
      provider: "elevenlabs",
      elevenVoiceId: v.voiceId,
    });
    return Buffer.from(bytes).toString("base64");
  } catch (e) {
    log(`voicecraft: no audio obtainable for "${v.name}" (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    return null;
  }
}

/** Gemini LISTENS to one voice and writes its structured card. */
export async function profileVoice(v: AccountVoice, log: (m: string) => void = () => {}): Promise<VoiceProfile | null> {
  const b64 = await audioOf(v, log);
  if (!b64) return null;
  const p = await geminiAudioJson<Partial<VoiceProfile>>({
    audios: [b64],
    maxTokens: 900,
    prompt:
      `You will hear a short sample of a narration voice named "${v.name}"` +
      `${v.labels && Object.keys(v.labels).length ? ` (vendor labels: ${JSON.stringify(v.labels)})` : ""}. ` +
      `Profile what it ACTUALLY sounds like (trust your ears over the labels):\n` +
      `- gender: male|female|neutral\n- ageFeel: young|middle_aged|old\n- register: deep|low|mid|high\n` +
      `- pace: slow|measured|brisk|fast (its NATIVE pace)\n- energy: calm|controlled|warm|bright|intense\n` +
      `- texture: <=6 words (e.g. "dry gravel, close-mic intimacy")\n` +
      `- character: <=30 words a casting director would write\n` +
      `- bestFor: 2-4 keys it could credibly narrate, ranked, from: ${ARCHETYPE_KEYS.join(", ")}\n` +
      `- confidence: 1-10 (sample quality / how sure you are)\n` +
      `Return STRICT JSON {"gender":..,"ageFeel":..,"register":..,"pace":..,"energy":..,"texture":..,"character":..,"bestFor":[..],"confidence":n}.`,
  });
  if (!p?.gender || !p.character) return null;
  return {
    gender: String(p.gender),
    ageFeel: String(p.ageFeel ?? "middle_aged"),
    register: String(p.register ?? "mid"),
    pace: String(p.pace ?? "measured"),
    energy: String(p.energy ?? "warm"),
    texture: String(p.texture ?? ""),
    character: String(p.character),
    bestFor: Array.isArray(p.bestFor) ? p.bestFor.map(String).filter((k) => ARCHETYPE_KEYS.includes(k)) : [],
    confidence: Number(p.confidence ?? 5),
  };
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
  const log = o.log ?? (() => {});
  const spec = o.physics.cast;
  const useCase = o.useCase ?? "narrative_story";
  const searches = await Promise.all([
    searchVoiceLibrary({ gender: spec.gender, accent: spec.accent, useCase, pageSize: 12 }),
    ...(o.searchTerms ?? []).map((s) => searchVoiceLibrary({ gender: spec.gender, accent: spec.accent, useCase, search: s, pageSize: 10 })),
  ]);
  const seen = new Set<string>();
  const candidates = searches
    .flat()
    .filter((v) => {
      if (seen.has(v.voiceId)) return false;
      seen.add(v.voiceId);
      return Boolean(v.previewUrl) && v.category === "professional" && ((v.clonedByCount ?? 0) >= 100 || (v.usage1y ?? 0) >= 2_000_000);
    })
    .sort((a, b) => (b.clonedByCount ?? 0) - (a.clonedByCount ?? 0))
    .slice(0, 6);
  log(`voicecraft: recruit — ${candidates.length} metric-gated candidates: ${candidates.map((c) => `${c.name} (${c.clonedByCount} saves)`).join(", ") || "none"}`);
  if (candidates.length === 0) throw new Error("voicecraft: recruit found no metric-gated library candidates — widen the search");

  const audios: string[] = [];
  const heard: LibraryVoice[] = [];
  for (const c of candidates) {
    try {
      const res = await fetch(c.previewUrl!, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      audios.push(Buffer.from(await res.arrayBuffer()).toString("base64"));
      heard.push(c);
    } catch {
      /* skip */
    }
  }
  if (heard.length === 0) throw new Error("voicecraft: recruit — no candidate previews reachable");
  const verdict = await geminiAudioJson<{ takes?: { idx?: number; fit?: number; quality?: number; note?: string }[] }>({
    audios,
    maxTokens: 900,
    prompt:
      `You are recruiting a narrator. REQUIRED SOUND: ${spec.character}.\n` +
      `You will hear ${heard.length} samples, in order: ` +
      `${heard.map((c, i) => `${i + 1}=${c.name} [${[c.gender, c.age, c.accent].filter(Boolean).join(", ")}]`).join("; ")}.\n` +
      `Vendor labels are FACTS — trust them for accent and age. Score each 1-10 on BOTH: fit (the required sound; a ` +
      `spec'd accent mismatch caps fit at 4) AND quality (recording/production quality: clean studio capture, no ` +
      `muddiness, hiss, room echo, clipping or low-bitrate artifacts — be HARSH, this voice must carry whole videos).\n` +
      `Return STRICT JSON {"takes":[{"idx":1-based,"fit":n,"quality":n,"note":"<=12 words"}]}.`,
  });
  const ranked = (verdict.takes ?? [])
    .filter((t) => typeof t.idx === "number" && (t.fit ?? 0) >= 8 && (t.quality ?? 0) >= 8)
    .sort((x, y) => (y.fit ?? 0) + (y.quality ?? 0) - ((x.fit ?? 0) + (x.quality ?? 0)));
  log(`voicecraft: recruit auditions — ${heard.map((c, i) => { const t = (verdict.takes ?? []).find((x) => x.idx === i + 1); return `${c.name}: fit ${t?.fit ?? "?"} q ${t?.quality ?? "?"}`; }).join(" · ")}`);
  if (ranked.length === 0) throw new Error("voicecraft: recruit — no candidate gated fit+quality ≥8 on preview");

  for (const r of ranked) {
    const cand = heard[r.idx! - 1];
    const newId = await addLibraryVoice(cand);
    log(`voicecraft: recruit — added "${cand.name}" as ${newId}, validating on our own render…`);
    try {
      const take = await synthNarration({ text: AUDITION_LINE, provider: "elevenlabs", elevenVoiceId: newId, speed: o.physics.speed, eleven: { stability: o.physics.stability } });
      const v = await judgeNarrationTake({ mp3: take, physics: o.physics, text: AUDITION_LINE, log });
      if (!v.pass || v.clean < 8) throw new Error(`validation take failed (clean ${v.clean}, ${v.why})`);
      const accountVoice: AccountVoice = {
        voiceId: newId,
        name: cand.name,
        category: "professional",
        labels: { gender: cand.gender ?? "", age: cand.age ?? "", accent: cand.accent ?? "", use_case: cand.useCase ?? useCase },
        previewUrl: cand.previewUrl,
      };
      const profile = await profileVoice(accountVoice, log);
      if (!profile) throw new Error("profiling failed");
      await o.convex.mutation(api.voiceBank.upsertProfile, {
        ownerId: o.ownerId,
        voiceId: newId,
        name: cand.name,
        provider: "elevenlabs",
        category: "professional",
        labels: accountVoice.labels,
        previewUrl: cand.previewUrl,
        profile,
      });
      log(`voicecraft: RECRUITED "${cand.name}" (${cand.clonedByCount} saves) — validated and banked`);
      return { ...accountVoice, profile };
    } catch (e) {
      log(`voicecraft: recruit — "${cand.name}" FAILED validation (${e instanceof Error ? e.message.slice(0, 100) : e}) — removing and trying next`);
      await removeAccountVoice(newId).catch(() => {});
    }
  }
  throw new Error("voicecraft: recruit — every preview-gated candidate failed post-add validation");
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

const AGE_ORDER = ["young", "middle_aged", "old"];

function ageCompatible(spec: string, got: string): boolean {
  if (spec === "any") return true;
  const a = AGE_ORDER.indexOf(spec);
  const b = AGE_ORDER.indexOf(got);
  return a < 0 || b < 0 || Math.abs(a - b) <= 1;
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
  const log = o.log ?? (() => {});
  if (!hasVoicecraft()) throw new Error("voicecraft: ELEVENLABS_API_KEY + GEMINI_API_KEY required");
  const physics = narrationPhysicsFor(o.niche);
  const spec = physics.cast;

  // Bank (profile on first use).
  let cards = await profileVoiceBank({ convex: o.convex, ownerId: o.ownerId, log });
  if (cards.length === 0) throw new Error("voicecraft: voice bank is empty — no ElevenLabs voices reachable");

  // Deterministic prefilter (profile first, vendor labels as tiebreak data).
  // Accent is LAW when the spec sets one: a labeled mismatch is out before
  // the audition — audio judges hallucinate accents under multi-take load.
  const fits = cards.filter(
    (c) =>
      (spec.gender === "any" || c.profile.gender === spec.gender || c.profile.gender === "neutral") &&
      ageCompatible(spec.age, c.profile.ageFeel) &&
      (!spec.accent || !c.labels["accent"] || c.labels["accent"].toLowerCase().includes(spec.accent.toLowerCase())),
  );
  const pool = (fits.length >= 2 ? fits : cards)
    .map((c) => ({
      c,
      rank:
        (c.profile.bestFor[0] === physics.archetype ? 3 : c.profile.bestFor.includes(physics.archetype) ? 2 : 0) +
        // Vendor labels carry real casting signal the heard profile can miss
        // (a sassy social_media young female IS the chaos-commentator spec).
        ((USE_CASE_ARCHETYPES[c.labels["use_case"] ?? ""] ?? []).includes(physics.archetype) ? 1.5 : 0) +
        (spec.gender !== "any" && c.labels["gender"] === spec.gender ? 0.5 : 0) +
        (spec.age !== "any" && c.labels["age"] === spec.age ? 0.5 : 0) +
        (c.category === "professional" || c.category === "cloned" ? 1 : 0) +
        c.profile.confidence / 10,
    }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.c);
  // Six auditions (the audio judge's input ceiling) — wide enough that a
  // label-mismatch in one ranking term can't exclude the obvious candidate.
  const shortlist = pool.filter((c) => c.previewUrl).slice(0, 6);
  if (shortlist.length === 0) throw new Error("voicecraft: no auditionable voices (no previews) for this spec");
  log(`voicecraft: shortlist for ${physics.archetype || "default"} — ${shortlist.map((c) => c.name.split(" - ")[0]).join(", ")}`);

  // AUDITION on real preview audio (free) — Gemini hears all takes together.
  const audios: string[] = [];
  const heard: VoiceCard[] = [];
  for (const c of shortlist) {
    try {
      const res = await fetch(c.previewUrl!, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      audios.push(Buffer.from(await res.arrayBuffer()).toString("base64"));
      heard.push(c);
    } catch {
      /* one bad preview is fine */
    }
  }
  if (heard.length === 0) throw new Error("voicecraft: no preview audio reachable for the shortlist");

  const verdict = await geminiAudioJson<{ takes?: { idx?: number; score?: number; note?: string }[]; winner?: number; why?: string }>({
    audios,
    maxTokens: 900,
    prompt:
      `You are casting THE NARRATOR for the YouTube channel "${o.channelName}"${o.niche ? ` (${o.niche})` : ""}.\n` +
      `REQUIRED SOUND (the operator's casting law for this archetype "${physics.archetype}"): ${spec.character}. ` +
      `Target delivery: ~${physics.speed}x pace feel, ${physics.tagDensity} expressiveness.\n` +
      (o.register ? `CHANNEL REGISTER (outranks the baseline): ${o.register}\n` : "") +
      (o.persona ? `PERSONA: ${o.persona}\n` : "") +
      `You will hear ${heard.length} voice samples, in order: ` +
      `${heard.map((c, i) => `${i + 1}=${c.name} [${[c.labels["gender"], c.labels["age"], c.labels["accent"]].filter(Boolean).join(", ") || "no labels"}]`).join("; ")}.\n` +
      `Vendor labels are FACTS — trust them for accent and age over your own impression. ` +
      `Judge each 1-10 on fit to the REQUIRED SOUND (gender/age/accent/register/darkness/energy as specified — a ` +
      `bright voice cannot win a "deep dark" spec, and a spec'd accent mismatch caps the score at 4). ` +
      `Return STRICT JSON {"takes":[{"idx":1-based,"score":n,"note":"<=12 words"}],"winner":1-based,"why":"<=35 words"}.`,
  });
  const takes = (verdict.takes ?? []).filter((t) => typeof t.idx === "number");
  const wIdx = Math.min(heard.length - 1, Math.max(0, (verdict.winner ?? 1) - 1));
  const winScore = takes.find((t) => t.idx === wIdx + 1)?.score ?? 0;
  const auditioned = heard.map((c, i) => {
    const t = takes.find((x) => (x.idx ?? 0) - 1 === i);
    return { name: c.name, score: t?.score ?? 0, note: t?.note ?? "" };
  });

  if (winScore < 7) {
    const suggestions = await searchVoiceLibrary({ gender: spec.gender, age: spec.age, useCase: "narrative_story" }).catch(() => []);
    throw new Error(
      `voicecraft: no bank voice gated ≥7 for "${spec.character.slice(0, 60)}…" (best ${winScore}). ` +
        `Library candidates to add: ${suggestions.slice(0, 5).map((s) => `${s.name} (${s.gender}/${s.age})`).join(", ") || "none found"}`,
    );
  }
  const winner = heard[wIdx];
  log(`voicecraft: CAST ${winner.name} (${winScore}/10) — ${verdict.why ?? ""} [${auditioned.map((a) => `${a.name.split(" - ")[0]}:${a.score}`).join(", ")}]`);
  return {
    voiceId: winner.voiceId,
    name: winner.name,
    character: winner.profile.character,
    score: winScore,
    why: verdict.why ?? "",
    auditioned,
    physics,
  };
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
  log?: (m: string) => void;
}): Promise<TakeVerdict> {
  // Duration gate runs ALWAYS: when no measured duration is given, estimate
  // from the byte length (our renders are CBR mp3_44100_128 ≈ 16 KB/s).
  const durationSec = o.durationSec ?? o.mp3.length / 16000;
  {
    const words = stripAudioTags(o.text).split(/\s+/).filter(Boolean).length;
    const expected = words / 2.5 / Math.max(0.7, o.physics.speed) + (o.text.match(/\[(long )?pause\]/g)?.length ?? 0) * 1.5;
    if (durationSec > expected * 2.5 + 12 || durationSec < expected * 0.3) {
      const why = `duration blowout: ${durationSec.toFixed(0)}s rendered vs ~${expected.toFixed(0)}s expected (${words} words) — runaway take`;
      o.log?.(`voicecraft: take judged — ${why}`);
      return { register: 0, pace: 0, performance: 0, clean: 0, why, pass: false };
    }
  }
  const paceWord = o.physics.speed <= 0.85 ? "slow and spacious" : o.physics.speed <= 0.95 ? "measured, unhurried" : o.physics.speed <= 1.02 ? "natural" : "brisk and energetic";
  const v = await geminiAudioJson<Partial<TakeVerdict> & { scores?: Partial<TakeVerdict> }>({
    audios: [Buffer.from(o.mp3).toString("base64")],
    maxTokens: 700,
    prompt:
      `You hear ONE narration take. REQUIRED: ${o.physics.cast.character}. Target pace: ${paceWord} (~${o.physics.speed}x). ` +
      `The script may contain performed audio tags (pauses, sighs, whispers) — they must be PERFORMED, never read aloud.\n` +
      `SCRIPT (for fidelity reference): "${stripAudioTags(o.text).slice(0, 500)}"\n` +
      `Score 1-10: register (does the VOICE match the required sound), pace (does the delivery match the target pace), ` +
      `performance (natural delivery, tags performed not spoken, no robotic joins), clean (no artifacts, garbles, ` +
      `skipped or repeated words). Be harsh — 7 means genuinely right.\n` +
      `Return STRICT JSON {"register":n,"pace":n,"performance":n,"clean":n,"why":"<=30 words"}.`,
  });
  const g = (k: keyof TakeVerdict) => Number((v as Record<string, unknown>)[k] ?? (v.scores as Record<string, unknown> | undefined)?.[k] ?? 0);
  const verdict: TakeVerdict = {
    register: g("register"),
    pace: g("pace"),
    performance: g("performance"),
    clean: g("clean"),
    why: String(v.why ?? ""),
    pass: false,
  };
  verdict.pass = verdict.register >= 7 && verdict.pace >= 7 && verdict.performance >= 7 && verdict.clean >= 7;
  o.log?.(
    `voicecraft: take judged — register ${verdict.register} · pace ${verdict.pace} · performance ${verdict.performance} · clean ${verdict.clean}${verdict.pass ? "" : ` — ${verdict.why}`}`,
  );
  return verdict;
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
}): Promise<{ verdict: TakeVerdict; seed: number }> {
  const log = o.log ?? (() => {});
  let seed = o.seed ?? 4242;
  for (let attempt = 0; attempt < 2; attempt++) {
    const bytes = await renderNarration({ text: o.text, elevenVoiceId: o.elevenVoiceId, physics: o.physics, seed });
    const verdict = await judgeNarrationTake({ mp3: bytes, physics: o.physics, text: o.text, log });
    if (verdict.pass) return { verdict, seed };
    log(`voicecraft: cold-open gate attempt ${attempt + 1} FAILED (${verdict.why}) -> ${attempt === 0 ? "seed-bumped retry" : "FAILING LOUD"}`);
    seed += 1;
  }
  throw new Error(`voicecraft: cold-open failed the gate twice for voice ${o.elevenVoiceId} — wrong cast or physics for this channel`);
}
