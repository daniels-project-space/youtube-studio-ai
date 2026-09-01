/**
 * Curated Nano Banana avatar refresh for the current non-Stoic channel fleet.
 *
 * Dry-run is the default. Generation writes provider-receipted local review
 * copies but does not publish or change a channel. Reviewed files are staged
 * and adopted separately, so no unchecked render can become a live avatar.
 *
 * Generate (one candidate each; maximum 9 images / $0.36):
 *   npx tsx --env-file=.env.local \
 *     scripts/refresh-channel-avatars.ts --generate --confirm-max-spend-usd=0.36
 *
 * Apply only after reviewing manifest.json and every local image:
 *   npx tsx --env-file=.env.local scripts/refresh-channel-avatars.ts \
 *     --apply --confirm-manifest-sha256=<sha256 printed by generate>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { generateFalNanoBananaAvatarImageWithReceipt } from "@/lib/falNanoBananaAvatar";
import {
  NANO_BANANA_AVATAR_PROFILE,
  type NanoBananaAvatarReceipt,
} from "@/lib/nanoBananaAvatarContract";
import {
  avatarPrompt,
  type ArtIdentity,
} from "@/lib/channelArt";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { imageToJpeg } from "@/lib/ffmpeg";
import { channelKey, headObjectMetadata, putObject } from "@/lib/storage";
import { hydrateEnv } from "@/lib/vault";

const OWNER_ID = "owner_daniel";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud";
const VERSION = "nano-avatar-20260901-v1";
const MAX_ATTEMPTS = 1;
const MAX_TOTAL_USD = 0.36;
const OUTPUT_DIR = join(process.cwd(), "output", "channel-avatars", VERSION);
const MANIFEST_PATH = join(OUTPUT_DIR, "manifest.json");

const TARGETS: Readonly<Record<string, Omit<ArtIdentity, "name" | "niche">>> = {
  "Rainy Neon Lofi": {
    persona: "quiet nocturnal focus with rain and electric music",
    iconicMotif: "one luminous raindrop enclosing exactly three simple equalizer bars and one restrained ripple",
    styleGrammar: "authored editorial enamel-and-screenprint identity mark with subtle handmade grain and bold negative space",
    palette: ["ink black", "midnight indigo", "electric cyan", "restrained neon magenta"],
    vibe: "calm midnight focus",
  },
  "Drift & Study": {
    persona: "slow travel, private concentration and warm night study",
    iconicMotif: "one rounded train-window emblem containing a crescent moon crossed by a single drifting rail line",
    styleGrammar: "mid-century travel badge reinterpreted as a minimal editorial print with tactile paper grain",
    palette: ["deep navy", "lamp amber", "smoky blue", "warm cream"],
    vibe: "restful motion and concentration",
  },
  "Dusk Frequency": {
    persona: "late-evening music, analog warmth and low-key introspection",
    iconicMotif: "one low setting-sun disk crossed by exactly three broad horizontal sound waves",
    styleGrammar: "original analog record-label mark, block-printed edges, bold silhouette, no literal room or person",
    palette: ["charcoal", "burnt orange", "dusty gold", "aubergine"],
    vibe: "warm dusk signal",
  },
  "Seaside Ghibli Lofi": {
    persona: "gentle coastal study ambience and original storybook warmth",
    iconicMotif: "one friendly lighthouse rising directly from a single crescent-shaped wave",
    styleGrammar: "original hand-painted storybook gouache emblem with carved-print simplicity; no existing characters or studio imitation",
    palette: ["storm navy", "seafoam", "sun-warmed coral", "ivory"],
    vibe: "safe harbor and soft concentration",
  },
  Investory: {
    persona: "financial history explained through patient long-term thinking",
    iconicMotif: "one antique bronze key whose three teeth form a clean ascending compound-growth rhythm",
    styleGrammar: "sober heritage-finance seal with engraved print texture and strong museum-grade silhouette",
    palette: ["near black", "aged bronze", "parchment", "muted teal"],
    vibe: "earned insight and durable value",
  },
  "Chalk & Compound": {
    persona: "plainspoken finance explained visibly on a chalkboard",
    iconicMotif: "one thick chalk spiral that resolves into a simple upward compounding curve, drawn as a single continuous mark",
    styleGrammar: "hand-drawn chalk identity stamp, confidently imperfect edges, large simple geometry",
    palette: ["blackboard green", "warm white chalk", "muted brass"],
    vibe: "clear, practical and teacherly",
  },
  "Inked Histories": {
    persona: "human history told through bold archival illustration",
    iconicMotif: "one black quill whose lower stroke becomes a compact antique wax-seal silhouette",
    styleGrammar: "expressive woodcut-and-ink press mark with authentic dry-brush texture and one decisive silhouette",
    palette: ["ink black", "aged parchment", "oxblood red"],
    vibe: "weighty, curious and archival",
  },
  "Neon Rain Penthouse": {
    persona: "luxury night ambience, rain and deep-focus electronic music",
    iconicMotif: "one angular penthouse-window outline containing one oversized raindrop above a single low neon horizon line",
    styleGrammar: "bespoke architectural night-club insignia, restrained print grain, sharp negative space, not a literal skyline scene",
    palette: ["black violet", "ultraviolet", "electric blue", "one hot-pink accent"],
    vibe: "private height and midnight rain",
  },
  "Gratitude Springs": {
    persona: "quiet guided gratitude and restorative ambient meditation",
    iconicMotif: "one smooth river stone above exactly three broad spring ripples with a small sunrise cut into the stone",
    styleGrammar: "calm Japanese-inspired editorial print mark with natural paper grain and generous empty space",
    palette: ["deep teal", "mineral blue", "soft sunrise gold", "warm stone"],
    vibe: "grounded renewal",
  },
};

type Channel = Doc<"channels">;

interface GeneratedRow {
  channelId: Id<"channels">;
  name: string;
  slug: string;
  oldKey?: string;
  newKey?: string;
  localPath?: string;
  sourceSha256?: string;
  jpegSha256?: string;
  prompt: string;
  providerReceipt?: NanoBananaAvatarReceipt;
  error?: string;
}

interface RefreshManifest {
  contractVersion: "channel-avatar-refresh/v1";
  ownerId: typeof OWNER_ID;
  version: typeof VERSION;
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

function targetedChannels(rows: Channel[]): Array<{ channel: Channel; identity: ArtIdentity }> {
  const selected = rows.flatMap((channel) => {
    const target = TARGETS[channel.name];
    if (!target) return [];
    return [{
      channel,
      identity: {
        ...target,
        name: channel.name,
        niche: channel.identity?.niche,
      },
    }];
  });
  const missing = Object.keys(TARGETS).filter((name) => !selected.some(({ channel }) => channel.name === name));
  if (missing.length) throw new Error(`target channels are missing: ${missing.join(", ")}`);
  if (selected.length !== Object.keys(TARGETS).length) {
    throw new Error("avatar refresh target set resolved ambiguously");
  }
  return selected;
}

async function generate(): Promise<void> {
  if (!process.argv.includes(`--confirm-max-spend-usd=${MAX_TOTAL_USD.toFixed(2)}`)) {
    throw new Error(`generation requires --confirm-max-spend-usd=${MAX_TOTAL_USD.toFixed(2)}`);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  const selected = targetedChannels(await channels(studioClient()));
  const manifest: RefreshManifest = {
    contractVersion: "channel-avatar-refresh/v1",
    ownerId: OWNER_ID,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    maxAttemptsPerChannel: MAX_ATTEMPTS,
    maximumSpendUsd: MAX_TOTAL_USD,
    rows: [],
  };
  let fleetProviderBlock: string | undefined;

  for (const { channel, identity } of selected) {
    const row: GeneratedRow = {
      channelId: channel._id,
      name: channel.name,
      slug: channel.slug,
      oldKey: channel.identity?.imageKey,
      prompt: avatarPrompt(identity),
    };
    if (fleetProviderBlock) {
      row.error = `not attempted after fleet provider refusal: ${fleetProviderBlock}`;
      manifest.rows.push(row);
      await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      continue;
    }
    try {
      console.log(`\n[avatar] ${channel.name}`);
      const generated = await generateFalNanoBananaAvatarImageWithReceipt({
        prompt: row.prompt,
        idempotencyContext: `${OWNER_ID}/${channel.slug}/art/avatar/${VERSION}/manual-review-candidate-01`,
      });
      row.providerReceipt = generated.receipt;
      const sourcePath = join(OUTPUT_DIR, `${channel.slug}.source.png`);
      await writeFile(sourcePath, generated.bytes);
      row.sourceSha256 = sha256(generated.bytes);
      if (row.sourceSha256 !== generated.receipt.responseSha256) {
        throw new Error("Fal avatar receipt did not bind the returned source bytes");
      }
      row.localPath = join(OUTPUT_DIR, `${channel.slug}.jpg`);
      await imageToJpeg(sourcePath, row.localPath, 1_024, 1_024);
      const jpegBytes = await readFile(row.localPath);
      row.jpegSha256 = sha256(jpegBytes);
      row.newKey = channelKey(
        OWNER_ID,
        channel.slug,
        `art/avatar/${VERSION}/approved-${row.jpegSha256.slice(0, 20)}.jpg`,
      );
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      if (/spend cap breached|billing|project-wide quota/i.test(row.error)) {
        fleetProviderBlock = row.error;
      }
      console.error(`  FAILED: ${row.error}`);
    }
    manifest.rows.push(row);
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const manifestBytes = await readFile(MANIFEST_PATH);
  const manifestSha256 = sha256(manifestBytes);
  console.log(`\nmanifest: ${MANIFEST_PATH}`);
  console.log(`manifest sha256: ${manifestSha256}`);
  if (manifest.rows.some((row) => row.error || !row.providerReceipt || !row.localPath)) {
    throw new Error("one or more avatars failed; review the manifest and rerun failed channels under a new version");
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
    manifest.contractVersion !== "channel-avatar-refresh/v1" ||
    manifest.ownerId !== OWNER_ID ||
    manifest.version !== VERSION ||
    manifest.rows.length !== Object.keys(TARGETS).length ||
    manifest.rows.some((row) =>
      row.error ||
      !row.newKey ||
      !row.localPath ||
      !row.sourceSha256 ||
      !row.jpegSha256 ||
      !row.providerReceipt
    )
  ) {
    throw new Error("manifest is incomplete or does not match the sealed refresh contract");
  }

  if (!process.env.R2_ACCESS_KEY_ID) await hydrateEnv("cloudflare");
  const reader = studioClient();
  const before = await channels(reader);
  for (const row of manifest.rows) {
    if (
      row.providerReceipt!.provider !== NANO_BANANA_AVATAR_PROFILE.provider ||
      row.providerReceipt!.model !== NANO_BANANA_AVATAR_PROFILE.model ||
      row.providerReceipt!.route !== NANO_BANANA_AVATAR_PROFILE.route ||
      row.providerReceipt!.costUsd !== NANO_BANANA_AVATAR_PROFILE.outputImageUsd ||
      row.providerReceipt!.responseSha256 !== row.sourceSha256
    ) {
      throw new Error(`provider receipt drifted before apply: ${row.name}`);
    }
    const bytes = await readFile(row.localPath!);
    if (sha256(bytes) !== row.jpegSha256) {
      throw new Error(`reviewed avatar bytes drifted before apply: ${row.name}`);
    }
    const expectedKey = channelKey(
      OWNER_ID,
      row.slug,
      `art/avatar/${VERSION}/approved-${row.jpegSha256!.slice(0, 20)}.jpg`,
    );
    if (row.newKey !== expectedKey) throw new Error(`avatar key contract drifted for ${row.name}`);
    const existing = await headObjectMetadata(row.newKey!);
    if (existing) {
      if (existing.metadata["content-sha256"] !== row.jpegSha256) {
        throw new Error(`immutable avatar key collision for ${row.name}`);
      }
      continue;
    }
    await putObject(row.newKey!, bytes, {
      contentType: "image/jpeg",
      ifNoneMatch: "*",
      metadata: {
        "content-sha256": row.jpegSha256!,
        "provider-request-sha256": row.providerReceipt!.providerRequestSha256,
        "provider-response-sha256": row.providerReceipt!.responseSha256,
        contract: NANO_BANANA_AVATAR_PROFILE.contractVersion,
      },
    });
  }
  const writer = new StudioConvexHttpClient(CONVEX_URL);
  for (const row of manifest.rows) {
    const channel = before.find((candidate) => candidate._id === row.channelId);
    if (!channel || channel.name !== row.name || channel.slug !== row.slug) {
      throw new Error(`channel identity drifted before apply: ${row.name}`);
    }
    if (channel.locked) throw new Error(`channel became locked before apply: ${row.name}`);
    if (channel.identity.imageKey === row.newKey) {
      console.log(`ALREADY APPLIED ${row.name}: ${row.newKey}`);
      continue;
    }
    if (channel.identity.imageKey !== row.oldKey) {
      throw new Error(`avatar compare-and-swap failed for ${row.name}`);
    }
    const result = await writer.mutation(api.channels.updateChannel, {
      channelId: channel._id,
      identity: { ...channel.identity, imageKey: row.newKey },
    });
    if (result.forked) throw new Error(`avatar apply unexpectedly forked ${row.name}`);
    console.log(`APPLIED ${row.name}: ${row.oldKey} -> ${row.newKey}`);
  }

  const after = await channels(studioClient());
  for (const row of manifest.rows) {
    const channel = after.find((candidate) => candidate._id === row.channelId);
    if (channel?.identity.imageKey !== row.newKey) {
      throw new Error(`post-apply verification failed for ${row.name}`);
    }
  }
  await writeFile(
    join(OUTPUT_DIR, "applied.json"),
    `${JSON.stringify({ manifestSha256: actualSha256, appliedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

async function dryRun(): Promise<void> {
  const selected = targetedChannels(await channels(studioClient()));
  for (const { channel, identity } of selected) {
    console.log(`${channel.name}\n  ${channel.identity?.imageKey ?? "no current avatar"}\n  ${avatarPrompt(identity)}\n`);
  }
  console.log(`${selected.length} channels; maximum ${selected.length * MAX_ATTEMPTS} Nano Banana images / $${MAX_TOTAL_USD.toFixed(2)}`);
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
