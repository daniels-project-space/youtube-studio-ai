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
assert.match(route, /tasks\.trigger\("wire-youtube-branding", \{ channelId \}\)/,
  "connection follow-up retains automatic native YouTube branding");
assert.match(route, /Promise\.all\(\[/,
  "branding and initial analytics refresh should share one best-effort follow-up boundary");

console.log("YouTube channel OAuth cancellation contracts passed");
