import { join } from "node:path";
import { z } from "zod";
import {
  assertCinematicTransitionReview,
  CINEMATIC_TRANSITION_MIN_SCORE,
  CINEMATIC_TRANSITION_REVIEW_VERSION,
  type CinematicTransitionReview,
} from "@/engine/cinematicTransitionReview";
import { ffprobeDuration, grabFrame } from "@/lib/ffmpeg";
import { VISION_GATE_MAX_TOKENS, visionLocal } from "@/lib/vision";

const ReviewerVerdictSchema = z.object({
  semanticContinuity: z.number().finite().min(0).max(1),
  visualProgression: z.number().finite().min(0).max(1),
  cutMotivation: z.number().finite().min(0).max(1),
  artifactFree: z.number().finite().min(0).max(1),
  textWatermarkFree: z.boolean(),
  pass: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
}).strict();

export interface CinematicTransitionGateScene {
  id: string;
  imagePrompt: string;
  motionPrompt: string;
  continuityIds?: readonly string[];
}

function parseVerdict(raw: string): z.infer<typeof ReviewerVerdictSchema> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("cinematic transition gate: reviewer returned no JSON object");
  try {
    return ReviewerVerdictSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch (error) {
    throw new Error(`cinematic transition gate: malformed reviewer verdict (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Inspect the last usable frame of one accepted LTX take beside the first
 * usable frame of the next. This is a cut gate, not another per-shot review.
 */
export async function reviewCinematicTransition(args: {
  fromScene: CinematicTransitionGateScene;
  toScene: CinematicTransitionGateScene;
  previousClipPath: string;
  nextClipPath: string;
  cutReason: string;
  tensionState: string;
  workDir: string;
}): Promise<CinematicTransitionReview> {
  const previousDuration = await ffprobeDuration(args.previousClipPath);
  if (!Number.isFinite(previousDuration) || previousDuration < 0.2) {
    throw new Error(`cinematic transition gate: ${args.fromScene.id} has no usable final frame`);
  }
  const [previousEndPath, nextStartPath] = await Promise.all([
    grabFrame(
      args.previousClipPath,
      Number(Math.max(0.03, previousDuration - Math.min(0.12, previousDuration / 8)).toFixed(3)),
      join(args.workDir, `${args.fromScene.id}-to-${args.toScene.id}-out.jpg`),
    ),
    grabFrame(args.nextClipPath, 0.08, join(args.workDir, `${args.fromScene.id}-to-${args.toScene.id}-in.jpg`)),
  ]);
  const sharedCast = (args.fromScene.continuityIds ?? [])
    .filter((id) => (args.toScene.continuityIds ?? []).includes(id));
  const raw = await visionLocal({
    prompt: [
      "You are the independent edit gate for a source-bound cinematic documentary. Inspect the supplied pixels; never assume the plan was followed.",
      "The first image is the final usable frame of the outgoing actual LTX take. The second image is the first usable frame of the incoming actual LTX take.",
      `Approved incoming cut: ${args.cutReason}; intended tension state: ${args.tensionState}.`,
      `Outgoing shot: ${args.fromScene.imagePrompt}. ${args.fromScene.motionPrompt}`,
      `Incoming shot: ${args.toScene.imagePrompt}. ${args.toScene.motionPrompt}`,
      sharedCast.length
        ? `Shared locked faceless mannequin cast: ${sharedCast.join(", ")}. Preserve visible anonymous identity treatment, wardrobe silhouette/material/palette, key props, body proportions, location and lighting across the cut unless the incoming plan explicitly motivates a change.`
        : "No mannequin is shared across this cut. Require a clear purposeful contrast, spatial progression, or evidence/reveal turn rather than an accidental duplicate or incoherent jump.",
      "Reject a replacement or morphed subject, changed visible wardrobe/prop/location without motivation, duplicate framing that stalls the story, incompatible lighting/color language, broken anatomy/geometry, real-person likeness, visible mannequin faces, gore, text/letters/logos/watermarks, or a cut that does not deliver the stated causal/tension turn.",
      `Return STRICT JSON only: {"semanticContinuity":0..1,"visualProgression":0..1,"cutMotivation":0..1,"artifactFree":0..1,"textWatermarkFree":true|false,"pass":true|false,"notes":["concrete visual observation"]}. Set pass true only when every score is at least ${CINEMATIC_TRANSITION_MIN_SCORE}, textWatermarkFree is true, and the transition is suitable for final assembly.`,
    ].join("\n"),
    imagePaths: [previousEndPath, nextStartPath],
    json: true,
    maxTokens: VISION_GATE_MAX_TOKENS,
    noCache: true,
    // Do not allow a Gemini fallback to mint a non-Google cut receipt.
    providers: ["groq", "fal"],
  });
  const verdict = parseVerdict(raw);
  if (!verdict.pass || !verdict.textWatermarkFree) {
    throw new Error(
      `cinematic transition gate failed ${args.fromScene.id} → ${args.toScene.id}: ` +
        `${verdict.notes.join("; ") || "reviewer rejected the actual cut"}`,
    );
  }
  return assertCinematicTransitionReview({
    version: CINEMATIC_TRANSITION_REVIEW_VERSION,
    reviewer: "non_google_vision",
    fromSceneId: args.fromScene.id,
    toSceneId: args.toScene.id,
    cutReason: args.cutReason,
    tensionState: args.tensionState,
    semanticContinuity: verdict.semanticContinuity,
    visualProgression: verdict.visualProgression,
    cutMotivation: verdict.cutMotivation,
    artifactFree: verdict.artifactFree,
    textWatermarkFree: verdict.textWatermarkFree,
    pass: true,
    notes: verdict.notes,
  }, {
    fromSceneId: args.fromScene.id,
    toSceneId: args.toScene.id,
    cutReason: args.cutReason,
    tensionState: args.tensionState,
  });
}
