/**
 * channelCharacter — ONE job: RESOLVE THIS CHANNEL'S LOCKED CHARACTER, once.
 *
 * A POV-vlogger channel ("Hi, I'm Chloe, and I have time travelled to Rome in
 * 79 AD") is only a character channel if the SAME person appears in episode 1
 * and episode 40. That means the character's name, appearance and LoRA
 * reference must be READ FROM STORAGE every episode, never re-authored per run.
 *
 * WHAT THIS MODULE IS
 * The read side of that identity, and nothing else. It is to
 * `src/lib/characterLora.ts` what `src/lib/voiceLock.ts` is to the TTS voice
 * map: the LoRA module owns what a valid weights reference looks like and how
 * to hand it to an endpoint, and THIS module owns "which character does channel
 * X star, and is it still the same one".
 *
 * WHAT THIS MODULE MUST NEVER DO
 *   • author or re-describe the character (a per-episode description IS drift);
 *   • generate an image, a video or a frame — it has no provider import and
 *     makes no network call;
 *   • train or import a LoRA (that is src/lib/novitaCharacterLora.ts);
 *   • decide how a shot is framed (that is src/lib/shotComposition.ts).
 *
 * WHY THE APPEARANCE TEXT LIVES HERE AND NOT IN THE LoRA REF
 * A LoRA holds the face; it does not hold "wears a mustard-yellow raincoat and
 * carries a canvas satchel". Both halves have to be identical across episodes
 * or the character drifts in wardrobe while holding the same face, which reads
 * as a continuity error rather than a style. So the frozen appearance line is
 * part of the LOCK, stored beside the weights reference, and every keyframe
 * prompt gets both.
 *
 * Pure data + pure functions — no I/O, no provider imports — so the Convex
 * schema, the runner seed, the render blocks and the tests share one definition.
 */
import {
  applyCharacterTriggerWords,
  characterLoraRefs,
  parseCharacterLora,
  type CharacterLoraRef,
  type LoraSurface,
  type LoraSurfaceId,
  type NovitaLoraParam,
} from "@/lib/characterLora";

export const CHANNEL_CHARACTER_VERSION = "channel-character/v1" as const;

/**
 * Hard ceilings. An appearance line that runs to a paragraph stops being a lock
 * and starts being a per-episode prompt — the model will emphasise a different
 * third of it each time, which is exactly the drift this module exists to stop.
 */
export const CHARACTER_NAME_MAX_CHARS = 60;
export const CHARACTER_APPEARANCE_MIN_CHARS = 24;
export const CHARACTER_APPEARANCE_MAX_CHARS = 400;
export const CHARACTER_WARDROBE_MAX_ITEMS = 6;

export interface ChannelCharacter {
  version: typeof CHANNEL_CHARACTER_VERSION;
  /** What the character calls themselves on camera, e.g. "Chloe". */
  name: string;
  /**
   * The FROZEN appearance description. Written once, at lock time, and spliced
   * verbatim into every keyframe prompt for the life of the channel.
   */
  appearance: string;
  /**
   * Wardrobe/prop items that must be present in every episode regardless of
   * period setting (the vlogger's own kit — the satchel, the coat, the camera).
   * Kept separate from `appearance` so a period-costume directive can be added
   * around them without editing the frozen line.
   */
  signatureItems?: string[];
  /**
   * R2 key (or https URL) of the canonical reference still. Optional because a
   * LoRA-locked channel does not strictly need one, but when present it is the
   * artifact an operator compares a new episode against.
   */
  referenceImageKey?: string;
  /** Why this character is locked. Operator-facing; never read by the pipeline. */
  reason: string;
  lockedAt: number;
}

/** The identity shape this module reads. Structural, not a Convex type. */
export interface CharacterIdentityLike {
  channelCharacter?: unknown;
  characterLora?: unknown;
}

/** Where a resolved character came from, for logs and receipts. */
export type ChannelCharacterSource = "locked" | "none";

