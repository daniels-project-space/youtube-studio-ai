/**
 * One-prompt, one-image-per-model comparison for Whiteboard art selection.
 *
 * This is deliberately separate from the production Nano Banana Pro adapter:
 * benchmark outputs are local review material only and may never enter a
 * release master. A cheaper model can graduate only after a receipt-bound
 * adapter, deterministic visual review, and an explicit policy change.
 *
 * Usage (the key is injected by the project vault, never printed):
 *   ai-vault fal FAL_KEY=FAL_KEY -- npm exec tsx scripts/benchmark-whiteboard-image-providers.mts --execute
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// `ai-vault` consumes a trailing `--execute` switch while proxying commands,
// so retain the same explicit acknowledgement through a dedicated child env
// value. Either form is required; the benchmark can never submit by default.
const execute = process.argv.includes("--execute") || process.env.WHITEBOARD_BENCHMARK_EXECUTE === "1";
if (!execute) {
  throw new Error("Refusing to submit image benchmarks without --execute or WHITEBOARD_BENCHMARK_EXECUTE=1");
}
if (!process.env.FAL_KEY) {
  throw new Error("FAL_KEY is required through the sealed project vault");
}

const supportLayoutPrompt = [
  "A single clean editorial black-marker line-art whiteboard diagram on a pure white #ffffff background, 16:9, no border, no frame, no grey edges.",
  "Show exactly one simple relationship: one blank headline card on the left cannot answer the question, while one three-line checklist on the right can; place one small red question mark between them.",
  "This must stay instantly readable when reduced to a small 17% by 22% whiteboard slot. Use only the card, checklist, and question mark; no calendar, calculator, receipt, chart, document stack, extra icons, or background scene.",
  "Make the contrast unmistakable without text. No tree, seed, plant, snowball, gear, compass, generic growth metaphor, or decorative symbolism.",
  "Uniform thick black marker strokes, one restrained red accent family, simple line-art only, no shading, no text, letters, numbers, labels, logos, watermark, photorealism, or typography.",
].join(" ");

const octopusControlPrompt = [
  "A single clean editorial black-marker line-art whiteboard illustration on a pure white #ffffff background, 16:9, no border, no frame, no grey edges.",
  "Show one large central octopus as a literal symbol of concentrated corporate control: one tentacle reaches toward a simple rail line with two worker figures, and two separate tentacles reach toward a neat banana plantation with small banana plants.",
  "Make the three targets distinct and instantly understandable as control relationships, with the octopus clearly central and no violence, no caricature, and no real-company logos.",
  "Uniform thick black marker strokes, one restrained red accent family, simple editorial line-art only, no shading, no text, letters, numbers, labels, logos, watermark, photorealism, or typography.",
].join(" ");

const scenario = process.env.WHITEBOARD_BENCHMARK_SCENARIO === "octopus-control-v1"
  ? {
      id: "octopus-control-v1",
      prompt: octopusControlPrompt,
      layoutTarget: { boardWidthFraction: 0.46, boardHeightFraction: 0.48, boardPixelsAt1080p: [883, 518] },
      note: "Local visual comparison only for an operator choice. None of these images may enter a production Whiteboard master.",
    }
  : {
      id: "support-layout-v2",
      prompt: supportLayoutPrompt,
      layoutTarget: { boardWidthFraction: 0.17, boardHeightFraction: 0.22, boardPixelsAt1080p: [326, 238] },
      note: "Local comparison only. Prices are public list-price estimates; every candidate must be reviewed at the declared on-board footprint before a receipt-bound production policy can change. None of these images may enter a production Whiteboard master.",
    };
const outputDir = join(process.cwd(), "output", "whiteboard", `provider-benchmark-${scenario.id}`);
const prompt = scenario.prompt;

const candidates = [
  {
    id: "nano-banana-pro-baseline",
    model: "fal-ai/nano-banana-pro",
    publicEstimatedUsd: 0.15,
    input: {
      prompt,
      num_images: 1,
      aspect_ratio: "16:9",
      output_format: "png",
      safety_tolerance: "4",
      sync_mode: false,
      resolution: "2K",
      limit_generations: true,
      enable_web_search: false,
    },
  },
  {
    id: "nano-banana-2",
    model: "fal-ai/nano-banana-2",
    publicEstimatedUsd: 0.08,
    input: {
      prompt,
      num_images: 1,
      aspect_ratio: "16:9",
      output_format: "png",
      safety_tolerance: "4",
      sync_mode: false,
      resolution: "1K",
      enable_web_search: false,
    },
  },
  {
    id: "seedream-v4-5",
    model: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    publicEstimatedUsd: 0.04,
    input: { prompt, image_size: "landscape_16_9", num_images: 1, enable_safety_checker: true },
  },
  {
    id: "recraft-v4-standard",
    model: "fal-ai/recraft/v4/text-to-image",
    publicEstimatedUsd: 0.04,
    input: { prompt, image_size: "landscape_16_9" },
  },
  {
    id: "flux-1-1-pro-ultra",
    model: "fal-ai/flux-pro/v1.1-ultra",
    publicEstimatedUsd: 0.06,
    input: {
      prompt,
      num_images: 1,
      aspect_ratio: "16:9",
      output_format: "png",
      safety_tolerance: "2",
      enhance_prompt: false,
      raw: false,
    },
  },
] as const;

const manifest: Array<{
  id: string;
  model: string;
  publicEstimatedUsd: number;
  requestId: string | null;
  imagePath: string;
  contentSha256: string;
}> = [];

await mkdir(outputDir, { recursive: true });
for (const candidate of candidates) {
  const response = await fetch(`https://fal.run/${candidate.model}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(candidate.input),
    signal: AbortSignal.timeout(180_000),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${candidate.id} returned HTTP ${response.status}; stopping rather than retrying or substituting a model`);
  }
  const payload = JSON.parse(responseText) as { images?: Array<{ url?: string }>; request_id?: string };
  const imageUrl = payload.images?.[0]?.url;
  if (!imageUrl || !/^https:\/\//.test(imageUrl)) {
    throw new Error(`${candidate.id} returned no durable image URL; stopping without a retry`);
  }
  const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
  if (!imageResponse.ok) throw new Error(`${candidate.id} output download returned HTTP ${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length) throw new Error(`${candidate.id} returned empty image bytes`);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const imagePath = join(outputDir, `${candidate.id}.png`);
  await writeFile(imagePath, bytes);
  manifest.push({
    id: candidate.id,
    model: candidate.model,
    publicEstimatedUsd: candidate.publicEstimatedUsd,
    requestId: response.headers.get("x-fal-request-id") ?? payload.request_id ?? null,
    imagePath,
    contentSha256,
  });
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
    version: "whiteboard-provider-benchmark/v2",
    prompt,
    productionEligible: false,
    layoutTarget: scenario.layoutTarget,
    note: scenario.note,
    candidates: manifest,
  }, null, 2));
  console.log(`${candidate.id}: stored one local comparison image`);
}

console.log(JSON.stringify({ outputDir, candidates: manifest.map(({ id, model, publicEstimatedUsd }) => ({ id, model, publicEstimatedUsd })) }, null, 2));
