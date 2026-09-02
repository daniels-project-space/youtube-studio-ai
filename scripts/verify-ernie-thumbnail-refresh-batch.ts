/**
 * Production-review one immutable native-typography ERNIE-Novita thumbnail
 * batch. This script is intentionally non-mutating: it cannot create a
 * candidate, write Studio R2, or alter YouTube.  Its durable output becomes
 * the sole input to the later candidate-import step.
 *
 * Inputs:
 * - ERNIE_THUMBNAIL_CONTROLLER_RESULT_FILE: result emitted by the Novita
 *   controller (signed one-day scene URLs and receipt identity)
 * - ERNIE_THUMBNAIL_PLAN_DIR: frozen planner directory
 * - ERNIE_THUMBNAIL_REVIEW_DIR: local evidence destination. ERNIE pixels are
 *   reviewed intact: this route never changes their visible design.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "dotenv";

import type { ThumbnailGateVerdict } from "@/engine/qualityPolicy";
import {
  runThumbnailMobileReferenceQa,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";

config({ path: process.env.ERNIE_THUMBNAIL_STUDIO_ENV_FILE?.trim() || ".env.local" });

const PLAN_DIR = process.env.ERNIE_THUMBNAIL_PLAN_DIR?.trim() || "/tmp/ysa-ernie-thumbnail-refresh-v1";
const CONTROLLER_FILE = process.env.ERNIE_THUMBNAIL_CONTROLLER_RESULT_FILE?.trim();
const REVIEW_DIR = process.env.ERNIE_THUMBNAIL_REVIEW_DIR?.trim() || join(PLAN_DIR, "review");
const SHA256 = /^[a-f0-9]{64}$/;
const NATIVE_TEXT_OBJECTS = [
  "torn_strip", "paint_smear", "censor_bar", "grunge_sticker", "spaced_elegant",
  "block_plate", "neon_sign", "spray_paint", "stamp_ink", "movie_poster",
  "ransom_note", "carved",
] as const;
type NativeTextObject = typeof NATIVE_TEXT_OBJECTS[number];

type RecordValue = Record<string, unknown>;

type NativeRenderSpec = Readonly<{
  scene: Readonly<{
    description: string;
    imageStyle?: string;
    palette?: string[];
    accentColor?: string;
    composition?: string;
    textZone?: string;
    visualAvoid?: string[];
  }>;
  typography: Readonly<{
    lines: Array<Readonly<{ text: string }>>;
    subtitle?: string;
    font?: "serif" | "sans" | "impact" | "marker" | "bebas" | "rounded";
    uppercase?: boolean;
    treatment?: "plate" | "sticker" | "stamp" | "neon" | "clean";
    textObject?: string;
    baseColor?: string;
    accentColor?: string;
    badgeStyle?: "center" | "pill";
  }>;
}>;

type Plan = Readonly<{
  version: 1 | 2;
  ownerId: string;
  sourceRunId: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  youtubeVideoId: string;
  title: string;
  topic: string;
  family: string;
  pattern: string;
  expectedWords: string[];
  renderSpec: NativeRenderSpec;
  scenePrompt: string;
  promptSha256: string;
}>;

type ControllerResult = Readonly<{
  event: "succeeded";
  jobId: string;
  rootOutputKey: string;
  receiptKey: string;
  providerResponseSha256: string;
  elapsedSeconds: number;
  outputs: Array<{
    id: string;
    key: string;
    sha256: string;
    outputUrl: string;
  }>;
}>;

type ReviewedArtifact = Readonly<{
  sourceRunId: string;
  channelId: string;
  channelSlug: string;
  title: string;
  expectedWords: string[];
  pattern: string;
  scenePromptSha256: string;
  ernieSceneKey: string;
  ernieSceneSha256: string;
  finalPath: string;
  finalSha256: string;
  qa: ThumbnailGateVerdict;
}>;

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RecordValue;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nativeTextObject(value: string | undefined): NativeTextObject | undefined {
  return NATIVE_TEXT_OBJECTS.includes(value as NativeTextObject)
    ? value as NativeTextObject
    : undefined;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function planPlaybook(plan: Plan): ThumbnailPlaybook {
  const typography = plan.renderSpec.typography;
  const scene = plan.renderSpec.scene;
  const font = typography.font === "sans" ? "impact" : (typography.font ?? "impact");
  const treatment = typography.treatment ?? "plate";
  const accentColor = typography.accentColor ?? scene.accentColor ?? "#f5f0e8";
  const baseColor = typography.baseColor ?? scene.palette?.[0] ?? "#111827";
  return {
    // The reviewer consumes the exact saved spec, not a freshly inferred
    // channel identity.  This keeps review tied to the sealed ERNIE request.
    source: "style_dna_foundation",
    energy: plan.family === "music_loop" || plan.family === "sleep" ? "cozy_pop" : "bold",
    visualLanguage: {
      font,
      treatment,
      baseColor,
      accentColor,
      imageStyle: scene.imageStyle ?? "sealed ERNIE thumbnail scene",
      composition: scene.composition === "cutout_collage" ? "cutout_collage" : "full_scene",
      badgeStyle: typography.badgeStyle ?? "pill",
      uppercase: typography.uppercase ?? true,
      ...(nativeTextObject(typography.textObject) ? { textObject: nativeTextObject(typography.textObject) } : {}),
    },
    rules: [
      `Sealed scene: ${scene.description}`,
      "The exact planned hook must be readable at mobile browse size.",
      "Only one compact channel identity badge may accompany the hook.",
      "The hero must read with a single supporting consequence in under one second.",
    ],
    avoid: [...(scene.visualAvoid ?? []), "extra subtitle or tagline", "broken glyphs", "unreadable clutter"],
    patterns: [{
      name: plan.pattern || "sealed-scene",
      when: "frozen ERNIE thumbnail refresh",
      fluxRecipe: scene.description,
      textRecipe: { lines: typography.lines.map((line) => ({ text: line.text })) },
    }],
    refsUsed: [],
    distilledAt: 1,
  };
}

async function downloadVerifiedScene(output: ControllerResult["outputs"][number], outPath: string): Promise<Uint8Array> {
  if (!validId(output.id) || !SHA256.test(output.sha256) ||
    typeof output.key !== "string" || !output.key.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    typeof output.outputUrl !== "string" || !output.outputUrl.startsWith("https://")) {
    throw new Error(`controller output ${String(output.id)} has an invalid identity`);
  }
  const response = await fetch(output.outputUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${output.id}: ERNIE scene download returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || sha256(bytes) !== output.sha256) {
    throw new Error(`${output.id}: ERNIE scene bytes do not match its signed receipt`);
  }
  await writeFile(outPath, bytes);
  return bytes;
}

async function readPlan(sourceRunId: string): Promise<Plan> {
  const raw = JSON.parse(await readFile(join(PLAN_DIR, "plans", `${sourceRunId}.json`), "utf8")) as unknown;
  const value = asRecord(raw, `${sourceRunId} plan`);
  if (
    (value.version !== 1 && value.version !== 2) || !validId(value.sourceRunId) || value.sourceRunId !== sourceRunId ||
    !validId(value.channelId) || typeof value.channelSlug !== "string" || !value.channelSlug ||
    typeof value.title !== "string" || !value.title || typeof value.scenePrompt !== "string" ||
    !SHA256.test(String(value.promptSha256)) || !Array.isArray(value.expectedWords) ||
    !value.expectedWords.length || !asRecord(value.renderSpec, `${sourceRunId} renderSpec`)
  ) throw new Error(`${sourceRunId}: frozen plan is incomplete`);
  return value as unknown as Plan;
}

async function main(): Promise<void> {
  if (!CONTROLLER_FILE) throw new Error("ERNIE_THUMBNAIL_CONTROLLER_RESULT_FILE is required");
  const controller = JSON.parse(await readFile(CONTROLLER_FILE, "utf8")) as ControllerResult;
  if (
    controller.event !== "succeeded" || !validId(controller.jobId) ||
    typeof controller.rootOutputKey !== "string" || !controller.rootOutputKey.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    typeof controller.receiptKey !== "string" || !controller.receiptKey.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    !SHA256.test(controller.providerResponseSha256) || !Array.isArray(controller.outputs) || !controller.outputs.length
    || !Number.isFinite(controller.elapsedSeconds) || controller.elapsedSeconds < 0
  ) throw new Error("controller result lacks a sealed successful ERNIE batch receipt");

  await mkdir(REVIEW_DIR, { recursive: true });
  const reviewed: ReviewedArtifact[] = [];
  const ids = new Set<string>();
  for (const output of controller.outputs) {
    if (!validId(output.id) || ids.has(output.id)) throw new Error("controller result contains duplicate or invalid source ids");
    ids.add(output.id);
    const plan = await readPlan(output.id);
    const itemDir = join(REVIEW_DIR, output.id);
    await mkdir(itemDir, { recursive: true });
    const scenePath = join(itemDir, "ernie-scene.png");
    await downloadVerifiedScene(output, scenePath);
    // ERNIE itself renders every visible glyph for this route. Preserve the
    // signed PNG without a local overlay, crop, or type pass.
    const finalPath = scenePath;
    const qaDir = join(itemDir, "qa");
    await mkdir(qaDir, { recursive: true });
    const qa = await runThumbnailMobileReferenceQa({
      outJpg: finalPath,
      tmpDir: qaDir,
      title: plan.title,
      niche: plan.family,
      playbook: planPlaybook(plan),
      brandContext: {
        channelName: plan.channelName,
        channelSlug: plan.channelSlug,
        family: plan.family,
        pattern: plan.pattern,
        sceneStyle: plan.renderSpec.scene.imageStyle,
      },
      expectedWords: plan.expectedWords,
      qaTier: "final",
      log: (message) => console.log(`[${output.id}] ${message}`),
    });
    const item: ReviewedArtifact = {
      sourceRunId: plan.sourceRunId,
      channelId: plan.channelId,
      channelSlug: plan.channelSlug,
      title: plan.title,
      expectedWords: plan.expectedWords,
      pattern: plan.pattern,
      scenePromptSha256: plan.promptSha256,
      ernieSceneKey: output.key,
      ernieSceneSha256: output.sha256,
      finalPath,
      finalSha256: sha256(await readFile(finalPath)),
      qa,
    };
    await writeFile(join(itemDir, "review.json"), `${JSON.stringify(item, null, 2)}\n`, "utf8");
    reviewed.push(item);
    console.log(JSON.stringify({ sourceRunId: item.sourceRunId, qa }));
  }
  const result = {
    version: 1,
    controller: {
      jobId: controller.jobId,
      rootOutputKey: controller.rootOutputKey,
      receiptKey: controller.receiptKey,
      providerResponseSha256: controller.providerResponseSha256,
      elapsedSeconds: controller.elapsedSeconds,
    },
    reviewed,
  };
  await writeFile(join(REVIEW_DIR, "batch-review.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    event: "reviewed",
    jobId: controller.jobId,
    total: reviewed.length,
    passing: reviewed.filter((item) => item.qa.textOk && item.qa.faceClear && item.qa.punch >= 7 && item.qa.styleMatch >= 7 && item.qa.storyMatch >= 7 && item.qa.uiClean).length,
  }));
}

main().catch((error: unknown) => {
  console.error(`verify-ernie-thumbnail-refresh-batch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
