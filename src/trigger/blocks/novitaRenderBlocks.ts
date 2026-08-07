/**
 * Story-aligned Novita generation chain.
 *
 * Every transition is an explicit, validated artifact:
 *   shot plan -> still candidates -> selected stills -> clips -> shot QA.
 * No caller infers shot identity from array order and no production render may
 * override the immutable model/profile contract.
 */
import { join } from "node:path";
import { z } from "zod";

import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import { PRICE } from "@/engine/pricing";
import {
  AssetQaReportSchema,
  SelectedStillManifestSchema,
  ShotQaReportSchema,
  ShotRenderManifestSchema,
  StillRenderManifestSchema,
  VisualCoverageSchema,
  type SelectedStillManifest,
  type ShotRenderManifest,
  type StillRenderManifest,
} from "@/engine/renderArtifacts";
import { DPVisualSpecSchema, ShotPlanSchema, type ShotPlan } from "@/engine/storySpine";
import type { Block } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { makeRunTempDir, writeBytes } from "@/lib/files";
import { grabFrame, probe } from "@/lib/ffmpeg";
import { parseJsonLoose } from "@/lib/gemini";
import {
  renderImages,
  renderVideo,
  secondsToFrames,
  toNovitaPhaseProfile,
  type NovitaRenderCfg,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { getObjectBytes } from "@/lib/storage";
import { visionLocal } from "@/lib/vision";

const EPSILON = 0.02;

type DpVisualSpec = z.infer<typeof DPVisualSpecSchema>;

const AssetCandidateGradeSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  semanticAlignment: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  artifactFree: z.number().min(0).max(1),
  notes: z.array(z.string()).max(8),
}).strict();

const AssetCandidateSetGradeSchema = z.object({
  candidates: z.array(AssetCandidateGradeSchema).min(1).max(4),
}).strict();

const ShotGradeSchema = z.object({
  semanticAlignment: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  motionIntegrity: z.number().min(0).max(1),
  artifactFree: z.number().min(0).max(1),
  notes: z.array(z.string()).max(8),
}).strict();

function requireStoryInputs(store: Readonly<Record<string, unknown>>): {
  shots: ShotPlan[];
  specs: DpVisualSpec[];
  specsByShot: Map<string, DpVisualSpec>;
} {
  const shots = z.array(ShotPlanSchema).min(1).parse(store["shotList"]);
  const specs = z.array(DPVisualSpecSchema).min(1).parse(store["dpVisualSpecs"]);
  const specsByShot = new Map<string, DpVisualSpec>();
  for (const spec of specs) {
    if (specsByShot.has(spec.shotId)) throw new Error(`duplicate DP visual spec for ${spec.shotId}`);
    specsByShot.set(spec.shotId, spec);
  }
  const shotIds = new Set(shots.map((shot) => shot.id));
  const missing = shots.filter((shot) => !specsByShot.has(shot.id)).map((shot) => shot.id);
  const extra = specs.filter((spec) => !shotIds.has(spec.shotId)).map((spec) => spec.shotId);
  if (missing.length || extra.length) {
    throw new Error(`story render inputs are not one-to-one (missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"})`);
  }
  return { shots, specs, specsByShot };
}

function profileForShots(shots: ShotPlan[], requested: unknown): GenerationProfile {
  const requestedId = requested ?? shots[0]?.generationProfile;
  const profile = generationProfile(requestedId);
  const mismatched = shots.filter((shot) => shot.generationProfile !== profile.id).map((shot) => shot.id);
  if (mismatched.length) {
    throw new Error(`generation profile ${profile.id} conflicts with planned shots: ${mismatched.join(", ")}`);
  }
  return profile;
}

function generationIdentity(profile: GenerationProfile, phase: "image" | "video") {
  const settings = profile[phase];
  return {
    contractVersion: profile.contractVersion,
    profileId: profile.id,
    model: settings.model,
    revision: settings.revision,
    checkpoint: settings.checkpoint,
    precision: settings.precision,
    width: settings.width,
    height: settings.height,
    steps: settings.steps,
    allowFallback: false as const,
  };
}