export interface ResolvedChannelCharacter {
  /** True only when a valid, parseable character lock exists. */
  locked: boolean;
  source: ChannelCharacterSource;
  character?: ChannelCharacter;
  /** The weights reference, when the channel also owns one. */
  lora?: CharacterLoraRef;
  /**
   * True when the channel declares a character but has NO usable LoRA. This is
   * a real and shippable state (prompt-only consistency), but it is materially
   * weaker, so it is surfaced rather than smoothed over.
   */
  promptOnly: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function channelCharacterDefects(value: unknown): string[] {
  const defects: string[] = [];
  const character = (value ?? {}) as Record<string, unknown>;
  if (character["version"] !== CHANNEL_CHARACTER_VERSION) {
    defects.push(`unknown channel character version "${String(character["version"])}"`);
  }
  if (!isNonEmptyString(character["name"])) {
    defects.push("channel character has no name");
  } else if ((character["name"] as string).trim().length > CHARACTER_NAME_MAX_CHARS) {
    defects.push(`channel character name exceeds ${CHARACTER_NAME_MAX_CHARS} characters`);
  }
  const appearance = character["appearance"];
  if (!isNonEmptyString(appearance)) {
    defects.push("channel character has no frozen appearance description");
  } else {
    const trimmed = (appearance as string).trim();
    if (trimmed.length < CHARACTER_APPEARANCE_MIN_CHARS) {
      defects.push(
        `channel character appearance is too thin (${trimmed.length} chars) to hold identity across episodes — ` +
          `at least ${CHARACTER_APPEARANCE_MIN_CHARS} characters of concrete, repeatable detail are required`,
      );
    }
    if (trimmed.length > CHARACTER_APPEARANCE_MAX_CHARS) {
      defects.push(
        `channel character appearance exceeds ${CHARACTER_APPEARANCE_MAX_CHARS} characters — ` +
          "a paragraph-length lock is re-interpreted differently every render, which is drift",
      );
    }
  }
  const items = character["signatureItems"];
  if (items !== undefined) {
    if (!Array.isArray(items) || items.some((item) => !isNonEmptyString(item))) {
      defects.push("signatureItems must be a list of non-empty strings");
    } else if (items.length > CHARACTER_WARDROBE_MAX_ITEMS) {
      defects.push(`signatureItems is implausibly long (max ${CHARACTER_WARDROBE_MAX_ITEMS})`);
    }
  }
  if (!isNonEmptyString(character["reason"])) {
    defects.push("channel character has no reason — an unexplained lock is an unmaintainable one");
  }
  if (typeof character["lockedAt"] !== "number" || !Number.isFinite(character["lockedAt"])) {
    defects.push("channel character has no lockedAt timestamp");
  }
  return defects;
}

/**
 * Parse a persisted character. Returns undefined on anything malformed rather
 * than throwing — the same stance `parseVoiceLock` and `parseCharacterLora`
 * take. A broken lock must degrade to "this channel has no character", not
 * brick every render; the POV lane's own gate is what refuses to ship without
 * one, and it reports the defects.
 */
export function parseChannelCharacter(value: unknown): ChannelCharacter | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (channelCharacterDefects(value).length) return undefined;
  const character = value as Record<string, unknown>;
  const items = Array.isArray(character["signatureItems"])
    ? (character["signatureItems"] as string[]).map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    version: CHANNEL_CHARACTER_VERSION,
    name: (character["name"] as string).trim(),
    appearance: (character["appearance"] as string).trim(),
    ...(items.length ? { signatureItems: items } : {}),
    ...(isNonEmptyString(character["referenceImageKey"])
      ? { referenceImageKey: (character["referenceImageKey"] as string).trim() }
      : {}),
    reason: (character["reason"] as string).trim(),
    lockedAt: character["lockedAt"] as number,
  };
}

/**
 * THE ONE FUNCTION EVERY EPISODE CALLS.
 *
 * Reads the channel's stored identity and returns the SAME answer every run.
 * Deliberately takes no topic, no episode number and no run id: if this
 * function could see the episode, something could vary the character by it.
 */
export function resolveChannelCharacter(
  identity: CharacterIdentityLike | null | undefined,
): ResolvedChannelCharacter {
  const character = parseChannelCharacter(identity?.channelCharacter);
  const lora = parseCharacterLora(identity?.characterLora);
  if (!character) return { locked: false, source: "none", promptOnly: false };
  return {
    locked: true,
    source: "locked",
    character,
    ...(lora ? { lora } : {}),
    promptOnly: !lora,
  };
}

/**
 * The identity block every keyframe prompt for this channel must carry, in a
 * FIXED field order. Order is fixed on purpose: an identity clause that appears
 * in a different position each render is a different prompt, and diffusion is
 * sensitive to exactly that.
 *
 * Returns "" when the channel has no character, so a caller can splice it
 * unconditionally without branching.
 */
