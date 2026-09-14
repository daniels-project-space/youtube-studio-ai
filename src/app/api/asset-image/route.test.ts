import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(`${here}/route.ts`, "utf8");
const assetUrl = readFileSync(`${here}/../asset-url/route.ts`, "utf8");

assert.match(source, /MAX_INLINE_IMAGE_BYTES/);
assert.match(source, /getObjectBytes/);
assert.match(source, /Cross-Origin-Resource-Policy.*same-origin/);
assert.match(source, /owner\/\$\{OWNER_ID\}/);
assert.match(assetUrl, /api\/asset-image\?key=/,
  "image asset URLs must use the same-origin proxy to avoid R2 ORB failures");

console.log("same-origin private image proxy contracts passed");
