/**
 * characterLora — ONE job: STORE and SERVE a persistent character identity.
 *
 * A channel that stars a recurring character (a POV history vlogger, a mascot
 * presenter) needs the same face in every episode. That is a LoRA reference,
 * and this module owns exactly two things about it: what a valid reference
 * looks like, and how to hand it to something that can actually use it.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * Generate episode content. It renders no image, no video and no frame; it has
 * no provider client and makes no network call at all — the training/import
 * side lives in src/lib/novitaCharacterLora.ts, and the consumers are the
 * existing render blocks. `characterLoraWiring.test.ts` greps this file to
 * prove the separation rather than trusting the comment.
 *
 * THE ENDPOINT-CAPABILITY PROBLEM (read this before wiring a new consumer)
 * "Inject the character LoRA into the render" is only meaningful where the
 * endpoint actually accepts one. Novita's hosted Z-Image Turbo LoRA endpoint
 * does, with a documented `loras: [{path, scale}]` array. This codebase's
 * cinematic video chain does NOT: it does not call a hosted Novita i2v endpoint
 * at all, it runs LTX on its OWN GPU pods through a private bridge
 * (src/lib/novitaRenderFarm.ts), whose job payload has no LoRA field. So
 * `characterLoraRefs()` REFUSES to produce an array for a surface that cannot
 * consume one, instead of quietly returning something the caller would attach
 * to a request that ignores it. A silently-ignored LoRA is worse than an
 * unsupported one: the character drifts and nothing reports why.
 *
 * Pure data + pure functions. No I/O, no provider imports.
 */

export const CHARACTER_LORA_VERSION = "character-lora/v1" as const;

/** How the channel came to own this LoRA. */
export type CharacterLoraSource = "trained" | "imported";

export interface CharacterLoraRef {
  version: typeof CHARACTER_LORA_VERSION;
  /**
   * The Novita model-hub path (or hosted .safetensors URL) the `loras[].path`
   * parameter expects. Verbatim — this module never rewrites it, because a
   * path Novita cannot resolve fails the whole generation and a "helpful"
   * normalization is how that happens.
   */
  novitaLoraPath: string;
  /** Merge weight. Novita documents the accepted range as [0, 4]. */
  scale: number;
  /** Tokens the base model needs in the prompt to summon the character. */
  triggerWords?: string[];
  source: CharacterLoraSource;
  /** Novita training task id — present only for `source: "trained"`. */
  trainingTaskId?: string;
  /** One line on who the character is. Operator-facing only. */
  character?: string;
  createdAt: number;
}

/** Novita documents a hard maximum of 3 LoRAs per request. */
export const CHARACTER_LORA_MAX_REFS = 3;
export const CHARACTER_LORA_MIN_SCALE = 0;
export const CHARACTER_LORA_MAX_SCALE = 4;
/** A sane default: strong enough to hold identity, low enough to obey the prompt. */
export const CHARACTER_LORA_DEFAULT_SCALE = 0.8;

/**
 * Size ceiling for an IMPORTED .safetensors URL. A character LoRA is a small
 * adapter (tens of MB); anything approaching a full checkpoint is either the
 * wrong file or an unvetted download, and this module is not a place to find
 * that out at render time.
 */
export const CHARACTER_LORA_MAX_IMPORT_BYTES = 512 * 1024 * 1024;

/**
 * Where a LoRA reference can actually be used, and on what evidence.
 *
 * `verified` is deliberately explicit. "docs" means the parameter is documented
 * by the provider but has NOT been exercised against a live key from this
 * codebase; "code" means this repository already calls it. Nothing here claims
 * more confidence than it has.
 */
export interface LoraSurface {
  id: string;
  /** Whether the endpoint accepts a LoRA list at all. */
  supportsLoras: boolean;
  /** The request field name, when supported. */
  parameter?: string;
  maxLoras?: number;
  verified: "docs" | "code" | "unsupported";
  note: string;
}

