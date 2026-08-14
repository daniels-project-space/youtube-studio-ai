import { join } from "node:path";
import { z } from "zod";
import {
  assertCinematicClipReview,
  CINEMATIC_CLIP_MIN_SCORE,
  CINEMATIC_CLIP_REVIEW_VERSION,
  type CinematicClipReview,
} from "@/engine/cinematicClipReview";
import { ffprobeDuration, grabFrame } from "@/lib/ffmpeg";
import { VISION_GATE_MAX_TOKENS, visionLocal } from "@/lib/vision";

const ReviewerVerdictSchema = z.object({
  semanticAlignment: z.number().finite().min(0).max(1),
  motionIntegrity: z.number().finite().min(0).max(1),
  continuity: z.number().finite().min(0).max(1),
  endBeat: z.number().finite().min(0).max(1),
  artifactFree: z.number().finite().min(0).max(1),
  textWatermarkFree: z.boolean(),
  pass: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
}).strict();

export interface CinematicClipGateScene {
  id: string;
  imagePrompt: string;
  motionPrompt: string;
  durationSec: number;
  continuityIds?: readonly string[];
  keyframeRequirements?: readonly string[];
}

function parseVerdict(raw: string): z.infer<typeof ReviewerVerdictSchema> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("cinematic clip gate: reviewer returned no JSON object");
  try {
    return ReviewerVerdictSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch (error) {
    throw new Error(`cinematic clip gate: malformed reviewer verdict (${error instanceof Error ? error.message : String(error)})`);
  }
}

function sampleOffsets(durationSec: number): [number, number, number] {
  if (!Number.isFinite(durationSec) || durationSec < 1) {
    throw new Error("cinematic clip gate: actual video duration is unavailable");
  }
  const edge = Math.min(0.35, Math.max(0.05, durationSec / 12));
  return [edge, Number((durationSec / 2).toFixed(3)), Number(Math.max(edge, durationSec - edge).toFixed(3))];
}

/**
 * Inspect the actual start, middle, and end frames of one LTX take. The
 * source still is evidence for continuity only; the moving frames determine
 * whether the take may enter the editor.
 */
export async function reviewCinematicClip(args: {
  scene: CinematicClipGateScene;
  stillPath: string;
  clipPath: string;
  workDir: string;
}): Promise<CinematicClipReview> {
  const actualDurationSec = await ffprobeDuration(args.clipPath);
  const offsets = sampleOffsets(actualDurationSec);
  const framePaths = await Promise.all(offsets.map((offset, index) =>
    grabFrame(args.clipPath, offset, join(args.workDir, `${args.scene.id}-clip-${index + 1}.jpg`)),
  ));
  const raw = await visionLocal({
    prompt: [
      "You are the independent final motion gate for a source-bound cinematic documentary. Inspect pixels, never assume a prompt was followed.",
      "The first supplied image is the accepted LTX source still. The next three are the actual LTX clip at start, middle, and end. Score only the moving take against that still and the requirements.",
      `Required source image: ${args.scene.imagePrompt}`,
      `Required action and camera: ${args.scene.motionPrompt}`,
      args.scene.continuityIds?.length
        ? `Locked faceless mannequin cast: ${args.scene.continuityIds.join(", ")}. Preserve their anonymous identity treatment, wardrobe silhouette/material/palette, key props, proportions, location, and lighting through the take.`
        : "No recurring cast is visible; preserve the stated environment, objects, and evidence treatment through the take.",
      args.scene.keyframeRequirements?.length
        ? `Specific shot obligations: ${args.scene.keyframeRequirements.join(" | ")}`
        : "Specific shot obligations: a causal, cinematic action with a clear ending beat.",
      "Reject frozen or near-static action when movement is required, camera motion that contradicts the instruction, broken anatomy/geometry, morphing/replaced subjects, changed wardrobe/props/location, jump cuts, impossible physical motion, real-person likeness, visible mannequin faces, gore, text/letters/logos/watermarks, or an ending that does not resolve the planned action.",
      `Return STRICT JSON only: {"semanticAlignment":0..1,"motionIntegrity":0..1,"continuity":0..1,"endBeat":0..1,"artifactFree":0..1,"textWatermarkFree":true|false,"pass":true|false,"notes":["concrete visual observation"]}. Set pass true only when every score is at least ${CINEMATIC_CLIP_MIN_SCORE}, textWatermarkFree is true, and the actual moving clip is safe to edit.`,
    ].join("\n"),
    imagePaths: [args.stillPath, ...framePaths],
    json: true,
    maxTokens: VISION_GATE_MAX_TOKENS,
    noCache: true,
    // Do not allow a Gemini fallback to mint a non-Google moving-take receipt.
    providers: ["groq", "fal"],
  });
  const verdict = parseVerdict(raw);
  if (!verdict.pass || !verdict.textWatermarkFree) {
    throw new Error(`cinematic clip gate failed ${args.scene.id}: ${verdict.notes.join("; ") || "reviewer rejected the moving take"}`);
  }
  return assertCinematicClipReview({
    version: CINEMATIC_CLIP_REVIEW_VERSION,
    reviewer: "non_google_vision",
    sceneId: args.scene.id,
    sampleOffsetsSec: offsets,
    semanticAlignment: verdict.semanticAlignment,
    motionIntegrity: verdict.motionIntegrity,
    continuity: verdict.continuity,
    endBeat: verdict.endBeat,
    artifactFree: verdict.artifactFree,
    textWatermarkFree: verdict.textWatermarkFree,
    pass: true,
    notes: verdict.notes,
  }, { sceneId: args.scene.id, sampleOffsetsSec: offsets });
}
