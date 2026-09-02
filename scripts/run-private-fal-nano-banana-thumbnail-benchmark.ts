/**
 * Render a bounded, private Nano Banana Pro comparison batch without touching
 * Studio records or YouTube.  Each job keeps its input prompt, exact provider
 * receipt, and output digest so a provider comparison never becomes an
 * untraceable gallery of rerolls.
 *
 * This is intentionally native-only: Nano Banana Pro renders all artwork and
 * visible type.  No FFmpeg/local text compositor participates in this route.
 *
 * Usage:
 *   THUMBNAIL_NBP_BENCHMARK_FILE=/absolute/jobs.json \
 *   THUMBNAIL_NBP_BENCHMARK_ONLY_IDS=a,b,c \
 *   npx tsx scripts/run-private-fal-nano-banana-thumbnail-benchmark.ts
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  generateFalNanoBananaProThumbnailWithReceipt,
} from "@/lib/falNanoBananaProThumbnail";
import {
  FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE,
} from "@/lib/falNanoBananaProThumbnailContract";

type Job = Readonly<{
  id: string;
  prompt: string;
  seed?: number;
}>;

type Batch = Readonly<{
  version: 1;
  label?: string;
  jobs: readonly Job[];
}>;

const inputFile = process.env.THUMBNAIL_NBP_BENCHMARK_FILE?.trim();
const outDir = process.env.THUMBNAIL_NBP_BENCHMARK_OUT_DIR?.trim()
  || "/tmp/ysa-fal-nano-banana-private-benchmark";
const onlyIds = new Set(
  (process.env.THUMBNAIL_NBP_BENCHMARK_ONLY_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
);
const maxCostUsd = Number(process.env.THUMBNAIL_NBP_BENCHMARK_MAX_COST_USD ?? "0.50");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function asBatch(value: unknown): Batch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("thumbnail benchmark input must be a JSON object");
  }
  const batch = value as Partial<Batch>;
  if (batch.version !== 1 || !Array.isArray(batch.jobs) || !batch.jobs.length || batch.jobs.length > 12) {
    throw new Error("thumbnail benchmark input must be version 1 with 1..12 jobs");
  }
  const ids = new Set<string>();
  for (const job of batch.jobs) {
    if (!validId(job?.id) || ids.has(job.id) || typeof job.prompt !== "string" || !job.prompt.trim()) {
      throw new Error("thumbnail benchmark has an invalid or duplicate job");
    }
    ids.add(job.id);
  }
  return batch as Batch;
}

/** Convert an ERNIE comparison brief to the equivalent native Nano request. */
function nanoPrompt(prompt: string): string {
  return prompt
    .replace(
      /ERNIE itself renders? (?:every )?(?:visible )?glyphs?/gi,
      "Nano Banana Pro itself renders every visible glyph",
    )
    .replace(/ERNIE itself must render/gi, "Nano Banana Pro itself must render")
    .replace(/ERNIE-native/gi, "Nano Banana Pro-native")
    .trim();
}

async function main(): Promise<void> {
  if (!inputFile) throw new Error("THUMBNAIL_NBP_BENCHMARK_FILE is required");
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 5) {
    throw new Error("THUMBNAIL_NBP_BENCHMARK_MAX_COST_USD must be between 0 and 5");
  }
  const batch = asBatch(JSON.parse(await readFile(inputFile, "utf8")) as unknown);
  const jobs = batch.jobs.filter((job) => !onlyIds.size || onlyIds.has(job.id));
  if (!jobs.length) throw new Error("the selected Nano Banana benchmark contains no jobs");
  const missing = [...onlyIds].filter((id) => !batch.jobs.some((job) => job.id === id));
  if (missing.length) throw new Error(`benchmark input is missing selected IDs: ${missing.join(", ")}`);
  const projectedCostUsd = Number((jobs.length * FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.outputImageUsd).toFixed(6));
  if (projectedCostUsd > maxCostUsd) {
    throw new Error(`private benchmark would cost $${projectedCostUsd}; limit is $${maxCostUsd}`);
  }

  const sourceName = basename(inputFile).replace(/\.json$/i, "");
  const root = join(outDir, sourceName);
  await mkdir(root, { recursive: true });
  const completed: Array<{ id: string; imageSha256: string; receiptSha256: string }> = [];
  for (const job of jobs) {
    const prompt = nanoPrompt(job.prompt);
    const jobRoot = join(root, job.id);
    const intentPath = join(jobRoot, "intent.json");
    const imagePath = join(jobRoot, "nano-banana-pro-native.png");
    const receiptPath = join(jobRoot, "provider-receipt.json");
    await mkdir(jobRoot, { recursive: true });

    let existingIntent: { promptSha256?: unknown; context?: unknown } | null = null;
    try {
      existingIntent = JSON.parse(await readFile(intentPath, "utf8")) as { promptSha256?: unknown; context?: unknown };
    } catch {
      // Fresh private candidate; the immutable intent is persisted below.
    }
    const promptSha256 = sha256(prompt);
    const context = `private-thumbnail-comparison/${sourceName}/${job.id}/${promptSha256}`;
    if (existingIntent) {
      if (existingIntent.promptSha256 !== promptSha256 || existingIntent.context !== context) {
        throw new Error(`${job.id}: existing intent does not match this immutable input`);
      }
      try {
        const [imageBytes, receiptBytes] = await Promise.all([readFile(imagePath), readFile(receiptPath)]);
        const receipt = JSON.parse(receiptBytes.toString("utf8")) as { receipt?: { providerRequestId?: unknown } };
        if (!imageBytes.length || !receipt?.receipt) throw new Error("incomplete private receipt");
        completed.push({ id: job.id, imageSha256: sha256(imageBytes), receiptSha256: sha256(receiptBytes) });
        continue;
      } catch (error) {
        throw new Error(
          `${job.id}: a prior provider submission may be ambiguous or incomplete; refusing automatic replay ` +
          `(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }

    await writeFile(intentPath, `${JSON.stringify({
      version: 1,
      private: true,
      sourceFile: sourceName,
      id: job.id,
      prompt,
      promptSha256,
      context,
      projectedCostUsd: FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.outputImageUsd,
    }, null, 2)}\n`, "utf8");
    const generated = await generateFalNanoBananaProThumbnailWithReceipt({
      prompt,
      idempotencyContext: context,
    });
    const imageSha256 = sha256(generated.bytes);
    const receiptJson = JSON.stringify({
      version: 1,
      private: true,
      id: job.id,
      promptSha256,
      imageSha256,
      receipt: generated.receipt,
    }, null, 2);
    await writeFile(imagePath, generated.bytes);
    await writeFile(receiptPath, `${receiptJson}\n`, "utf8");
    completed.push({ id: job.id, imageSha256, receiptSha256: sha256(receiptJson) });
  }
  console.log(JSON.stringify({
    event: "private-nano-banana-benchmark-complete",
    sourceFile: sourceName,
    candidates: completed,
    projectedCostUsd,
  }));
}

main().catch((error: unknown) => {
  console.error(`run-private-fal-nano-banana-thumbnail-benchmark: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
