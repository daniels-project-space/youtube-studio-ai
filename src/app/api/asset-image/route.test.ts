import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(`${here}/route.ts`, "utf8");
const assetUrl = readFileSync(`${here}/../asset-url/route.ts`, "utf8");

assert.match(source, /MAX_INLINE_IMAGE_BYTES/);
assert.match(source, /getObjectBytes/);
assert.match(source, /attempt < 2/,
  "private image reads retry one transient R2 edge miss server-side");
assert.match(source, /setTimeout\(resolve, 120\)/);
assert.match(source, /isR2CredentialFailure/);
assert.match(source, /sniffContentType/);
assert.match(source, /status: 503/);
assert.match(source, /probe[\s\S]*available: false/);
assert.match(source, /Retry-After/);
assert.match(source, /Cross-Origin-Resource-Policy.*same-origin/);
assert.match(source, /owner\/\$\{OWNER_ID\}/);
assert.match(assetUrl, /api\/asset-image\?key=/,
  "image asset URLs must use the same-origin proxy to avoid R2 ORB failures");
assert.match(assetUrl, /api\/asset-video\?key=/,
  "video asset URLs must use the same-origin streaming proxy to avoid R2 ORB failures");

const videoRoute = readFileSync(`${here}/../asset-video/route.ts`, "utf8");
assert.match(videoRoute, /presignDownload/);
assert.match(videoRoute, /Range/);
assert.match(videoRoute, /attempt < 2/,
  "video previews retry one transient edge miss with a fresh signature");
assert.match(videoRoute, /upstream\.status === 404 \|\| upstream\.status >= 500/);
assert.match(videoRoute, /attempt === 1 && upstream\?\.status === 404 && range/,
  "a false non-zero-range miss falls back to streamed full-source playback");
assert.match(videoRoute, /attemptHeaders\.delete\("Range"\)/);
assert.match(videoRoute, /new NextResponse\(upstream\.body/);
assert.match(videoRoute, /Cross-Origin-Resource-Policy.*same-origin/);
assert.match(videoRoute, /owner\/\$\{OWNER_ID\}/);
assert.match(videoRoute, /status: upstream\.status/);
assert.match(videoRoute, /probe[\s\S]*available: false/);

console.log("same-origin private image/video proxy contracts passed");