export const LORA_SURFACES: Readonly<Record<string, LoraSurface>> = {
  /**
   * POST https://api.novita.ai/v3/async/z-image-turbo-lora
   * Documented: `loras` array, max 3, each `{ path, scale }`, scale range [0,4].
   */
  z_image_turbo_lora: {
    id: "z_image_turbo_lora",
    supportsLoras: true,
    parameter: "loras",
    maxLoras: CHARACTER_LORA_MAX_REFS,
    verified: "docs",
    note:
      "Novita hosted Z-Image Turbo LoRA endpoint. `loras: [{path, scale}]`, max 3, scale [0,4]. " +
      "Parameter shape taken from Novita's published API reference; not yet exercised against a live key from this repo.",
  },
  /**
   * The chain the `cinematic` family actually runs today.
   *
   * KNOWN LIMITATION, stated rather than papered over: this repository does not
   * call a hosted Novita image-to-video endpoint. `novita_render_video` posts to
   * a private nginx bridge on Novita GPU INSTANCES running LTX locally
   * (src/lib/novitaRenderFarm.ts videoJobs()), and that job payload has no LoRA
   * field. Character identity in that chain is currently held by the Visual
   * Matter reference sheets and the qa_assets identity floor, not by a LoRA.
   *
   * TO ADD IT LATER, one of:
   *   (a) extend the bridge's video job schema with a lora list and load the
   *       adapter on the pod (the weights already live on the pod's persistent
   *       disk, so this is the smaller change), or
   *   (b) move that chain onto a hosted i2v endpoint that documents a `loras`
   *       parameter — which would also change the cost model, the attestation
   *       chain and the spot-worker lifecycle, so it is not a drop-in.
   */
  novita_bridge_i2v: {
    id: "novita_bridge_i2v",
    supportsLoras: false,
    verified: "unsupported",
    note:
      "Self-hosted LTX on Novita GPU instances via the private render bridge. The bridge video job schema " +
      "(novitaRenderFarm.videoJobs) has no LoRA field, so a character LoRA cannot be injected here today. " +
      "See this entry's source comment for the two ways to add it. NOTE: for a character channel this is " +
      "NOT the blocker it looks like — see novita_bridge_image below.",
  },
  /**
   * THE KEYFRAME SURFACE THE CINEMATIC CHAIN ACTUALLY USES, recorded because
   * its absence from this table was itself misleading.
   *
   * `novita_render_images` does NOT call Novita's hosted Z-Image Turbo LoRA
   * endpoint. Like the video step, it posts to the private nginx bridge on
   * Novita GPU instances (novitaRenderFarm.imageJobs), whose job payload is
   * `{id, prompt, negative, width, height, steps, cfg, seed}` — no `loras`
   * field. So the LoRA-capable surface (`z_image_turbo_lora`) and the surface
   * this repository's cinematic chain currently renders on are two DIFFERENT
   * endpoints, and only the first accepts an adapter.
   *
   * WHY THIS MATTERS MORE THAN THE VIDEO GAP
   * Identity in this chain is established at the STILL and then carried, not
   * re-generated: `novita_render_video` consumes `selectedStillManifest` and
   * sets each shot's `stillKey`, and `src/lib/i2v.ts` refuses to run at all
   * without an input image. The video step animates a frame that is already
   * correct. Therefore a character LoRA is only ever needed on the KEYFRAME
   * surface — and the fix is to render a character channel's keyframes on
   * `z_image_turbo_lora` (which documents `loras`), feeding the unchanged
   * qa_assets → novita_render_video → qa_shots chain. No video-side LoRA
   * support is required for cross-episode consistency.
   */
  novita_bridge_image: {
    id: "novita_bridge_image",
    supportsLoras: false,
    verified: "unsupported",
    note:
      "Self-hosted Z-Image on Novita GPU instances via the private render bridge. novitaRenderFarm.imageJobs " +
      "emits no `loras` field, so an adapter cannot be injected here. A character channel must render its " +
      "keyframes on the hosted `z_image_turbo_lora` surface instead; the downstream i2v chain needs no change " +
      "because it is conditioned on the selected still, not on a text prompt.",
  },
};

export type LoraSurfaceId = keyof typeof LORA_SURFACES;

export class CharacterLoraUnsupportedSurfaceError extends Error {
  readonly surfaceId: string;

  constructor(surface: LoraSurface) {
    super(
      `character LoRA cannot be applied to "${surface.id}": ${surface.note} ` +
        "Refusing to return a loras array for an endpoint that would ignore it.",
    );
    this.name = "CharacterLoraUnsupportedSurfaceError";
    this.surfaceId = surface.id;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A path is either a Novita model-hub identifier or an https .safetensors URL.
 * Anything else (http, a local path, a bare filename with no extension) is
 * rejected: an unresolvable path fails the generation on the provider side,
 * where the error is far less legible than it is here.
 */
export function loraPathDefects(path: unknown): string[] {
  if (!isNonEmptyString(path)) return ["lora path is empty"];
  const trimmed = path.trim();
  if (trimmed !== path) return ["lora path has surrounding whitespace"];
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return [`lora path "${trimmed}" is not a parseable URL`];
    }
    const defects: string[] = [];
    if (url.protocol !== "https:") defects.push("an imported lora URL must be https");
    if (!url.pathname.toLowerCase().endsWith(".safetensors")) {
      defects.push("an imported lora URL must point at a .safetensors file");
    }
    return defects;
  }
  // Hub identifier form, e.g. "model_1699325939_E83A88DAC5.safetensors" or an
  // owner/name path. Kept permissive on shape, strict on obvious junk.
  if (/\s/.test(trimmed)) return ["a lora hub path must not contain whitespace"];
  if (trimmed.length > 512) return ["lora path is implausibly long"];
  return [];
}

