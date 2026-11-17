/** Capture an owner-scoped, read-only baseline. Run only with vault-injected Trigger credentials. */
import { createHash } from "node:crypto";
import { mkdir, lstat, open, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { envvars } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

const ROOT = "/var/lib/youtube-automation";
const DIRECTORY = `${ROOT}/baselines`;
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 });
}

async function ensurePrivateDirectory(path: string) {
  try { await privateDirectory(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new Error("baseline directory must be owned by this user, private and not a symlink");
  }
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--capture") throw new Error("pass --capture to create an owner-scoped baseline");
  const ref = process.env.TRIGGER_PROJECT_REF;
  const expectedUrl = process.env.EXPECTED_STUDIO_CONVEX_URL;
  if (!ref || !process.env.TRIGGER_SECRET_KEY || !expectedUrl) throw new Error("vault-injected production Trigger credentials and source URL are required");
  const [key, url] = await Promise.all([
    envvars.retrieve(ref, "prod", "STUDIO_CONVEX_JWT_PRIVATE_KEY"),
    envvars.retrieve(ref, "prod", "NEXT_PUBLIC_CONVEX_URL"),
  ]);
  if (!key.value || !url.value || new URL(url.value).origin !== new URL(expectedUrl).origin) throw new Error("source service identity or deployment URL does not match the vault");
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = key.value;
  delete process.env.STUDIO_CONVEX_ISSUER;
  delete process.env.STUDIO_CONVEX_AUDIENCE;
  const ownerId = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const client = new StudioConvexHttpClient(url.value);
  const [channels, connectors] = await Promise.all([
    client.query(api.channels.listChannels, { ownerId }),
    client.query(api.youtubeAuth.linkStatus, { ownerId }),
  ]);
  if (!Array.isArray(channels) || !channels.length || channels.some((channel) => channel.ownerId !== ownerId || !Array.isArray(channel.pipeline))) {
    throw new Error("source channel inventory was empty or failed ownership/shape validation");
  }
  await ensurePrivateDirectory(ROOT);
  await ensurePrivateDirectory(DIRECTORY);
  const capturedAt = new Date().toISOString();
  const payload = Buffer.from(JSON.stringify({ version: "youtube-automation-channel-baseline/v1", capturedAt, ownerId, sourceDeployment: new URL(url.value).origin, channels, connectorMetadata: connectors }, null, 2) + "\n");
  const path = join(DIRECTORY, `channels-${capturedAt.replace(/[:.]/g, "-")}.json`);
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(payload); await handle.sync(); }
  finally { await handle.close(); }
  const stored = await readFile(path);
  if (digest(stored) !== digest(payload)) throw new Error("baseline readback hash mismatch");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("baseline file permissions are unsafe");
  console.log(JSON.stringify({ path, channelCount: channels.length, connectorMetadataCount: connectors.length, sha256: digest(stored), bytes: stored.length }));
}

void main().catch((error) => {
  // Do not log SDK errors: provider responses can contain sensitive data.
  console.error(`Baseline capture failed (${error instanceof Error ? error.name : "unknown error"}).`);
  process.exitCode = 1;
});
