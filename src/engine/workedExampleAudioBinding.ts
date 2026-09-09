/** Held arithmetic audio integrity linkage, not provider authorization or pronunciation QA. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { elevenLabsV3StitchEnabled } from "@/lib/tts";
import type { CachedOutputValidationContext } from "./types";
import { assertWorkedExampleEditorialApproval, assertWorkedExampleNarrationBinding, workedExampleEditorialApprovalFor } from "./workedExampleNarration";

export const WORKED_EXAMPLE_AUDIO_BINDING_VERSION = "worked-example-audio-source/v1" as const;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fingerprint = (value: unknown) => digest(canonicalJson(value));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
export const WorkedExampleAudioBindingSchema = z.object({
  version: z.literal(WORKED_EXAMPLE_AUDIO_BINDING_VERSION),
  preparationFingerprint: sha,
  scriptFingerprint: sha,
  inputFingerprint: sha,
  spokenSequence: z.array(z.string().min(1).max(8192)).min(1).max(256),
  artifact: z.object({ key: z.string().min(1).max(1024), sha256: sha, byteLength: z.number().int().positive().max(MAX_AUDIO_BYTES) }).strict(),
  timingFingerprint: sha,
}).strict();
export type WorkedExampleAudioBinding = z.infer<typeof WorkedExampleAudioBindingSchema>;

/** Closed list of narration_tts declared inputs; changes must update this policy and its tests.
 * All params are bound conservatively, not a second provider-setting resolver. */
export const WORKED_EXAMPLE_TTS_INPUT_KEYS = [
  "narrationText", "scriptApproved", "styleDNA", "musicBrief", "script", "voiceId", "niche",
  "workedExampleRequest", "workedExamplePreparation", "workedExampleEditorialApproval",
] as const;
type InputContext = Pick<CachedOutputValidationContext, "ownerId" | "channelId" | "runId" | "keyPrefix" | "store" | "params">;

function assertNonSecretJson(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("arithmetic TTS inputs exceed JSON depth limit");
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const child of value) assertNonSecretJson(child, depth + 1); return; }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("arithmetic TTS inputs must be finite plain JSON");
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:.*api[_-]?key|.*(?:access|refresh|auth|bearer|worker)[_-]?token|token|password|.*secret|.*credential.*|authorization)$/i.test(key)) {
      throw new Error("arithmetic TTS inputs cannot include credential-like fields");
    }
    assertNonSecretJson(child, depth + 1);
  }
}

export function currentWorkedExampleScript(ctx: InputContext) {
  return assertWorkedExampleNarrationBinding({
    request: ctx.store.workedExampleRequest, preparation: ctx.store.workedExamplePreparation,
    script: ctx.store.script, narrationText: ctx.store.narrationText,
    ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
  });
}

function currentInputBinding(ctx: InputContext) {
  const script = currentWorkedExampleScript(ctx);
  if (!script) throw new Error("arithmetic audio binding has no current verified script");
  if (ctx.store.scriptApproved !== true) throw new Error("arithmetic audio binding requires current independent script approval");
  assertWorkedExampleEditorialApproval(ctx.store.workedExampleEditorialApproval, script);
  const inputs = Object.fromEntries(WORKED_EXAMPLE_TTS_INPUT_KEYS.map((key) => [key, ctx.store[key]]));
  const source = { policy: WORKED_EXAMPLE_AUDIO_BINDING_VERSION,
    ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId, keyPrefix: ctx.keyPrefix,
    inputs, params: ctx.params, runtimeControls: { elevenLabsV3Stitch: elevenLabsV3StitchEnabled() } };
  assertNonSecretJson(source);
  if (canonicalJson(source).length > 1024 * 1024) throw new Error("arithmetic TTS inputs exceed binding size limit");
  return { ...workedExampleEditorialApprovalFor(script), inputFingerprint: fingerprint(source) };
}

/** Validate representable, non-secret current controls before any fresh paid request. */
export function assertWorkedExampleTtsBindingInputs(ctx: InputContext): void {
  currentInputBinding(ctx);
}

function timingFingerprint(outputs: Readonly<Record<string, unknown>>): string {
  const duration = outputs.narrationDurationSec;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new Error("arithmetic audio duration is not measured positive finite metadata");
  const timing = {
    narrationDurationSec: duration, narrationTranscriptText: outputs.narrationTranscriptText,
    narrationPerformanceEvidence: outputs.narrationPerformanceEvidence,
    sentenceTimings: outputs.sentenceTimings, chapterPlan: outputs.chapterPlan,
  };
  assertNonSecretJson(timing);
  return fingerprint(timing);
}

/** Call only after actual fresh TTS, final local evidence and upload completion.
 * `bytes` must be the SAME finalized bytes supplied to that upload, never a transcript.
 * Exported hashing is not an authorization boundary: consumers still check active inputs and bytes. */
export function createWorkedExampleAudioBinding(ctx: InputContext, outputs: Readonly<Record<string, unknown>>, spokenSequence: readonly string[], bytes: Uint8Array): WorkedExampleAudioBinding {
  const current = currentInputBinding(ctx);
  const expectedKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
  if (outputs.narrationKey !== expectedKey) throw new Error("arithmetic audio source key differs from the active caller");
  return WorkedExampleAudioBindingSchema.parse({
    version: WORKED_EXAMPLE_AUDIO_BINDING_VERSION,
    preparationFingerprint: current.preparationFingerprint, scriptFingerprint: current.scriptFingerprint,
    inputFingerprint: current.inputFingerprint, spokenSequence,
    artifact: { key: expectedKey, sha256: digest(bytes), byteLength: bytes.byteLength },
    timingFingerprint: timingFingerprint(outputs),
  });
}

/** Pure current-input admission must precede audio GET/hash work. */
export function assertWorkedExampleAudioMetadata(ctx: CachedOutputValidationContext, spokenSequence: readonly string[]): WorkedExampleAudioBinding {
  const binding = WorkedExampleAudioBindingSchema.parse(ctx.outputs.workedExampleAudioBinding);
  const current = currentInputBinding(ctx);
  if (binding.preparationFingerprint !== current.preparationFingerprint || binding.scriptFingerprint !== current.scriptFingerprint || binding.inputFingerprint !== current.inputFingerprint) {
    throw new Error("cached arithmetic audio does not match current script, preparation or synthesis inputs");
  }
  if (canonicalJson(binding.spokenSequence) !== canonicalJson(spokenSequence)) throw new Error("cached arithmetic audio spoken sequence differs from current synthesis");
  const expectedKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
  if (binding.artifact.key !== expectedKey || ctx.outputs.narrationKey !== expectedKey) throw new Error("cached arithmetic audio source key differs from active output");
  if (binding.timingFingerprint !== timingFingerprint(ctx.outputs)) throw new Error("cached arithmetic audio timing/transcript metadata changed");
  return binding;
}

/** Rehydration materializes the current local consumer bytes; HEAD existence alone is insufficient.
 * An already-present matching local file does NOT independently verify a mutable remote object. */
export async function assertWorkedExampleAudioBytes(ctx: CachedOutputValidationContext, spokenSequence: readonly string[]): Promise<void> {
  const binding = assertWorkedExampleAudioMetadata(ctx, spokenSequence);
  const path = ctx.outputs.narrationLocalPath;
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("cached arithmetic audio has no materialized local source");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== binding.artifact.byteLength) throw new Error("cached arithmetic audio byte length or file type differs");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.byteLength !== binding.artifact.byteLength || digest(bytes) !== binding.artifact.sha256) {
      throw new Error("cached arithmetic audio bytes differ from fresh completion binding");
    }
  } finally { await file.close(); }
}