export function characterLoraDefects(value: unknown): string[] {
  const defects: string[] = [];
  const ref = (value ?? {}) as Record<string, unknown>;
  if (ref["version"] !== CHARACTER_LORA_VERSION) {
    defects.push(`unknown character lora version "${String(ref["version"])}"`);
  }
  defects.push(...loraPathDefects(ref["novitaLoraPath"]));
  const scale = ref["scale"];
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    defects.push("character lora has a non-finite scale");
  } else if (scale < CHARACTER_LORA_MIN_SCALE || scale > CHARACTER_LORA_MAX_SCALE) {
    defects.push(
      `character lora scale ${scale} is outside Novita's documented [${CHARACTER_LORA_MIN_SCALE}, ${CHARACTER_LORA_MAX_SCALE}] range`,
    );
  }
  if (ref["source"] !== "trained" && ref["source"] !== "imported") {
    defects.push(`unknown character lora source "${String(ref["source"])}"`);
  }
  if (ref["source"] === "trained" && !isNonEmptyString(ref["trainingTaskId"])) {
    defects.push("a trained character lora must record the training task id that produced it");
  }
  const triggers = ref["triggerWords"];
  if (triggers !== undefined) {
    if (!Array.isArray(triggers) || triggers.some((word) => !isNonEmptyString(word))) {
      defects.push("triggerWords must be a list of non-empty strings");
    } else if (triggers.length > 8) {
      defects.push("triggerWords is implausibly long (max 8)");
    }
  }
  if (typeof ref["createdAt"] !== "number" || !Number.isFinite(ref["createdAt"])) {
    defects.push("character lora has no createdAt timestamp");
  }
  return defects;
}

/**
 * Parse a persisted reference. Returns undefined on anything malformed rather
 * than throwing: a broken reference must degrade to "this channel has no
 * character", not brick every render. The consumers below then simply produce
 * an empty array, which is the pre-LoRA behaviour.
 */
export function parseCharacterLora(value: unknown): CharacterLoraRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (characterLoraDefects(value).length) return undefined;
  const ref = value as Record<string, unknown>;
  return {
    version: CHARACTER_LORA_VERSION,
    novitaLoraPath: ref["novitaLoraPath"] as string,
    scale: ref["scale"] as number,
    ...(Array.isArray(ref["triggerWords"]) && ref["triggerWords"].length
      ? { triggerWords: (ref["triggerWords"] as string[]).map((word) => word.trim()) }
      : {}),
    source: ref["source"] as CharacterLoraSource,
    ...(isNonEmptyString(ref["trainingTaskId"]) ? { trainingTaskId: ref["trainingTaskId"] as string } : {}),
    ...(isNonEmptyString(ref["character"]) ? { character: (ref["character"] as string).trim() } : {}),
    createdAt: ref["createdAt"] as number,
  };
}

export function assertCharacterLoraRef(value: unknown): CharacterLoraRef {
  const defects = characterLoraDefects(value);
  if (defects.length) throw new Error(`character lora integrity: ${defects.join("; ")}`);
  return parseCharacterLora(value) as CharacterLoraRef;
}

/** The exact wire shape Novita's LoRA-capable endpoints accept. */
export interface NovitaLoraParam {
  path: string;
  scale: number;
}

/**
 * THE CONSUMPTION CONTRACT — the one function other blocks call.
 *
 * Returns the `loras` array for this channel's character, ready to splice into
 * a request. Deliberately:
 *   • returns [] (not a throw) when the channel simply has no character — a
 *     channel without one is the normal case, not an error;
 *   • THROWS when the channel HAS a character but the target endpoint cannot
 *     accept it, because silently dropping it produces a video with the wrong
 *     face and no explanation;
 *   • caps at the provider's documented maximum and clamps the scale, so a
 *     stored value can never produce a request Novita will reject.
 */
