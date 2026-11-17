/** Restore captured channel rooms without changing channel membership. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { api } from "../convex/_generated/api";
import { StudioConvexHttpClient } from "../src/lib/studioConvexHttpClient";
import { issueStudioConvexToken } from "../src/lib/studioConvexAuth";

async function main() {
  const [flag, path, hash] = process.argv.slice(2);
  if (flag !== "--import" || !path || !/^[a-f0-9]{64}$/.test(hash ?? "") || process.argv.length !== 5) throw new Error("Expected --import <baseline> <sha256>");
  const endpoint = new URL(process.env.CONVEX_URL ?? "");
  if (!["http:", "https:"].includes(endpoint.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || !process.env.STUDIO_CONVEX_ISSUER || !process.env.STUDIO_CONVEX_AUDIENCE || !process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY) {
    throw new Error("Explicit local backend and signing identity are required");
  }
  const resolved = await realpath(path), info = await lstat(path);
  if (resolved !== path || !resolved.startsWith("/var/lib/youtube-automation/baselines/") || !info.isFile() || info.isSymbolicLink() ||
      info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error("Baseline file is not private");
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Baseline hash mismatch");
  const baseline = JSON.parse(bytes.toString("utf8"));
  if (baseline.version !== "youtube-automation-channel-baseline/v1" || typeof baseline.ownerId !== "string" ||
      !Array.isArray(baseline.channels) || !Array.isArray(baseline.folderMetadata) || baseline.folderMetadata.length > 100) throw new Error("Invalid room baseline");
  const names: string[] = [];
  for (const folder of baseline.folderMetadata) {
    if (!folder || folder.ownerId !== baseline.ownerId || typeof folder.name !== "string" || folder.name !== folder.name.trim() ||
        !folder.name || folder.name.length > 40 || names.some(name => name.localeCompare(folder.name, undefined, { sensitivity: "accent" }) === 0)) throw new Error("Invalid or duplicate room");
    names.push(folder.name);
  }
  const auth = issueStudioConvexToken({ role: "service", ownerId: baseline.ownerId }).token;
  const client = new StudioConvexHttpClient(endpoint.origin, { auth });
  const [channels, folders] = await Promise.all([
    client.query(api.channels.listChannels, { ownerId: baseline.ownerId }),
    client.query(api.folders.list, { ownerId: baseline.ownerId }),
  ]);
  if (channels.length !== baseline.channels.length || folders.some(folder => !names.includes(folder.name))) throw new Error("Local inventory differs from the captured baseline");
  for (const source of baseline.channels) {
    const local = channels.find(channel => channel.slug === source.slug);
    if (!local || local.ownerId !== baseline.ownerId || local.folder !== source.folder || local.status !== "paused" ||
        (local.schedule && local.schedule.enabled !== false) || (source.folder && !names.includes(source.folder))) {
      throw new Error("Channel room membership or paused state differs from the captured baseline");
    }
  }
  for (const name of names) {
    if (!folders.some(folder => folder.name === name)) await client.mutation(api.folders.create, { ownerId: baseline.ownerId, name });
  }
  const after = await client.query(api.folders.list, { ownerId: baseline.ownerId });
  if (after.length !== names.length || names.some(name => !after.some(folder => folder.name === name))) throw new Error("Imported rooms failed readback");
  console.log(JSON.stringify({ verifiedRooms: after.length, channels: channels.length, sourceFileSha256: hash }));
}

void main().catch(error => { console.error(`Channel room import failed (${error instanceof Error ? error.name : "unknown"}).`); process.exitCode = 1; });
