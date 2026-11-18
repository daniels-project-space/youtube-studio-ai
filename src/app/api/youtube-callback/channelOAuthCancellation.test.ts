import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/youtube-callback/route.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/channels/[slug]/page.tsx"), "utf8");

assert.match(route, /oauthErr === "access_denied" \? "cancelled" : "error"/);
assert.match(route, /channels\?yt=\$\{outcome\}/);
assert.match(page, /ytStatus === "cancelled"/);
assert.match(page, /YouTube connection cancelled/);
assert.match(route, /tasks\.trigger\("stats-refresh", \{ ownerId \}\)/,
  "a completed channel link must queue the first bounded analytics refresh instead of waiting for six-hour cadence");
assert.doesNotMatch(route, /tasks\.trigger\("wire-youtube-branding"/,
  "connecting a channel must not silently overwrite its branding");
assert.match(route, /if \(channelPaused && process\.env\.TRIGGER_SECRET_KEY\)/,
  "the read-only refresh requires the channel pause to be confirmed");

console.log("YouTube channel OAuth cancellation contracts passed");