function assertExactStillCandidates(shots: ShotPlan[], manifest: StillRenderManifest): void {
  const expectedIds = new Set(shots.map((shot) => shot.id));
  const seenOutputs = new Set<string>();
  const seenKeys = new Set<string>();
  for (const item of manifest.items) {
    if (!expectedIds.has(item.shotId)) throw new Error(`still manifest contains unknown shot ${item.shotId}`);
    if (seenOutputs.has(item.outputId)) throw new Error(`still manifest contains duplicate output ${item.outputId}`);
    if (seenKeys.has(item.stillKey)) throw new Error(`still manifest contains duplicate key ${item.stillKey}`);
    seenOutputs.add(item.outputId);
    seenKeys.add(item.stillKey);
  }
  for (const shot of shots) {
    const items = manifest.items
      .filter((item) => item.shotId === shot.id)
      .sort((a, b) => a.candidateIndex - b.candidateIndex);
    if (items.length !== shot.candidateCount) {
      throw new Error(`shot ${shot.id} expected ${shot.candidateCount} still candidate(s), received ${items.length}`);
    }
    items.forEach((item, index) => {
      if (item.candidateIndex !== index) {
        throw new Error(`shot ${shot.id} has non-contiguous candidate indexes`);
      }
    });
  }
}

function assertExactShotManifest(shots: ShotPlan[], manifest: ShotRenderManifest): void {
  if (manifest.items.length !== shots.length) {
    throw new Error(`shot render manifest expected ${shots.length} item(s), received ${manifest.items.length}`);
  }
  const seen = new Set<string>();
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const item = manifest.items[index];
    if (item.shotId !== shot.id) throw new Error(`shot render order mismatch at ${index}: ${item.shotId} !== ${shot.id}`);
    if (seen.has(item.shotId)) throw new Error(`shot render manifest duplicates ${item.shotId}`);
    seen.add(item.shotId);
    if (Math.abs(item.t0 - shot.t0) > EPSILON || Math.abs(item.t1 - shot.t1) > EPSILON) {
      throw new Error(`shot render timecode mismatch for ${shot.id}`);
    }
    if (item.sourceSentenceIds.join("\u0000") !== shot.sourceSentenceIds.join("\u0000")) {
      throw new Error(`shot render source lineage mismatch for ${shot.id}`);
    }
    if (item.continuityState !== shot.continuityState) {
      throw new Error(`shot render continuity mismatch for ${shot.id}`);
    }
    if (index === 0 && Math.abs(item.t0) > EPSILON) throw new Error("shot render coverage must begin at 0");
    if (index > 0 && Math.abs(item.t0 - manifest.items[index - 1].t1) > EPSILON) {
      throw new Error(`shot render coverage gap or overlap before ${shot.id}`);
    }
  }
  if (Math.abs(manifest.items.at(-1)!.t1 - manifest.durationSec) > EPSILON) {
    throw new Error("shot render coverage does not end at manifest duration");
  }
}

function imageScore(grade: z.infer<typeof AssetCandidateGradeSchema>): number {
  return Number((grade.semanticAlignment * 0.45 + grade.continuity * 0.3 + grade.artifactFree * 0.25).toFixed(4));
}

function videoScore(grade: z.infer<typeof ShotGradeSchema>): number {
  return Number((grade.semanticAlignment * 0.35 + grade.continuity * 0.25 + grade.motionIntegrity * 0.25 + grade.artifactFree * 0.15).toFixed(4));
}

