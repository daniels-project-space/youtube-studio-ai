import { z } from "zod";
import { STUDIO_ENGINE_ZIMAGE_WORKFLOW } from "../lib/studioRenderEngineWorkflows";

export const STUDIO_ZIMAGE_PROFILE_SHA256 = STUDIO_ENGINE_ZIMAGE_WORKFLOW.profileRevisionSha256;
const candidate = z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
  prompt: z.string().trim().min(3).max(20000), negativePrompt: z.string().trim().max(20000),
  seed: z.number().int().min(0).max(0xffffffff), width: z.number().int(), height: z.number().int() }).strict();
export const StudioZImageRequestSchema = z.object({
  version: z.literal(1), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{16,200}$/),
  sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/), profile: z.enum(["production", "hero"]),
  candidates: z.array(candidate), output: z.object({ contentType: z.literal("image/png") }).strict(),
  maxCostUsd: z.number().finite().nonnegative(), profileRevisionSha256: z.literal(STUDIO_ZIMAGE_PROFILE_SHA256),
}).strict().superRefine((request, ctx) => {
  const [width, height, count] = request.profile === "production" ? [1920, 1088, 1] : [2048, 1152, 2];
  if (request.candidates.length !== count || request.candidates.some(candidate => candidate.width !== width || candidate.height !== height) ||
    new Set(request.candidates.map(candidate => candidate.id)).size !== request.candidates.length) {
    ctx.addIssue({ code: "custom", message: "Z-Image Final geometry/candidate identity changed" });
  }
});
export type StudioZImageRequest = z.infer<typeof StudioZImageRequestSchema>;
