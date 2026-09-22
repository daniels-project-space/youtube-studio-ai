import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const text = z.string().trim().min(1).max(4000);
const texts = z.array(text).max(64);
export const LoopVisualIdentitySchema = z.object({
  recurringSubject: text, setting: text,
  signatureScenes: z.array(z.object({ name: text, setting: text, motion: text })).max(64).optional(),
  composition: z.string().max(4000).optional(), colorGrade: z.string().max(4000).optional(),
  motifs: texts.optional(), visualAvoid: texts.optional(), motionVocabulary: texts.optional(),
  motionDiscipline: z.string().max(4000).optional(),
});

export function resolveLoopVisualIdentity(topic: string, value: unknown) {
  const dna = LoopVisualIdentitySchema.parse(value);
  const choices = dna.signatureScenes ?? [];
  const seed = sha256Hex(canonicalJson({ topic: topic.trim(), subject: dna.recurringSubject, choices }));
  const choice = choices.length ? choices[Number.parseInt(seed.slice(0, 12), 16) % choices.length] : undefined;
  return { ...dna, signatureScenes: [], setting: choice?.setting ?? dna.setting,
    motionVocabulary: choice ? [choice.motion] : dna.motionVocabulary };
}

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const LoopVisualPlanningParamsSchema = z.object({
  clipDurationSec: z.union([z.number().finite(), z.string().max(64)]).optional(),
  visualStyle: z.string().max(4000).optional(), setting: z.string().max(4000).optional(),
  sceneLibrary: z.record(z.string(), z.object({ fluxPrompt: text, klingMotionPrompt: text,
    durationSec: z.number().finite().positive().optional(), musicPrompt: z.string().max(4000).optional() }).strict()).optional(),
}).strict();
const bodySchema = z.object({
  version: z.literal("loop-visual-plan/v1"), ownerId: text, channelId: text, runId: text, topic: text,
  inputFingerprint: fingerprint, programFingerprint: fingerprint.nullable(),
  planningParams: LoopVisualPlanningParamsSchema,
  authority: z.enum(["channel_identity", "authored_library", "music_program"]),
  identity: LoopVisualIdentitySchema.strict(),
  scene: z.object({ fluxPrompt: text, klingMotionPrompt: text, durationSec: z.number().finite().positive() }).strict(),
}).strict();
export function loopVisualPlanFingerprint(value: z.infer<typeof bodySchema>) {
  return sha256Hex(canonicalJson(bodySchema.parse(value)));
}
export const LoopVisualPlanSchema = bodySchema.extend({ fingerprint }).superRefine((value, ctx) => {
  const { fingerprint: actual, ...body } = value;
  if (actual !== loopVisualPlanFingerprint(body)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "loop visual plan fingerprint mismatch" });
});

export const LoopKeyframeDirectionSchema = z.object({
  version: z.literal("loop-keyframe-direction/v1"),
  ownerId: text, channelId: text, runId: text,
  visualPlanFingerprint: fingerprint,
  f1Key: text,
  motionPrompt: z.string().max(1000).refine(value => value.trim().length > 12, "A reviewed motion sentence is required"),
  reviewProfile: z.literal("production"),
}).strict();
