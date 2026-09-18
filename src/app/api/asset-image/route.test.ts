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
assert.match(videoRoute, /maxAttempts = 5/,
  "video previews retry transient edge misses with a bounded five-attempt window");
assert.match(videoRoute, /Math\.min\(2_000, 1_100 \+ 300 \* attempt\)/,
  "video preview retries cross a signing-second boundary before retrying R2");
assert.match(videoRoute, /upstream\.status === 404 \|\| upstream\.status >= 500/);
assert.match(videoRoute, /attempt >= 2 && upstream\?\.status === 404 && range/,
  "a false non-zero-range miss gets two exact-range retries before full-source playback");
assert.match(videoRoute, /attemptHeaders\.delete\("Range"\)/);
assert.match(videoRoute, /new NextResponse\(upstream\.body/);
assert.match(videoRoute, /Cross-Origin-Resource-Policy.*same-origin/);
assert.match(videoRoute, /owner\/\$\{OWNER_ID\}/);
assert.match(videoRoute, /status: upstream\.status/);
assert.match(videoRoute, /probe[\s\S]*available: false/);
assert.match(videoRoute, /PREVIEW_PROBE_RANGES/,
  "one video preview probe must prove both initial and later native-player ranges");
assert.match(videoRoute, /Promise\.all\(PREVIEW_PROBE_RANGES\.map/,
  "the retained-preview proof must run its byte checks concurrently behind one browser request");
assert.match(videoRoute, /temporary private-preview proof could not reach storage/,
  "a failed bounded preview proof must return an observable, safe unavailable reason");
assert.match(videoRoute, /PREVIEW_PROBE_MAX_ATTEMPTS = 5/,
  "a transient R2 edge miss remains boundedly retried server-side");
assert.match(videoRoute, /probe && !request\.headers\.get\("range"\)/,
  "one no-range browser probe must invoke the aggregate retained-preview proof");
assert.match(videoRoute, /upstream\.status >= 400 && upstream\.status < 500/,
  "private video previews must quiet both R2 404 and 403 legacy-object misses");
assert.doesNotMatch(videoRoute, /probe && !range\) forwardedHeaders\.set/,
  "the browser must not trigger a second server probe after aggregate range admission");

console.log("same-origin private image/video proxy contracts passed");
