/**
 * Provider-free review step for local image-model comparisons.
 *
 * It deliberately proves only deterministic facts: the downloaded bytes still
 * match the benchmark manifest, source pixels meet the declared on-board
 * footprint, and a no-text comparison did not introduce readable typography.
 * Composition, story relevance, and style remain an explicit operator review
 * rather than a fabricated automatic winner.
 *
 * Usage:
 *   npm run review:image-benchmark -- output/<benchmark>/manifest.json
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { rasterImageDimensions } from "@/lib/imageDimensions";

const execFile = promisify(execFileCallback);

interface BenchmarkCandidate {
  id: string;
  model: string;
  publicEstimatedUsd: number;
  imagePath: string;
  contentSha256: string;
}

interface BenchmarkManifest {
  version: string;
  prompt: string;
  productionEligible: boolean;
  layoutTarget?: { boardPixelsAt1080p?: unknown };
  candidates: BenchmarkCandidate[];
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function parseManifest(value: unknown): BenchmarkManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("image benchmark review requires a JSON object manifest");
  }
  const raw = value as Partial<BenchmarkManifest>;
  if (
    typeof raw.version !== "string" ||
    typeof raw.prompt !== "string" ||
    raw.productionEligible !== false ||
    !Array.isArray(raw.candidates) ||
    !raw.candidates.length
  ) {
    throw new Error("image benchmark manifest is incomplete or incorrectly marked production-eligible");
  }
  const candidates = raw.candidates.map((candidate) => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      typeof (candidate as BenchmarkCandidate).id !== "string" ||
      typeof (candidate as BenchmarkCandidate).model !== "string" ||
      typeof (candidate as BenchmarkCandidate).publicEstimatedUsd !== "number" ||
      typeof (candidate as BenchmarkCandidate).imagePath !== "string" ||
      !isSha256((candidate as BenchmarkCandidate).contentSha256)
    ) {
      throw new Error("image benchmark manifest contains an invalid candidate");
    }
    return candidate as BenchmarkCandidate;
  });
  return { ...raw, candidates } as BenchmarkManifest;
}

function minimumBoardPixels(manifest: BenchmarkManifest): [number, number] | undefined {
  const value = manifest.layoutTarget?.boardPixelsAt1080p;
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [width, height] = value;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("image benchmark manifest has an invalid layout target");
  }
  return [width, height];
}

async function recognizedText(imagePath: string): Promise<string> {
  try {
    const { stdout } = await execFile("tesseract", [imagePath, "stdout", "--psm", "11"], {
      timeout: 30_000,
      maxBuffer: 8_000,
    });
    return stdout.replace(/\s+/g, " ").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`local OCR failed for ${imagePath}: ${message}`);
  }
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error("usage: review-image-provider-benchmark.mts <manifest.json>");
}
const absoluteManifestPath = resolve(manifestPath);
const manifest = parseManifest(JSON.parse(await readFile(absoluteManifestPath, "utf8")));
const requiredPixels = minimumBoardPixels(manifest);

const candidates = await Promise.all(manifest.candidates.map(async (candidate) => {
  const imagePath = resolve(dirname(absoluteManifestPath), candidate.imagePath);
  const bytes = await readFile(imagePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const dimensions = rasterImageDimensions(bytes);
  const ocr = await recognizedText(imagePath);
  // Whiteboard marker strokes can be misread as one- or two-character words.
  // Treat only sustained OCR as baked typography; the operator still reviews
  // every otherwise-clean candidate for a semantic/style decision.
  const textWords = ocr.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const textCharacters = textWords.join("");
  const defects = [
    ...(contentSha256 === candidate.contentSha256 ? [] : ["downloaded bytes differ from manifest"]),
    ...(requiredPixels && (dimensions.width < requiredPixels[0] || dimensions.height < requiredPixels[1])
      ? [`source image ${dimensions.width}×${dimensions.height} is below the ${requiredPixels[0]}×${requiredPixels[1]} board target`]
      : []),
  ];
  // OCR is deliberately advisory for line-art: tentacles, rails, and marker
  // hatching can resemble letters. The reviewer sees this risk signal but it
  // may not override exact byte/layout proof without visual confirmation.
  const warnings = textCharacters.length >= 8 || textWords.some((word) => word.length >= 5)
    ? [`local OCR detected possible baked text: ${JSON.stringify(ocr.slice(0, 160))}`]
    : [];
  return {
    id: candidate.id,
    model: candidate.model,
    publicEstimatedUsd: candidate.publicEstimatedUsd,
    imagePath,
    contentSha256,
    dimensions: { width: dimensions.width, height: dimensions.height, contentType: dimensions.contentType },
    ocr,
    warnings,
    deterministicVerdict: defects.length ? "rejected" : "operator_visual_review_required",
    defects,
  };
}));

const review = {
  version: "image-provider-benchmark-review/v1",
  manifestPath: absoluteManifestPath,
  manifestVersion: manifest.version,
  promptSha256: createHash("sha256").update(manifest.prompt).digest("hex"),
  productionEligible: false,
  requiredPixels,
  candidates,
  note: "This review proves bytes and dimensions only. OCR is an advisory typography-risk signal because line art can be misread as letters. An operator must still select semantic clarity, composition, style, and no-text compliance; no candidate is production-approved by this record.",
};
const reviewPath = resolve(dirname(absoluteManifestPath), "deterministic-review.json");
await writeFile(reviewPath, JSON.stringify(review, null, 2));
console.log(JSON.stringify({ reviewPath, candidates: candidates.map(({ id, deterministicVerdict, defects, warnings }) => ({ id, deterministicVerdict, defects, warnings })) }, null, 2));
