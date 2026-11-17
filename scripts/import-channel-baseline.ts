/** Import one verified baseline only into a local Automation backend. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { makeFunctionReference } from "convex/server";
import { api } from "../convex/_generated/api";
import { StudioConvexHttpClient } from "../src/lib/studioConvexHttpClient";
import { issueStudioConvexToken } from "../src/lib/studioConvexAuth";
import { canonicalJson } from "../src/lib/canonicalJson";

async function main() {
  const [flag, path, expectedHash] = process.argv.slice(2);
  if (flag !== "--import" || !path || !/^[a-f0-9]{64}$/.test(expectedHash ?? "") || process.argv.length !== 5) {
    throw new Error("Usage: import-channel-baseline --import <baseline path> <sha256>");
  }
  const endpoint = new URL(process.env.CONVEX_URL ?? "");
  if (!["http:", "https:"].includes(endpoint.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || !process.env.STUDIO_CONVEX_ISSUER || !process.env.STUDIO_CONVEX_AUDIENCE ||
      !process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY) throw new Error("Explicit local backend and signing identity are required");
  const resolved = await realpath(path);
  const info = await lstat(path);
  if (!resolved.startsWith("/var/lib/youtube-automation/baselines/") || resolved !== path || !info.isFile() ||
      info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error("Baseline file is not private or is outside the baseline directory");
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("Baseline file hash mismatch");
  const baseline = JSON.parse(bytes.toString("utf8"));
  if (baseline.version !== "youtube-automation-channel-baseline/v1" || typeof baseline.ownerId !== "string" || !Array.isArray(baseline.channels)) throw new Error("Invalid baseline format");
  const auth = issueStudioConvexToken({ role: "service", ownerId: baseline.ownerId }).token;
  const client = new StudioConvexHttpClient(endpoint.origin, { auth });
  const ref = makeFunctionReference<"mutation">("channelImport:importBaseline");
  const result = await client.mutation(ref, { ownerId: baseline.ownerId, sourceFileSha256: expectedHash, channels: baseline.channels });
  const rows = await client.query(api.channels.listChannels, { ownerId: baseline.ownerId });
  const mapping = new Map<string, string>(result.mappings.map((item: { sourceId: string; channelId: string }) => [item.sourceId, item.channelId]));
  if (rows.length !== baseline.channels.length || mapping.size !== rows.length) throw new Error("Imported channel count differs from the baseline");
  for (const source of baseline.channels) {
    const row = rows.find(item => item._id === mapping.get(source._id));
    if (!row) throw new Error("An imported channel is missing");
    const expected = { ...source, status: "paused", ...(source.schedule === undefined ? {} : { schedule: { ...source.schedule, enabled: false } }),
      ...(source.groupId === undefined ? {} : { groupId: mapping.get(source.groupId) }) };
    delete expected._id; delete expected._creationTime;
    const actual: Record<string, unknown> = { ...row };
    delete actual._id; delete actual._creationTime;
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Imported channel settings differ from the paused baseline");
  }
  console.log(JSON.stringify({ imported: result.imported, reused: result.reused, verifiedChannels: rows.length, sourceFileSha256: expectedHash }));
}

void main().catch(error => { console.error(`Channel import failed (${error instanceof Error ? error.name : "unknown"}).`); process.exitCode = 1; });