export const novitaRenderImages: Block = {
  id: "novita_render_images",
  consumes: ["shotList", "dpVisualSpecs"],
  produces: ["stillKeys", "stillRenderManifest"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const profile = profileForShots(shots, ctx.params["generationProfile"]);
    const renderShots: Shot[] = shots.map((shot) => {
      const spec = specsByShot.get(shot.id)!;
      return {
        ...shot,
        prompt: spec.keyframePrompt,
        negative: spec.negativePrompt,
      };
    });
    const cfg: NovitaRenderCfg = {
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/novita`,
      shots: renderShots,
      profile: toNovitaPhaseProfile(profile, "image"),
      style: ctx.params["style"] as string | undefined,
      negative: ctx.params["negative"] as string | undefined,
      director: ctx.params["director"] as string | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
    };
    const result = await renderImages(cfg);
    if (!result.candidates?.length) throw new Error("novita_render_images returned no exact candidate mapping");
    const stillRenderManifest = StillRenderManifestSchema.parse({
      version: "1.0.0",
      generation: generationIdentity(profile, "image"),
      items: result.candidates.map((candidate) => ({
        shotId: candidate.shotId,
        candidateIndex: candidate.candidateIndex,
        outputId: candidate.outputId,
        stillKey: candidate.key,
      })),
    });
    assertExactStillCandidates(shots, stillRenderManifest);
    ctx.log(`novita_render_images: ${result.outputs} pinned still candidate(s) in ${result.durationSec}s`);
    return {
      stillKeys: stillRenderManifest.items.map((item) => item.stillKey),
      stillRenderManifest,
      [COST_PATCH_KEY]: result.costUsd,
    };
  },
};

export const qaAssets: Block = {
  id: "qa_assets",
  consumes: ["shotList", "dpVisualSpecs", "stillRenderManifest"],
  produces: ["selectedStillManifest", "assetQaReport"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const manifest = StillRenderManifestSchema.parse(ctx.store["stillRenderManifest"]);
    assertExactStillCandidates(shots, manifest);
    profileForShots(shots, manifest.generation.profileId);
    const tmp = await makeRunTempDir(`${ctx.runId}_asset_qa`);
    const selected: SelectedStillManifest["items"] = [];

    for (const shot of shots) {
      const candidates = manifest.items
        .filter((item) => item.shotId === shot.id)
        .sort((a, b) => a.candidateIndex - b.candidateIndex);
      const paths: string[] = [];
      for (const candidate of candidates) {
        const path = join(tmp, `${shot.id}_c${String(candidate.candidateIndex).padStart(2, "0")}.png`);
        await writeBytes(path, await getObjectBytes(candidate.stillKey));
        paths.push(path);
      }
      const spec = specsByShot.get(shot.id)!;
      const raw = await visionLocal({
        prompt:
          `You are the REQUIRED keyframe grader for one authored documentary shot. ` +
          `Images are candidateIndex 0..${candidates.length - 1} in that exact order.\n` +
          `Literal story content: ${shot.literalContent}\nStory purpose: ${shot.coveragePurpose}\n` +
          `Required keyframe: ${spec.keyframePrompt}\nContinuity lock: ${spec.continuityState}\n` +
          `First-frame constraint: ${spec.firstFrameConstraint}\nNegative constraints: ${spec.negativePrompt}\n` +
          `Score EACH image independently from 0 to 1. semanticAlignment means literal subject/action/location match, ` +
          `continuity means identity/era/wardrobe/props/lighting/style consistency, artifactFree means anatomy, text, ` +
          `watermark, geometry, framing and image integrity. Do not reward generic beauty over literal accuracy. ` +
          `Return STRICT JSON only: {"candidates":[{"candidateIndex":0,"semanticAlignment":0.0,"continuity":0.0,` +
          `"artifactFree":0.0,"notes":["concrete observations"]}]}. Include every candidate exactly once.`,
        imagePaths: paths,
        json: true,
        maxTokens: 1200,
      });
      const graded = AssetCandidateSetGradeSchema.parse(parseJsonLoose(raw));
      const byIndex = new Map(graded.candidates.map((grade) => [grade.candidateIndex, grade]));
      if (byIndex.size !== candidates.length || candidates.some((candidate) => !byIndex.has(candidate.candidateIndex))) {
        throw new Error(`qa_assets grader did not return an exact candidate set for ${shot.id}`);
      }
      const ranked = candidates.map((candidate) => {
        const grade = byIndex.get(candidate.candidateIndex)!;
        return { candidate, grade, score: imageScore(grade) };
      }).sort((a, b) => b.score - a.score || a.candidate.candidateIndex - b.candidate.candidateIndex);
      const best = ranked[0];
      if (
        best.score < shot.imageMinScore ||
        best.grade.semanticAlignment < 0.65 ||
        best.grade.continuity < 0.65 ||
        best.grade.artifactFree < 0.65
      ) {
        throw new Error(
          `qa_assets FAILED ${shot.id}: best=${best.score.toFixed(3)} threshold=${shot.imageMinScore.toFixed(3)} ` +
          `(semantic=${best.grade.semanticAlignment}, continuity=${best.grade.continuity}, artifact=${best.grade.artifactFree})`,
        );
      }
      selected.push({
        shotId: shot.id,
        stillKey: best.candidate.stillKey,
        candidateIndex: best.candidate.candidateIndex,
        score: best.score,
        semanticAlignment: best.grade.semanticAlignment,
        continuity: best.grade.continuity,
        artifactFree: best.grade.artifactFree,
        notes: best.grade.notes,
      });
      ctx.log(`qa_assets: ${shot.id} selected c${best.candidate.candidateIndex} @ ${best.score.toFixed(3)}`);
    }

    const selectedStillManifest = SelectedStillManifestSchema.parse({
      version: "1.0.0",
      generation: manifest.generation,
      items: selected,
    });
    const assetQaReport = AssetQaReportSchema.parse({
      version: "1.0.0",
      required: true,
      graderRan: true,
      passed: true,
      shotCount: shots.length,
      candidateCount: manifest.items.length,
      selected: selected.map((item) => ({
        shotId: item.shotId,
        candidateIndex: item.candidateIndex,
        score: item.score,
        threshold: shots.find((shot) => shot.id === item.shotId)!.imageMinScore,
      })),
    });
    return {
      selectedStillManifest,
      assetQaReport,
      [COST_PATCH_KEY]: shots.length * PRICE.visionGraderUsd,
    };
  },
};

export const novitaRenderVideo: Block = {
  id: "novita_render_video",
  consumes: ["shotList", "dpVisualSpecs", "selectedStillManifest"],
  produces: ["shotRenderManifest"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const selected = SelectedStillManifestSchema.parse(ctx.store["selectedStillManifest"]);
    const profile = profileForShots(shots, ctx.params["generationProfile"] ?? selected.generation.profileId);
    if (selected.generation.profileId !== profile.id) throw new Error("selected still profile does not match video profile");
    if (selected.items.length !== shots.length || new Set(selected.items.map((item) => item.shotId)).size !== shots.length) {
      throw new Error("selected still manifest is not one-to-one with the shot plan");
    }
    const selectedByShot = new Map(selected.items.map((item) => [item.shotId, item]));
    const shotsWithStills: Shot[] = shots.map((shot) => {
      const selectedStill = selectedByShot.get(shot.id);
      if (!selectedStill) throw new Error(`selected still missing for ${shot.id}`);
      const spec = specsByShot.get(shot.id)!;
      return {
        ...shot,
        stillKey: selectedStill.stillKey,
        prompt: spec.motionPrompt,
        motion: `${spec.motionPrompt} First frame: ${spec.firstFrameConstraint}. Last frame: ${spec.lastFrameConstraint}.`,
        negative: spec.negativePrompt,
      };
    });
    const cfg: NovitaRenderCfg = {
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/novita`,
      shots: shotsWithStills,
      profile: toNovitaPhaseProfile(profile, "video"),
      negative: ctx.params["negative"] as string | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
    };
    const result = await renderVideo(cfg);
    if (!result.candidates?.length) throw new Error("novita_render_video returned no exact shot mapping");
    const candidateByShot = new Map(result.candidates.map((candidate) => [candidate.shotId, candidate]));
    if (candidateByShot.size !== shots.length) throw new Error("novita_render_video returned duplicate or missing shot mappings");
    const durationSec = shots.at(-1)!.t1;
    const shotRenderManifest = ShotRenderManifestSchema.parse({
      version: "1.0.0",
      generation: {
        ...generationIdentity(profile, "video"),
        fps: profile.video.fps,
        guidanceScale: profile.video.guidanceScale,
        twoStageRefine: profile.video.twoStageRefine,
      },
      durationSec,
      items: shots.map((shot) => {
        const candidate = candidateByShot.get(shot.id);
        if (!candidate) throw new Error(`novita_render_video omitted ${shot.id}`);
        return {
          shotId: shot.id,
          clipKey: candidate.key,
          t0: shot.t0,
          t1: shot.t1,
          sourceSentenceIds: shot.sourceSentenceIds,
          continuityState: shot.continuityState,
        };
      }),
    });
    assertExactShotManifest(shots, shotRenderManifest);
    ctx.log(`novita_render_video: ${result.outputs} pinned story clip(s) in ${result.durationSec}s`);
    return {
      shotRenderManifest,
      [COST_PATCH_KEY]: result.costUsd,
    };
  },
};

