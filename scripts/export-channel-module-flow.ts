/**
 * Read-only export of each channel's exact executable catalog route, including
 * per-step reference/equivalence qualification without implying Golden status.
 *
 * Live:
 *   npm run export:channel-flow -- --format markdown --out /tmp/channel-flow.md
 *
 * Sanitized validation snapshot (no credentials/network):
 *   npm run export:channel-flow -- --snapshot /tmp/channels.json --format json
 *
 * Optional selector matches channel id, slug, or name:
 *   --channel investory-1781107671769
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { api } from "@/../convex/_generated/api";
import { buildChannelFlowExport, renderChannelFlowMarkdown, type ChannelFlowSource } from "@/engine/channelFlowExport";
import type { PipelineEntry } from "@/engine/types";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

interface CliOptions {
  channel?: string;
  format: "json" | "markdown";
  out?: string;
  snapshot?: string;
}

function usage(): string {
  return [
    "Usage: npm run export:channel-flow -- [options]",
    "  --channel <id|slug|name>  export one channel (default: all)",
    "  --format <json|markdown>  output format (default: markdown)",
    "  --out <path>              write to a file instead of stdout",
    "  --snapshot <path>         use a sanitized channel snapshot instead of Convex",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { format: "markdown" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    const value = argv[index + 1];
    if (arg === "--channel" && value) options.channel = argv[++index];
    else if (arg === "--out" && value) options.out = argv[++index];
    else if (arg === "--snapshot" && value) options.snapshot = argv[++index];
    else if (arg === "--format" && (value === "json" || value === "markdown")) {
      options.format = value;
      index++;
    } else {
      throw new Error(`unknown or incomplete option: ${arg}\n${usage()}`);
    }
  }
  return options;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("channel snapshot contains a non-object row");
  }
  return value as Record<string, unknown>;
}

function normalizeChannel(value: unknown): ChannelFlowSource {
  const row = asRecord(value);
  const blockOnly = Array.isArray(row.pipelineBlocks)
    ? row.pipelineBlocks.map((block) => ({ block: String(block) }))
    : undefined;
  const pipeline = (Array.isArray(row.pipeline) ? row.pipeline : blockOnly) as PipelineEntry[] | undefined;
  if (!pipeline?.length) throw new Error(`channel ${String(row.name ?? row.slug ?? row._id)} has no pipeline`);
  return {
    id: String(row.id ?? row._id ?? ""),
    name: String(row.name ?? row.slug ?? row._id ?? "unnamed"),
    slug: String(row.slug ?? row._id ?? row.id ?? "unnamed"),
    ...(typeof row.status === "string" ? { status: row.status } : {}),
    ...(typeof row.family === "string" || row.family === null ? { family: row.family } : {}),
    pipeline: pipeline.map((entry) => ({
      block: String(entry.block),
      ...(entry.params && typeof entry.params === "object" ? { params: { ...entry.params } } : {}),
    })),
  };
}

async function channelsFromSnapshot(path: string): Promise<ChannelFlowSource[]> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed).channels)
      ? asRecord(parsed).channels as unknown[]
      : [];
  if (!rows.length) throw new Error("snapshot has no channels array");
  return rows.map(normalizeChannel);
}

async function channelsFromConvex(): Promise<ChannelFlowSource[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const ownerId = process.env.STUDIO_OWNER_ID ?? process.env.NEXT_PUBLIC_OWNER_ID;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required");
  if (!ownerId) throw new Error("STUDIO_OWNER_ID or NEXT_PUBLIC_OWNER_ID is required");
  const convex = new StudioConvexHttpClient(url);
  const rows = await convex.query(api.channels.listChannels, { ownerId });
  return (rows as unknown[]).map(normalizeChannel);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const channels = options.snapshot
    ? await channelsFromSnapshot(options.snapshot)
    : await channelsFromConvex();
  const selected = options.channel
    ? channels.filter((channel) =>
        [channel.id, channel.slug, channel.name].some((value) => value === options.channel),
      )
    : channels;
  if (!selected.length) throw new Error(`channel not found: ${options.channel}`);

  const exports = selected.map(buildChannelFlowExport);
  const output = options.format === "json"
    ? `${JSON.stringify(exports, null, 2)}\n`
    : `${renderChannelFlowMarkdown(exports)}\n`;
  if (options.out) {
    const path = resolve(options.out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output, "utf8");
    console.log(`wrote ${exports.length} channel flow(s) to ${path}`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  console.error(`CHANNEL FLOW EXPORT FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
