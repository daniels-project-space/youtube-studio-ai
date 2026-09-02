/**
 * Reviewed, channel-world banner refresh.
 *
 * This is intentionally two-phase. Generation uses the same receipt-bound,
 * Fal Nano Banana + vision-judge channel-art contract as Channel Inception,
 * but it leaves the accepted candidate off the live channel until its local
 * preview and manifest are explicitly accepted. Existing art stays a rollback
 * until the compare-and-swap succeeds.
 *
 * Preview one or more exact channel worlds (maximum $0.12 per channel):
 *   npx tsx --env-file=.env.local scripts/refresh-channel-banners.ts \
 *     --generate --channel=investory --channel=seaside-ghibli-lofi \
 *     --confirm-max-spend-usd=0.24
 *
 * Apply only the reviewed manifest:
 *   npx tsx --env-file=.env.local scripts/refresh-channel-banners.ts \
 *     --apply --confirm-manifest-sha256=<printed sha>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  bannerPrompt,
  channelArtIdentityFromSource,
  generateChannelArtAsset,
} from "@/lib/channelArt";
import { FAL_NANO_BANANA_BANNER_PROFILE } from "@/lib/falNanoBananaBannerContract";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { getObjectBytes, headObjectMetadata } from "@/lib/storage";
import { hydrateEnv } from "@/lib/vault";

const OWNER_ID = "owner_daniel";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud";
const VERSION = process.argv.find((arg) => arg.startsWith("--version="))
  ?.slice("--version=".length) ?? "channel-world-refresh-20260902-v1";
const MAX_ATTEMPTS = 3;
const MAX_PER_CHANNEL_USD = Number((
  MAX_ATTEMPTS * FAL_NANO_BANANA_BANNER_PROFILE.admissionCeilingUsd
).toFixed(2));
const OUTPUT_DIR = join(process.cwd(), "output", "channel-banners", VERSION);
const MANIFEST_PATH = join(OUTPUT_DIR, "manifest.json");

type Channel = Doc<"channels">;

interface ApprovalReceipt {
  status: "approved";
  kind: "banner";
  outputKey: string;
  providerRoute: string;
  score: number;
  attempts: number;
}

interface GeneratedRow {
  channelId: Id<"channels">;
  name: string;
  slug: string;
  oldBannerKey?: string;
  newBannerKey?: string;
  approvalKey?: string;
  localPath?: string;
  outputSha256?: string;
  prompt: string;
  approval?: ApprovalReceipt;
  error?: string;
}

interface RefreshManifest {
  contractVersion: "channel-banner-refresh/v1";
  ownerId: typeof OWNER_ID;
  version: string;
  generatedAt: string;
  maxAttemptsPerChannel: number;
  maximumSpendUsd: number;
  rows: GeneratedRow[];
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function studioClient(): StudioConvexHttpClient {
  return new StudioConvexHttpClient(CONVEX_URL);
}

async function channels(client: StudioConvexHttpClient): Promise<Channel[]> {
  return await client.query(api.channels.listChannels, { ownerId: OWNER_ID }) as Channel[];
}

function requestedSlugs(): string[] {
  return [...new Set(process.argv
    .filter((arg) => arg.startsWith("--channel="))
    .map((arg) => arg.slice("--channel=".length).trim())
    .filter(Boolean))];
}

function approvalKeyFor(bannerKey: string): string {
  if (!bannerKey.endsWith("/approved.jpg")) {
    throw new Error(`unexpected approved banner key: ${bannerKey}`);
  }
  return `${bannerKey.slice(0, -"approved.jpg".length)}approval.json`;
}

function parseApproval(value: unknown, expectedKey: string): ApprovalReceipt {
  if (!value || typeof value !== "object") throw new Error("banner approval receipt is not an object");
  const approval = value as Record<string, unknown>;
  if (approval.status !== "approved" || approval.kind !== "banner") {
    throw new Error("banner candidate is not approved by the channel-art contract");
  }
  if (approval.outputKey !== expectedKey) throw new Error("banner approval output key mismatch");
  if (approval.providerRoute !== FAL_NANO_BANANA_BANNER_PROFILE.route) {
    throw new Error("banner approval provider route mismatch");
  }
  const score = typeof approval.score === "number" ? approval.score : Number.NaN;
  const attempts = typeof approval.attempts === "number" ? approval.attempts : Number.NaN;
  if (!Number.isFinite(score) || score < 0.84 || score > 1) {
    throw new Error("banner approval score is below the contracted threshold");
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw new Error("banner approval attempts are outside the reviewed refresh limit");
  }
  return {
    status: "approved",
    kind: "banner",
    outputKey: approval.outputKey,
    providerRoute: approval.providerRoute,
    score,
    attempts,
  };
}

async function readApproval(bannerKey: string): Promise<ApprovalReceipt> {
  const key = approvalKeyFor(bannerKey);
  const bytes = await getObjectBytes(key);
  return parseApproval(JSON.parse(Buffer.from(bytes).toString("utf8")), bannerKey);
}

function selectTargets(rows: Channel[], slugs: readonly string[]): Channel[] {
  const selected = rows.filter((channel) => slugs.includes(channel.slug));
  const missing = slugs.filter((slug) => !selected.some((channel) => channel.slug === slug));
  if (missing.length) throw new Error(`channel slug(s) not found: ${missing.join(", ")}`);
  return selected;
}

async function generate(): Promise<void> {
  const slugs = requestedSlugs();
  if (!slugs.length) {
    throw new Error("generation requires at least one --channel=<channel-slug>");
  }
  const maximumSpendUsd = Number((slugs.length * MAX_PER_CHANNEL_USD).toFixed(2));
  if (!process.argv.includes(`--confirm-max-spend-usd=${maximumSpendUsd.toFixed(2)}`)) {
    throw new Error(`generation requires --confirm-max-spend-usd=${maximumSpendUsd.toFixed(2)}`);
  }
  // The accepted candidate and its judge receipt are durably stored before
  // this script writes a review manifest. Never call the provider first and
  // discover that a rollback-safe storage destination is unavailable.
  if (!process.env.R2_ACCESS_KEY_ID) await hydrateEnv("cloudflare");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const selected = selectTargets(await channels(studioClient()), slugs);
  const manifest: RefreshManifest = {
    contractVersion: "channel-banner-refresh/v1",
    ownerId: OWNER_ID,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    maxAttemptsPerChannel: MAX_ATTEMPTS,
    maximumSpendUsd,
    rows: [],
  };

  for (const channel of selected) {
    const identity = channelArtIdentityFromSource({
      name: channel.name,
      identity: channel.identity,
      styleDNA: channel.styleDNA as Channel["styleDNA"],
    });
    const row: GeneratedRow = {
      channelId: channel._id,
      name: channel.name,
      slug: channel.slug,
      oldBannerKey: channel.identity?.bannerKey,
      prompt: bannerPrompt(identity),
    };
    try {
      console.log(`\n[banner] ${channel.name}`);
      const newBannerKey = await generateChannelArtAsset(
        OWNER_ID,
        channel.slug,
        "banner",
        identity,
        (message, extra) => console.log(`  ${message}`, extra ?? ""),
        {
          version: { banner: VERSION },
          maxAttempts: MAX_ATTEMPTS,
          maxProviderSpendUsd: MAX_PER_CHANNEL_USD,
        },
      );
      const approval = await readApproval(newBannerKey);
      const previewBytes = await getObjectBytes(newBannerKey);
      const localPath = join(OUTPUT_DIR, `${channel.slug}.jpg`);
      await writeFile(localPath, previewBytes);
      row.newBannerKey = newBannerKey;
      row.approvalKey = approvalKeyFor(newBannerKey);
      row.localPath = localPath;
      row.outputSha256 = sha256(previewBytes);
      row.approval = approval;
      console.log(`  staged ${newBannerKey} (judge ${approval.score.toFixed(2)}, ${approval.attempts} attempt(s))`);
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED: ${row.error}`);
    }
    manifest.rows.push(row);
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const manifestBytes = await readFile(MANIFEST_PATH);
  const manifestSha256 = sha256(manifestBytes);
  console.log(`\nmanifest: ${MANIFEST_PATH}`);
  console.log(`manifest sha256: ${manifestSha256}`);
  if (manifest.rows.some((row) => row.error || !row.newBannerKey || !row.localPath || !row.approval)) {
    throw new Error("one or more banner candidates failed; inspect the manifest and rerun failed channels under a new --version");
  }
}

async function apply(): Promise<void> {
  const bytes = await readFile(MANIFEST_PATH);
  const expectedSha256 = process.argv.find((arg) => arg.startsWith("--confirm-manifest-sha256="))
    ?.split("=", 2)[1];
  const actualSha256 = sha256(bytes);
  if (!expectedSha256 || expectedSha256 !== actualSha256) {
    throw new Error(`apply requires --confirm-manifest-sha256=${actualSha256}`);
  }
  const manifest = JSON.parse(bytes.toString("utf8")) as RefreshManifest;
  if (
    manifest.contractVersion !== "channel-banner-refresh/v1" ||
    manifest.ownerId !== OWNER_ID ||
    manifest.version !== VERSION ||
    manifest.maxAttemptsPerChannel !== MAX_ATTEMPTS ||
    manifest.rows.length === 0 ||
    manifest.rows.some((row) =>
      row.error || !row.newBannerKey || !row.oldBannerKey || !row.outputSha256 || !row.approval ||
      row.approval.outputKey !== row.newBannerKey,
    )
  ) {
    throw new Error("manifest is incomplete or does not match the sealed refresh contract");
  }
  if (!process.env.R2_ACCESS_KEY_ID) await hydrateEnv("cloudflare");

  const before = await channels(studioClient());
  for (const row of manifest.rows) {
    const stored = await getObjectBytes(row.newBannerKey!);
    if (sha256(stored) !== row.outputSha256) {
      throw new Error(`approved banner bytes drifted before apply: ${row.name}`);
    }
    if (!await headObjectMetadata(row.newBannerKey!)) {
      throw new Error(`approved banner disappeared before apply: ${row.name}`);
    }
    await readApproval(row.newBannerKey!);
  }

  const writer = studioClient();
  for (const row of manifest.rows) {
    const channel = before.find((candidate) => candidate._id === row.channelId);
    if (!channel || channel.name !== row.name || channel.slug !== row.slug) {
      throw new Error(`channel identity drifted before apply: ${row.name}`);
    }
    if (channel.locked) throw new Error(`channel became locked before apply: ${row.name}`);
    if (channel.identity?.bannerKey === row.newBannerKey) {
      console.log(`ALREADY APPLIED ${row.name}: ${row.newBannerKey}`);
      continue;
    }
    if (channel.identity?.bannerKey !== row.oldBannerKey) {
      throw new Error(`banner compare-and-swap failed for ${row.name}`);
    }
    const result = await writer.mutation(api.channels.updateChannel, {
      channelId: channel._id,
      identity: { ...channel.identity, bannerKey: row.newBannerKey },
    });
    if (result.forked || result.state === "channel_locked") {
      throw new Error(`banner apply was rejected for ${row.name}`);
    }
    console.log(`APPLIED ${row.name}: ${row.oldBannerKey} -> ${row.newBannerKey}`);
  }

  const after = await channels(studioClient());
  for (const row of manifest.rows) {
    const channel = after.find((candidate) => candidate._id === row.channelId);
    if (channel?.identity?.bannerKey !== row.newBannerKey) {
      throw new Error(`post-apply verification failed for ${row.name}`);
    }
  }
  await writeFile(
    join(OUTPUT_DIR, "applied.json"),
    `${JSON.stringify({ manifestSha256: actualSha256, appliedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

async function dryRun(): Promise<void> {
  const rows = await channels(studioClient());
  for (const channel of rows) {
    const identity = channelArtIdentityFromSource({
      name: channel.name,
      identity: channel.identity,
      styleDNA: channel.styleDNA as Channel["styleDNA"],
    });
    console.log(`${channel.slug}\n  ${channel.identity?.bannerKey ?? "no current banner"}\n  ${bannerPrompt(identity)}\n`);
  }
  console.log("Use --generate with one or more --channel=<slug> flags to stage review candidates.");
}

async function main(): Promise<void> {
  if (process.argv.includes("--generate") && process.argv.includes("--apply")) {
    throw new Error("choose exactly one of --generate or --apply");
  }
  if (process.argv.includes("--generate")) await generate();
  else if (process.argv.includes("--apply")) await apply();
  else await dryRun();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