export function characterLoraRefs(args: {
  /** The persisted channel identity value; anything unparseable is "no character". */
  lora: unknown;
  /** Which endpoint the array is destined for. */
  surface: LoraSurfaceId | LoraSurface;
}): NovitaLoraParam[] {
  const ref = parseCharacterLora(args.lora);
  if (!ref) return [];
  const surface = typeof args.surface === "string" ? LORA_SURFACES[args.surface] : args.surface;
  if (!surface) {
    throw new Error(`character LoRA: unknown target surface "${String(args.surface)}"`);
  }
  if (!surface.supportsLoras) throw new CharacterLoraUnsupportedSurfaceError(surface);
  const scale = Math.max(
    CHARACTER_LORA_MIN_SCALE,
    Math.min(CHARACTER_LORA_MAX_SCALE, ref.scale),
  );
  return [{ path: ref.novitaLoraPath, scale }].slice(
    0,
    Math.max(1, Math.min(CHARACTER_LORA_MAX_REFS, surface.maxLoras ?? CHARACTER_LORA_MAX_REFS)),
  );
}

/** True when a surface can take this channel's character at all. Never throws. */
export function canApplyCharacterLora(lora: unknown, surface: LoraSurfaceId | LoraSurface): boolean {
  if (!parseCharacterLora(lora)) return false;
  const resolved = typeof surface === "string" ? LORA_SURFACES[surface] : surface;
  return Boolean(resolved?.supportsLoras);
}

/**
 * Prepend the character's trigger words to a prompt. A LoRA whose trigger token
 * never reaches the prompt is loaded and then ignored, which looks identical to
 * "the LoRA is bad" — so this exists to make the pairing hard to forget.
 * Idempotent: re-applying it to an already-prefixed prompt changes nothing.
 */
export function applyCharacterTriggerWords(prompt: string, lora: unknown): string {
  const ref = parseCharacterLora(lora);
  const triggers = ref?.triggerWords ?? [];
  if (triggers.length === 0) return prompt;
  const missing = triggers.filter(
    (word) => !new RegExp(`(?:^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\w]|$)`, "i").test(prompt),
  );
  if (missing.length === 0) return prompt;
  return `${missing.join(", ")}, ${prompt}`;
}

/** Build a reference from a completed training run. */
export function makeTrainedCharacterLora(args: {
  novitaLoraPath: string;
  trainingTaskId: string;
  scale?: number;
  triggerWords?: string[];
  character?: string;
  now?: number;
}): CharacterLoraRef {
  return assertCharacterLoraRef({
    version: CHARACTER_LORA_VERSION,
    novitaLoraPath: args.novitaLoraPath.trim(),
    scale: args.scale ?? CHARACTER_LORA_DEFAULT_SCALE,
    ...(args.triggerWords?.length ? { triggerWords: args.triggerWords } : {}),
    source: "trained",
    trainingTaskId: args.trainingTaskId,
    ...(args.character ? { character: args.character } : {}),
    createdAt: args.now ?? Date.now(),
  });
}

/**
 * Build a reference from a pre-vetted external LoRA. `sizeBytes` is required
 * for a hosted URL because the ceiling is the only structural check available
 * on a file this repository did not produce.
 */
export function makeImportedCharacterLora(args: {
  novitaLoraPath: string;
  sizeBytes?: number;
  scale?: number;
  triggerWords?: string[];
  character?: string;
  now?: number;
}): CharacterLoraRef {
  const path = args.novitaLoraPath.trim();
  if (/^https?:\/\//i.test(path)) {
    if (!Number.isFinite(args.sizeBytes) || (args.sizeBytes ?? 0) <= 0) {
      throw new Error(
        "character lora import: a hosted .safetensors URL must be imported with its verified size in bytes",
      );
    }
    if ((args.sizeBytes as number) > CHARACTER_LORA_MAX_IMPORT_BYTES) {
      throw new Error(
        `character lora import: ${args.sizeBytes} bytes exceeds the ${CHARACTER_LORA_MAX_IMPORT_BYTES}-byte ceiling — ` +
          "a character adapter this large is either the wrong file or an unvetted checkpoint",
      );
    }
  }
  return assertCharacterLoraRef({
    version: CHARACTER_LORA_VERSION,
    novitaLoraPath: path,
    scale: args.scale ?? CHARACTER_LORA_DEFAULT_SCALE,
    ...(args.triggerWords?.length ? { triggerWords: args.triggerWords } : {}),
    source: "imported",
    ...(args.character ? { character: args.character } : {}),
    createdAt: args.now ?? Date.now(),
  });
}
