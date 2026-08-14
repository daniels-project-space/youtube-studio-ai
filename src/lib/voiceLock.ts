/**
 * voiceLock — ONE job: pin a channel's NARRATOR IDENTITY so every episode
 * speaks in the same voice, and fail loud if anything drifts.
 *
 * WHY THIS EXISTS
 * A persona-driven channel ("I am an AI, and here is what I notice about you")
 * is only a persona if the voice is the same person every week. The existing
 * resolution path is deliberately forgiving — `resolveVoiceId()` in
 * src/lib/tts.ts falls back to a NICHE default, and then to
 * `sleepless_historian`, whenever a voice key does not resolve. For most
 * channels that forgiveness is right. For a first-person AI narrator it is the
 * exact failure mode that matters: a typo'd or dropped voice id does not error,
 * it silently ships an episode in a different person's voice, and nothing in
 * the pipeline notices.
 *
 * So the lock is not a new TTS pipeline and not a new voice source. It is a
 * declaration, stored on the channel next to the rest of its identity, that
 * turns that silent fallback into a hard failure for channels that opt in.
 *
 * Pure data + pure functions — no provider imports, no I/O — so the Convex
 * schema, the runner seed, the narration block and the tests share one
 * definition.
 */

export const VOICE_LOCK_VERSION = "voice-lock/v1" as const;

export type VoiceLockProvider = "fish" | "elevenlabs";

export interface ChannelVoiceLock {
  version: typeof VOICE_LOCK_VERSION;
  /** Which TTS provider the pinned id belongs to. */
  provider: VoiceLockProvider;
  /**
   * The pinned voice. For Fish this is a VOICE_MAP key or a raw 32-hex
   * reference id; for ElevenLabs it is the voice id.
   */
  voiceId: string;
  /** WHO this voice is, in one line, e.g. "the AI narrator of this channel". */
  persona?: string;
  /** Why the channel is locked — read by operators, never by the pipeline. */
  reason: string;
  lockedAt: number;
}

/** Where a resolved voice actually came from. Useful in logs and receipts. */
export type ChannelVoiceSource = "lock" | "cast" | "identity" | "none";

export interface ResolvedChannelVoice {
  voiceId?: string;
  provider?: VoiceLockProvider;
  /** True when a lock decided this, which also means drift must throw. */
  locked: boolean;
  source: ChannelVoiceSource;
  persona?: string;
}

/** The identity shape this module reads. Deliberately structural, not a Convex type. */
export interface VoiceIdentityLike {
  voiceId?: string;
  voiceLock?: unknown;
  voiceCasting?: { voiceId?: string } | null;
}

export function voiceLockDefects(value: unknown): string[] {
  const defects: string[] = [];
  const lock = (value ?? {}) as Record<string, unknown>;
  if (lock["version"] !== VOICE_LOCK_VERSION) {
    defects.push(`unknown voice lock version "${String(lock["version"])}"`);
  }
  if (lock["provider"] !== "fish" && lock["provider"] !== "elevenlabs") {
    defects.push(`unknown voice provider "${String(lock["provider"])}"`);
  }
  if (typeof lock["voiceId"] !== "string" || lock["voiceId"].trim().length === 0) {
    defects.push("voice lock has no voiceId");
  }
  if (typeof lock["reason"] !== "string" || lock["reason"].trim().length === 0) {
    defects.push("voice lock has no reason — an unexplained lock is an unmaintainable one");
  }
  if (typeof lock["lockedAt"] !== "number" || !Number.isFinite(lock["lockedAt"])) {
    defects.push("voice lock has no lockedAt timestamp");
  }
  return defects;
}

/**
 * Parse a persisted lock. Returns undefined for anything malformed rather than
 * throwing: an unreadable lock must not brick a channel, it must simply stop
 * being a lock — and `resolveChannelVoice` then falls through to the normal
 * cast/identity path, which is the pre-lock behaviour.
 */
export function parseVoiceLock(value: unknown): ChannelVoiceLock | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (voiceLockDefects(value).length) return undefined;
  const lock = value as Record<string, unknown>;
  return {
    version: VOICE_LOCK_VERSION,
    provider: lock["provider"] as VoiceLockProvider,
    voiceId: (lock["voiceId"] as string).trim(),
    ...(typeof lock["persona"] === "string" && lock["persona"].trim().length
      ? { persona: (lock["persona"] as string).trim() }
      : {}),
    reason: (lock["reason"] as string).trim(),
    lockedAt: lock["lockedAt"] as number,
  };
}

/**
 * The channel's voice, in precedence order:
 *   lock  → an explicit operator declaration, outranks everything
 *   cast  → the audition winner persisted by channel inception
 *   identity.voiceId → the plain configured voice
 *
 * A lock outranks the cast deliberately: casting exists to FIND a voice, and a
 * lock exists to say the search is over.
 */
export function resolveChannelVoice(identity: VoiceIdentityLike | null | undefined): ResolvedChannelVoice {
  const lock = parseVoiceLock(identity?.voiceLock);
  if (lock) {
    return {
      voiceId: lock.voiceId,
      provider: lock.provider,
      locked: true,
      source: "lock",
      ...(lock.persona ? { persona: lock.persona } : {}),
    };
  }
  const cast = identity?.voiceCasting?.voiceId;
  if (typeof cast === "string" && cast.trim().length) {
    return { voiceId: cast.trim(), provider: "elevenlabs", locked: false, source: "cast" };
  }
  const configured = identity?.voiceId;
  if (typeof configured === "string" && configured.trim().length) {
    return { voiceId: configured.trim(), locked: false, source: "identity" };
  }
  return { locked: false, source: "none" };
}

/**
 * The whole point of the lock. Called by the narration module AFTER the
 * provider-level id has been resolved: if the resolver quietly substituted a
 * different voice (unknown key → niche default → sleepless_historian), the
 * episode must fail rather than ship in a stranger's voice.
 *
 * `resolvedReferenceId` is what the provider will actually be sent.
 * `accepts` lets the caller supply the provider's own mapping, so a lock that
 * names a friendly key ("psychological") still matches the hex id it maps to.
 */
export function assertVoiceLockSatisfied(args: {
  lock: ChannelVoiceLock | undefined;
  resolvedReferenceId: string;
  /** Resolve the lock's own voiceId through the same provider mapping. */
  resolveExpected: (voiceId: string) => string;
}): void {
  if (!args.lock) return;
  const expected = args.resolveExpected(args.lock.voiceId);
  if (expected !== args.resolvedReferenceId) {
    throw new Error(
      `voice lock violated: this channel is pinned to "${args.lock.voiceId}" ` +
        `(${args.lock.provider}) but narration resolved to a different voice. ` +
        "A locked channel must never silently change narrator — fix the voice id or remove the lock.",
    );
  }
}

/** Build a lock. Exported so an operator surface has one canonical constructor. */
export function makeVoiceLock(args: {
  provider: VoiceLockProvider;
  voiceId: string;
  reason: string;
  persona?: string;
  now?: number;
}): ChannelVoiceLock {
  return {
    version: VOICE_LOCK_VERSION,
    provider: args.provider,
    voiceId: args.voiceId.trim(),
    ...(args.persona ? { persona: args.persona.trim() } : {}),
    reason: args.reason.trim(),
    lockedAt: args.now ?? Date.now(),
  };
}
