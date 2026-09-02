/**
 * Render three explicit premium thumbnail proofs through the production module.
 *
 * Fal Nano Banana Pro owns the complete scene and native physical typography.
 * The thumbnail module owns channel playbooks, click-hook planning, 1280x720
 * delivery, exact-copy OCR/transcription, and the independent mobile QA gate.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertThumbnailGate, type ThumbnailGateVerdict } from "@/engine/qualityPolicy";
import type { StyleDNA } from "@/engine/creative/types";
import {
  buildStyleDnaPlaybook,
  renderCandidate,
  runThumbnailMobileReferenceQa,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";
import type { ThumbnailTextZone } from "@/lib/thumbnailLayout";

const MODEL = "fal-ai/nano-banana-pro";
const ROUTE = `https://fal.run/${MODEL}`;
const OUTPUT_COST_USD = 0.15;
const OUT_DIR = process.env.THUMBNAIL_PROOF_DIR?.trim()
  || "/tmp/ysa-fal-nano-banana-pro-thumbnail-examples";
const REQUESTED_PROOF_KEY = process.env.THUMBNAIL_PROOF_KEY?.trim();
const MAX_ATTEMPTS = Math.max(1, Math.min(2, Number(process.env.THUMBNAIL_PROOF_MAX_ATTEMPTS ?? "2")));
const QA_EXISTING = process.env.THUMBNAIL_PROOF_QA_EXISTING === "1";
const PROMPT_ONLY = process.env.THUMBNAIL_PROOF_PROMPT_ONLY === "1";
const REQUESTED_ATTEMPT = process.env.THUMBNAIL_PROOF_ATTEMPT
  ? Math.max(1, Math.min(2, Number(process.env.THUMBNAIL_PROOF_ATTEMPT)))
  : null;

type ChannelRow = {
  _id: string;
  name: string;
  slug: string;
  ownerId: string;
  styleDNA?: StyleDNA;
  thumbnailPlaybook?: ThumbnailPlaybook;
};

type FalPayload = {
  images?: Array<{
    url?: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
  description?: string;
  request_id?: string;
  error?: string | { message?: string };
};

type ProviderReceipt = {
  provider: "fal";
  model: typeof MODEL;
  resolution: "2K";
  aspectRatio: "16:9";
  requestId: string | null;
  requestSha256: string;
  responseSha256: string;
  outputCostUsd: typeof OUTPUT_COST_USD;
  createdAt: number;
};

type ProofJob = {
  key: string;
  channelName: string;
  niche: string;
  title: string;
  sceneMandate: string;
  sceneDescription: string;
  textZone: ThumbnailTextZone;
  lines: Array<{ text: string; accent?: boolean; payoff?: boolean }>;
  pattern: string;
  playbook: ThumbnailPlaybook;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function readProductionChannels(): ChannelRow[] {
  const raw = execFileSync(
    join(process.cwd(), "node_modules/.bin/convex"),
    ["data", "channels", "--limit", "100", "--format", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 24 * 1024 * 1024,
      env: { ...process.env, CONVEX_DEPLOYMENT: "prod:astute-camel-689" },
    },
  );
  return (JSON.parse(raw) as ChannelRow[]).filter((channel) => channel.ownerId === "owner_daniel");
}

function requireLivePlaybook(channels: ChannelRow[], name: string): ChannelRow & {
  styleDNA: StyleDNA;
  thumbnailPlaybook: ThumbnailPlaybook;
} {
  const channel = channels.find((candidate) => candidate.name === name);
  if (!channel?.styleDNA || !channel.thumbnailPlaybook) {
    throw new Error(`${name}: live Style DNA and thumbnail playbook are required`);
  }
  return channel as ChannelRow & { styleDNA: StyleDNA; thumbnailPlaybook: ThumbnailPlaybook };
}

function requireLiveStyle(channels: ChannelRow[], name: string): ChannelRow & {
  styleDNA: StyleDNA;
} {
  const channel = channels.find((candidate) => candidate.name === name);
  if (!channel?.styleDNA) throw new Error(`${name}: live Style DNA is required`);
  return channel as ChannelRow & { styleDNA: StyleDNA };
}

function historyPlaybook(): ThumbnailPlaybook {
  const dna = {
    recurringSubject:
      "one ink-stained artist hand drawing cross-hatched historical figures whose whole scene remains visibly hand-drawn",
    setting:
      "warm paper-cream whiteboard canvas with sepia ink linework and one restrained burnt-orange accent",
    palette: ["#f5efe0", "#2b2620", "#c45a1d", "#6b5d4a"],
    thumbnail: {
      subject:
        "a fully hand-drawn medieval town square where exhausted townsfolk dance uncontrollably, with an ink-stained artist hand completing the scene",
      composition:
        "one large cross-hatched historical story moment opposite a clean hand-drawn text zone",
      palette: ["#f5efe0", "#2b2620", "#c45a1d"],
      textRule: "one short curiosity hook, marker-set and mobile-legible",
    },
    visualAvoid: [
      "photorealism",
      "stock photography",
      "modern objects",
      "neon",
      "partly photographed scenery",
    ],
  } as unknown as StyleDNA;
  return buildStyleDnaPlaybook({
    dna,
    family: "whiteboard",
    channelName: "The Drawn Past",
    now: 1_788_278_400_000,
  });
}

function proofJobs(channels: ChannelRow[]): ProofJob[] {
  const investory = requireLivePlaybook(channels, "Investory");
  const comic = requireLivePlaybook(channels, "Inked Histories");
  const chalk = requireLiveStyle(channels, "Chalk & Compound");
  const gratitude = requireLivePlaybook(channels, "Gratitude Springs");
  const chalkPlaybook = chalk.thumbnailPlaybook ?? buildStyleDnaPlaybook({
    dna: chalk.styleDNA,
    family: "whiteboard",
    channelName: chalk.name,
    now: 1_788_278_400_000,
  });
  const gratitudePeoplePlaybook: ThumbnailPlaybook = {
    ...gratitude.thumbnailPlaybook,
    avoid: [
      ...gratitude.thumbnailPlaybook.avoid,
      "No subtitle, tagline, supporting sentence, or other small text; this video uses only the exact two-word emotional hook and the compact channel badge.",
    ],
    patterns: gratitude.thumbnailPlaybook.patterns.map((pattern) => pattern.name === "The Totem"
      ? {
          ...pattern,
          textRecipe: {
            ...pattern.textRecipe,
            lines: [
              { text: "NEVER", accent: false },
              { text: "ALONE", accent: true },
            ],
          },
        }
      : pattern),
  };
  return [
    {
      key: "investory",
      channelName: investory.name,
      niche: "finance documentary",
      title: "How to Turn $10,000 Into $1,000/Month — The Exact Math",
      sceneMandate:
        "one iconic non-human financial object that makes compounding income physically obvious, staged in Investory's navy-black and restrained gold world",
      sceneDescription:
        "A monumental shattered hourglass is cropped hard by the right edge. Inside it, a restrained stream of brushed-gold coins multiplies through exposed precision gears and spills into a disciplined monthly cascade. A torn dark ledger and one rising gold graph line form supporting depth behind it in a deep navy analyst's office, with one warm rim light. The left side stays dark and graphically simple, while the hourglass silhouette intrudes slightly toward it. Editorial finance poster, tactile glass, metal and paper, not an abstract product render.",
      textZone: "left",
      lines: [
        { text: "$10K", accent: true, payoff: true },
        { text: "TO $1K/MO", accent: false },
      ],
      pattern: "The Quantifier",
      playbook: investory.thumbnailPlaybook,
    },
    {
      key: "history",
      channelName: "The Drawn Past",
      niche: "hand-drawn history explainer",
      title: "The Plague That Made People Dance",
      sceneMandate:
        "the entire scene is visibly drawn in sepia cross-hatching on warm paper: frightened medieval townsfolk dancing uncontrollably while one ink-stained artist hand completes the drawing",
      sceneDescription:
        "A premium edge-to-edge engraved history poster on weathered warm paper: three exhausted and terrified medieval townsfolk twist in an uncontrollable dance, aggressively cropped on the right, while a giant ink-stained artist hand completes one victim's contorted ankle. Dense charcoal and sepia cross-hatching, a restrained burnt-orange motion slash, torn archive fragments receding behind them, dramatic chiaroscuro. The upper-left is darker and graphically simple but one frantic arm intrudes into it. Fully illustrated, never photographic, no classroom whiteboard or panel frame.",
      textZone: "upperLeft",
      lines: [
        { text: "COULDN'T", accent: false },
        { text: "STOP", accent: true, payoff: true },
      ],
      pattern: "signature-hero",
      playbook: historyPlaybook(),
    },
    {
      key: "comic",
      channelName: comic.name,
      niche: "historical motion comic",
      title: "The Medic Who Saved 75 Men At Hacksaw Ridge",
      sceneMandate:
        "a fully illustrated cross-hatched papercraft comic panel of a lone unarmed battlefield medic lowering a wounded soldier down a smoky cliff, with layered torn parchment depth",
      sceneDescription:
        "A premium cinematic cross-hatched war-comic poster, not a comic-page panel: one unarmed battlefield medic is cropped hard on the right as he braces a rope with bleeding hands and lowers one wounded soldier over a jagged smoky cliff. Torn parchment, charcoal smoke and a distant burning ridge create three deep layers; sepia, charcoal, muted steel blue and one restrained rust accent; harsh single-source battlefield light. The left is dark and graphically simple, while the taut rope cuts into it as a meaningful contour. No photographic pixels, speech bubbles, borders or panel frame.",
      textZone: "left",
      lines: [
        { text: "75 LIVES", accent: true, payoff: true },
        { text: "ONE MEDIC", accent: false },
      ],
      pattern: "The Portrait",
      playbook: comic.thumbnailPlaybook,
    },
    {
      key: "real-comic-relics",
      channelName: comic.name,
      niche: "historical motion comic",
      title: "7 Secrets of Battlefield Relic Preservation Revealed",
      sceneMandate:
        "a single premium cross-hatched papercraft archaeological discovery from the real video: a century-old leather satchel emerges intact from sealed blue clay, with its preserved handwritten letter visible as the consequence",
      sceneDescription:
        "A premium edge-to-edge cinematic archaeological comic poster: a mud-streaked conservator's gloved hands pull a perfectly preserved brown leather satchel from dense sealed blue-grey clay at the peak moment of discovery. The satchel dominates the right half and is cropped hard by the edge; its patinated brass buckle has just opened, revealing one startlingly intact handwritten letter as the smaller proof detail. A compressed earth cross-section and tangled roots create layered depth behind it. Sepia paper, charcoal, muted steel blue and one restrained rust-red accent; hard diagonal from the headline zone through the hands to the letter; dramatic chiaroscuro, visible cross-hatching and torn papercraft edges. No photography, modern laboratory, generic museum display, panel borders or speech bubbles.",
      textZone: "left",
      lines: [],
      pattern: "The Artifact",
      playbook: comic.thumbnailPlaybook,
    },
    {
      key: "real-chalk-tax",
      channelName: chalk.name,
      niche: "hand-drawn personal finance explainer",
      title: "Taxation Isn't Complex: A Simple Framework",
      sceneMandate:
        "one instantly readable chalkboard cause-and-consequence diagram from the real video: a paycheck dollar is split by taxation into a few concrete public outcomes, drawn inside Chalk & Compound's antique dark-academic ledger world",
      sceneDescription:
        "A premium dark-academic chalk illustration on an open antique brass-bound ledger: one oversized chalk dollar bill enters from the upper right and is decisively split by a thick percentage wedge into three clean paths ending in a road, a school and a hospital icon. A real chalk-covered hand completes the split at the peak action moment. The ledger and hand dominate the right two-thirds and are cropped decisively; the left remains dark, simple slate for the hook while one gold chalk arrow crosses into it. Deep charcoal #1a1c23, warm white chalk, restrained brass-gold #e0b35a and one muted green #5a8b7c accent; dusty side light, tactile chalk grain, strong diagonal eye path, no stock cash, calculators, app UI, neon or vector infographic styling.",
      textZone: "left",
      lines: [],
      pattern: chalkPlaybook.patterns[0]?.name ?? "signature-hero",
      playbook: chalkPlaybook,
    },
    {
      key: "real-gratitude-people",
      channelName: gratitude.name,
      niche: "guided gratitude sleep meditation",
      title: "Gratitude for the People Beside You Brings Deep Sleep",
      sceneMandate:
        "a serene but emotionally immediate non-LoFi sleep thumbnail for the real meditation: two unmistakably paired river stones communicate that a loved one remains beside you, using only the exact two-word hook NEVER ALONE; show GRATITUDE SPRINGS exactly once in one compact bottom-left badge, never beneath the headline, and include no subtitle or extra copy",
      sceneDescription:
        "A premium hyperreal cinematic twilight riverbank: two smooth ancient river stones rest closely together in the lower-right third, one slightly sheltering the other, their touching edges joined by a soft cornflower-blue inner glow. A single luminous ripple expands from both stones into dark navy water, creating the smaller consequence detail and a gentle diagonal toward the upper-left hook zone. Mist curls around their bases; distant foliage is deeply defocused; cool #032B44 and #4567b7 shadows, soft #b2c8ba mist and restrained #6495ED glow. The stones are large, tactile and decisively edge-cropped; the upper-left stays simple and dark. No people, faces, hands, beds, AI-lofi character, generic spa stock, bright orange, UI or clutter.",
      textZone: "upperLeft",
      lines: [],
      pattern: "The Totem",
      playbook: gratitudePeoplePlaybook,
    },
  ];
}

async function generateProThumbnail(
  prompt: string,
  context: string,
): Promise<{ bytes: Buffer; receipt: ProviderReceipt }> {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) throw new Error("FAL_KEY is required");
  const body = {
    prompt: prompt.trim(),
    num_images: 1,
    aspect_ratio: "16:9",
    output_format: "png",
    safety_tolerance: "4",
    resolution: "2K",
    limit_generations: true,
    enable_web_search: false,
  } as const;
  const requestCanonical = JSON.stringify({ context, model: MODEL, body });
  const requestSha256 = sha256(requestCanonical);
  let response: Response;
  try {
    response = await fetch(ROUTE, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (error) {
    throw new Error(
      `Fal Nano Banana Pro submission became ambiguous; refusing automatic replay (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const raw = await response.text();
  let payload: FalPayload;
  try {
    payload = JSON.parse(raw) as FalPayload;
  } catch {
    throw new Error(`Fal Nano Banana Pro returned unreadable HTTP ${response.status}; refusing replay`);
  }
  if (!response.ok) {
    const detail = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message ?? raw.slice(0, 200);
    throw new Error(`Fal Nano Banana Pro HTTP ${response.status}: ${detail}`);
  }
  const image = payload.images?.[0];
  if (payload.images?.length !== 1 || !image?.url || !image.url.startsWith("https://")) {
    throw new Error("Fal Nano Banana Pro returned no single durable HTTPS image output; refusing replay");
  }
  const download = await fetch(image.url, { signal: AbortSignal.timeout(120_000) });
  if (!download.ok) {
    throw new Error(`Fal Nano Banana Pro completed but output download failed with HTTP ${download.status}`);
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.byteLength < 16_384) throw new Error("Fal Nano Banana Pro output was implausibly small");
  return {
    bytes,
    receipt: {
      provider: "fal",
      model: MODEL,
      resolution: "2K",
      aspectRatio: "16:9",
      requestId: response.headers.get("x-fal-request-id")?.trim()
        || payload.request_id?.trim()
        || null,
      requestSha256,
      responseSha256: sha256(bytes),
      outputCostUsd: OUTPUT_COST_USD,
      createdAt: Date.now(),
    },
  };
}

async function runJob(job: ProofJob): Promise<void> {
  const jobDir = join(OUT_DIR, job.key);
  await mkdir(jobDir, { recursive: true });
  let priorIssues: string[] = [];
  const firstAttempt = REQUESTED_ATTEMPT ?? 1;
  const lastAttempt = REQUESTED_ATTEMPT ?? MAX_ATTEMPTS;
  for (let attempt = firstAttempt; attempt <= lastAttempt; attempt++) {
    const outJpg = join(jobDir, `${job.key}-attempt-${attempt}.jpg`);
    const providerReceiptPath = join(jobDir, `${job.key}-attempt-${attempt}.provider-receipt.json`);
    const receipts: ProviderReceipt[] = [];
    const visualLanguage = job.playbook.visualLanguage ?? {};
    const selectedPattern = job.playbook.patterns.find((pattern) => pattern.name === job.pattern)
      ?? job.playbook.patterns[0];
    if (!selectedPattern) throw new Error(`${job.key}: playbook has no executable pattern`);
    const result = QA_EXISTING ? { path: outJpg } : await renderCandidate({
      title: job.title,
      channelName: job.channelName,
      pattern: selectedPattern,
      sceneSeed: job.sceneDescription,
      sceneMandate: job.sceneMandate,
      playbook: job.playbook,
      outJpg,
      tmpDir: jobDir,
      idx: attempt - 1,
      priorIssues,
      generateDesignedThumbnail: async (request) => {
        // Persist the exact native plan before any paid provider boundary so
        // recovery and OCR QA can never lose the copy it must verify.
        await writeFile(
          join(jobDir, `${job.key}-attempt-${attempt}.native-plan.json`),
          `${JSON.stringify({ prompt: request.prompt, expectWords: request.expectWords, brief: request.brief }, null, 2)}\n`,
          "utf8",
        );
        if (PROMPT_ONLY) {
          throw new Error("PROMPT_ONLY_COMPLETE");
        }
        const generated = await generateProThumbnail(
          request.prompt,
          `thumbnail-proof/${job.key}/attempt-${attempt}/${sha256(request.prompt)}`,
        );
        receipts.push(generated.receipt);
        return generated.bytes;
      },
    });
    const providerReceipt: ProviderReceipt | null = QA_EXISTING
      ? await readFile(providerReceiptPath, "utf8")
        .then((value) => JSON.parse(value) as ProviderReceipt)
        .catch(() => null)
      : receipts[0];
    if (!QA_EXISTING && !providerReceipt) {
      throw new Error(`${job.key}: expected exactly one paid scene receipt`);
    }
    if (!QA_EXISTING) {
      // Persist paid-call evidence before independent QA so a judge outage can
      // never erase the receipt for a completed provider request.
      await writeFile(providerReceiptPath, `${JSON.stringify(providerReceipt, null, 2)}\n`, "utf8");
    }
    const expectedWords = "expectedWords" in result
      ? result.expectedWords
      : await readFile(join(jobDir, `${job.key}-attempt-${attempt}.native-plan.json`), "utf8")
        .then((value) => {
          const parsed = JSON.parse(value) as { expectWords?: string[] };
          return parsed.expectWords;
        })
        .catch(() => undefined);
    const verdict = await runThumbnailMobileReferenceQa({
      outJpg: result.path,
      tmpDir: jobDir,
      title: job.title,
      niche: job.niche,
      playbook: job.playbook,
      referenceUrls: [],
      brandContext: {
        channelName: job.channelName,
        visualLanguage: job.playbook.visualLanguage,
        sceneMandate: job.sceneMandate,
      },
      expectedWords,
      qaTier: "final",
      log: (message) => console.log(`[${job.key}] ${message}`),
    });
    await writeFile(
      join(jobDir, `${job.key}-attempt-${attempt}.receipt.json`),
      `${JSON.stringify({
        contract: "fal-nano-banana-pro-thumbnail-proof/v1",
        channelName: job.channelName,
        title: job.title,
        pattern: job.pattern,
        provider: providerReceipt,
        providerEvidence: providerReceipt
          ? "persisted-before-qa"
          : "unavailable-for-pre-fix-proof; the old wrapper persisted receipts only after QA",
        outputSha256: sha256(await readFile(result.path)),
        qa: verdict,
      }, null, 2)}\n`,
      "utf8",
    );
    try {
      assertThumbnailGate("production", verdict, `${job.channelName} proof attempt ${attempt}`);
      await writeFile(join(jobDir, "accepted.txt"), `${result.path}\n`, "utf8");
      console.log(`[${job.key}] ACCEPTED ${result.path} ${JSON.stringify(verdict)}`);
      return;
    } catch (error) {
      priorIssues = [verdict.reason, ...verdictIssues(verdict)];
      console.log(`[${job.key}] REJECTED attempt ${attempt}: ${priorIssues.join("; ")}`);
      if (attempt === MAX_ATTEMPTS) throw error;
    }
  }
}

function verdictIssues(verdict: ThumbnailGateVerdict): string[] {
  return [
    ...(!verdict.textOk ? ["visible typography is misspelled or not readable at mobile size"] : []),
    ...(!verdict.faceClear ? ["intended face or figure anatomy is unclear"] : []),
    ...(verdict.punch < 7 ? [`punch is only ${verdict.punch}/10`] : []),
    ...(verdict.styleMatch < 7 ? [`channel style match is only ${verdict.styleMatch}/10`] : []),
    ...(verdict.storyMatch < 7 ? [`story match is only ${verdict.storyMatch}/10`] : []),
    ...(!verdict.uiClean ? ["candidate has accidental UI, glyph, clipping, watermark, or clutter"] : []),
  ];
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const channels = readProductionChannels();
  const jobs = proofJobs(channels).filter((job) => !REQUESTED_PROOF_KEY || job.key === REQUESTED_PROOF_KEY);
  if (jobs.length === 0) throw new Error(`Unknown THUMBNAIL_PROOF_KEY: ${REQUESTED_PROOF_KEY}`);
  for (const job of jobs) await runJob(job);
  console.log(`ALL PROOFS ACCEPTED ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