export function characterPromptBlock(resolved: ResolvedChannelCharacter): string {
  const character = resolved.character;
  if (!character) return "";
  const parts = [
    `LOCKED RECURRING CHARACTER "${character.name}" — the same person in every episode of this channel.`,
    character.appearance,
    character.signatureItems?.length
      ? `Always present: ${character.signatureItems.join(", ")}.`
      : "",
    "Do not restyle, age, re-cast or reinterpret this person for the setting; only their surroundings change.",
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Apply the channel's full identity to one keyframe prompt: LoRA trigger words
 * first (they must reach the prompt or the adapter is loaded and ignored), then
 * the frozen identity block, then the shot's own content.
 *
 * FULLY IDEMPOTENT, and that is load-bearing rather than tidy. The QA repair
 * paths in src/trigger/blocks/novitaRenderBlocks.ts re-derive a prompt from a
 * failed asset's evidence and re-submit it; if this function appended a second
 * identity block each time, a repaired shot would carry the character
 * description twice and be weighted differently from every other shot in the
 * same episode — drift introduced by the anti-drift mechanism.
 */
export function applyChannelCharacterToPrompt(
  prompt: string,
  resolved: ResolvedChannelCharacter,
): string {
  const identityBlock = characterPromptBlock(resolved);
  const withIdentity = identityBlock && !prompt.includes(identityBlock)
    ? `${identityBlock}\n\n${prompt}`
    : prompt;
  return resolved.lora ? applyCharacterTriggerWords(withIdentity, resolved.lora) : withIdentity;
}

/**
 * The `loras` array for this channel's character on a given endpoint.
 *
 * A thin, deliberate delegation to `characterLoraRefs` rather than a
 * reimplementation: the endpoint-capability rule (throw rather than hand a LoRA
 * to a surface that would ignore it) is owned in exactly one place. Returns []
 * when the channel has no LoRA, which is the pre-character behaviour.
 */
export function channelCharacterLoras(
  resolved: ResolvedChannelCharacter,
  surface: LoraSurfaceId | LoraSurface,
): NovitaLoraParam[] {
  if (!resolved.lora) return [];
  return characterLoraRefs({ lora: resolved.lora, surface });
}

/**
 * THE ANTI-DRIFT ASSERT.
 *
 * Called by any block that is about to generate a frame for a character
 * channel. It proves the identity that reached the prompt is the STORED one,
 * not something an upstream step re-authored. Silent substitution is the exact
 * failure this whole module exists to make impossible — an episode with a
 * different-looking host is worse than a failed run, because it ships.
 */
export function assertChannelCharacterApplied(args: {
  resolved: ResolvedChannelCharacter;
  /** The prompt as it will actually be sent to the image endpoint. */
  prompt: string;
}): void {
  const character = args.resolved.character;
  if (!character) return;
  const prompt = args.prompt;
  if (!prompt.includes(character.appearance)) {
    throw new Error(
      `channel character lock violated: the frozen appearance for "${character.name}" is not present verbatim ` +
        "in the keyframe prompt. A character channel must never render from a re-authored description.",
    );
  }
  const triggers = args.resolved.lora?.triggerWords ?? [];
  const missing = triggers.filter(
    (word) =>
      !new RegExp(`(?:^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\w]|$)`, "i").test(prompt),
  );
  if (missing.length) {
    throw new Error(
      `channel character lock violated: LoRA trigger word(s) ${missing.join(", ")} never reached the prompt. ` +
        "The adapter would load and be ignored, and the character would silently drift.",
    );
  }
}

/** Build a lock. Exported so an operator surface has one canonical constructor. */
export function makeChannelCharacter(args: {
  name: string;
  appearance: string;
  reason: string;
  signatureItems?: string[];
  referenceImageKey?: string;
  now?: number;
}): ChannelCharacter {
  const candidate = {
    version: CHANNEL_CHARACTER_VERSION,
    name: args.name.trim(),
    appearance: args.appearance.trim(),
    ...(args.signatureItems?.length
      ? { signatureItems: args.signatureItems.map((item) => item.trim()).filter(Boolean) }
      : {}),
    ...(args.referenceImageKey ? { referenceImageKey: args.referenceImageKey.trim() } : {}),
    reason: args.reason.trim(),
    lockedAt: args.now ?? Date.now(),
  };
  const defects = channelCharacterDefects(candidate);
  if (defects.length) throw new Error(`channel character integrity: ${defects.join("; ")}`);
  return parseChannelCharacter(candidate) as ChannelCharacter;
}
