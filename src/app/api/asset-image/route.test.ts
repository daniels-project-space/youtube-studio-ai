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
  "video asset URLs keep their ownership-checked signing facade");

const videoRoute = readFileSync(`${here}/../asset-video/route.ts`, "utf8");
assert.match(videoRoute, /presignDownload/);
assert.match(videoRoute, /Range/);
assert.match(videoRoute, /maxAttempts = 5/,
  "video previews retry transient edge misses with a bounded five-attempt window");
assert.match(videoRoute, /Math\.min\(2_000, 1_100 \+ 300 \* attempt\)/,
  "video preview retries cross a signing-second boundary before retrying R2");
assert.match(videoRoute, /upstream\.status === 404 \|\| upstream\.status >= 500/);
assert.match(videoRoute, /if \(!probe\)[\s\S]*status: 307[\s\S]*Location: location/,
  "native playback gets a private R2 redirect before any server media fetch");
assert.match(videoRoute, /Cache-Control.*private, no-store/,
  "redirects must not cache an expiring private signature");
assert.doesNotMatch(videoRoute, /attemptHeaders\.delete\("Range"\)/,
  "a probe must never remove its range and fetch a whole master");
assert.doesNotMatch(videoRoute, /new NextResponse\(upstream\.body/,
  "private video bodies must never be relayed through Vercel");
assert.match(videoRoute, /owner\/\$\{OWNER_ID\}/);
assert.match(videoRoute, /unsupported preview probe range/,
  "arbitrary large probe ranges are rejected before storage reads");
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
assert.match(videoRoute, /!upstream\.ok[\s\S]*available: false/,
  "unavailable private objects remain observable through the JSON probe");
for (const component of ["SignedVideoPlayer", "MediaPreview"]) {
  const player = readFileSync(`${here}/../../../components/${component}.tsx`, "utf8");
  assert.match(player, /crossOrigin="anonymous"/,
    "native private R2 players must use qualified anonymous CORS");
}
assert.doesNotMatch(videoRoute, /probe && !range\) forwardedHeaders\.set/,
  "the browser must not trigger a second server probe after aggregate range admission");

console.log("private image proxy and direct video signing contracts passed");