export const qaShots: Block = {
  id: "qa_shots",
  consumes: ["shotList", "dpVisualSpecs", "shotRenderManifest"],
  produces: ["footageClips", "footageKeys", "shotQaReport", "visualCoverage"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const manifest = ShotRenderManifestSchema.parse(ctx.store["shotRenderManifest"]);
    assertExactShotManifest(shots, manifest);
    const profile = profileForShots(shots, manifest.generation.profileId);
    const tmp = await makeRunTempDir(`${ctx.runId}_shot_qa`);
    const localClips: string[] = [];
    const grades: Array<z.infer<typeof ShotGradeSchema> & { shotId: string; score: number; threshold: number }> = [];

    for (const [index, shot] of shots.entries()) {
      const item = manifest.items[index];
      const local = join(tmp, `${shot.id}.mp4`);
      await writeBytes(local, await getObjectBytes(item.clipKey));
      localClips.push(local);
      const media = await probe(local);
      if (!media.hasVideo) throw new Error(`qa_shots FAILED ${shot.id}: rendered asset has no video stream`);
      if (media.width !== profile.video.width || media.height !== profile.video.height) {
        throw new Error(`qa_shots FAILED ${shot.id}: ${media.width}x${media.height} != pinned ${profile.video.width}x${profile.video.height}`);
      }
      const expectedMediaSec = secondsToFrames(shot.seconds, profile.video.fps) / profile.video.fps;
      if (!Number.isFinite(media.durationSec) || Math.abs(media.durationSec - expectedMediaSec) > Math.max(0.2, 3 / profile.video.fps)) {
        throw new Error(
          `qa_shots FAILED ${shot.id}: media duration ${media.durationSec.toFixed(3)}s != expected ${expectedMediaSec.toFixed(3)}s`,
        );
      }
      const sampleTimes = [
        Math.min(0.08, Math.max(0, media.durationSec / 10)),
        media.durationSec * 0.5,
        Math.max(0, media.durationSec - Math.max(0.08, 2 / profile.video.fps)),
      ];
      const frames: string[] = [];
      for (let frameIndex = 0; frameIndex < sampleTimes.length; frameIndex++) {
        const frame = join(tmp, `${shot.id}_f${frameIndex}.jpg`);
        await grabFrame(local, sampleTimes[frameIndex], frame);
        frames.push(frame);
      }
      if (frames.length !== 3) throw new Error(`qa_shots FAILED ${shot.id}: could not extract start/middle/end frames`);
      const spec = specsByShot.get(shot.id)!;
      const raw = await visionLocal({
        prompt:
          `You are the REQUIRED final grader for one generated documentary shot. The three images are the START, ` +
          `MIDDLE, and END frames in chronological order.\nLiteral story content: ${shot.literalContent}\n` +
          `Story purpose: ${shot.coveragePurpose}\nRequired motion: ${spec.motionPrompt}\n` +
          `First-frame constraint: ${spec.firstFrameConstraint}\nLast-frame constraint: ${spec.lastFrameConstraint}\n` +
          `Continuity lock: ${spec.continuityState}\nNegative constraints: ${spec.negativePrompt}\n` +
          `Score 0..1: semanticAlignment (literal story match in all frames), continuity (identity/era/wardrobe/props/` +
          `lighting remain coherent), motionIntegrity (the ordered frames demonstrate the requested action/camera move ` +
          `without freezing or direction errors), artifactFree (no warping, morphing, duplicate limbs, text, watermark, ` +
          `broken geometry, or temporal corruption). Return STRICT JSON only: {"semanticAlignment":0.0,` +
          `"continuity":0.0,"motionIntegrity":0.0,"artifactFree":0.0,"notes":["concrete observations"]}.`,
        imagePaths: frames,
        json: true,
        maxTokens: 700,
      });
      const grade = ShotGradeSchema.parse(parseJsonLoose(raw));
      const score = videoScore(grade);
      if (
        score < shot.shotMinScore ||
        grade.semanticAlignment < 0.65 ||
        grade.continuity < 0.65 ||
        grade.motionIntegrity < 0.65 ||
        grade.artifactFree < 0.65
      ) {
        throw new Error(
          `qa_shots FAILED ${shot.id}: score=${score.toFixed(3)} threshold=${shot.shotMinScore.toFixed(3)} ` +
          `(semantic=${grade.semanticAlignment}, continuity=${grade.continuity}, motion=${grade.motionIntegrity}, artifact=${grade.artifactFree})`,
        );
      }
      grades.push({ ...grade, shotId: shot.id, score, threshold: shot.shotMinScore });
      ctx.log(`qa_shots: ${shot.id} passed @ ${score.toFixed(3)}`);
    }

    const mappedSec = manifest.items.reduce((sum, item) => sum + (item.t1 - item.t0), 0);
    const visualCoverage = VisualCoverageSchema.parse({
      version: "1.0.0",
      mappedSec: manifest.durationSec,
      totalSec: manifest.durationSec,
      ratio: 1,
      missingShotIds: [],
      duplicateShotIds: [],
    });
    if (Math.abs(mappedSec - manifest.durationSec) > EPSILON) {
      throw new Error(`qa_shots coverage mismatch: mapped=${mappedSec}, total=${manifest.durationSec}`);
    }
    const shotQaReport = ShotQaReportSchema.parse({
      version: "1.0.0",
      required: true,
      graderRan: true,
      passed: true,
      shots: grades,
    });
    return {
      footageClips: localClips,
      footageKeys: manifest.items.map((item) => item.clipKey),
      shotQaReport,
      visualCoverage,
      [COST_PATCH_KEY]: shots.length * PRICE.visionGraderUsd,
    };
  },
};

export const novitaRenderBlocks: Block[] = [novitaRenderImages, qaAssets, novitaRenderVideo, qaShots];
