import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/youtube-callback/route.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/channels/[slug]/page.tsx"), "utf8");

assert.match(route, /oauthErr === "access_denied" \? "cancelled" : "error"/);
assert.match(route, /channels\?yt=\$\{outcome\}/);
assert.match(page, /ytStatus === "cancelled"/);
assert.match(page, /YouTube connection cancelled/);

console.log("YouTube channel OAuth cancellation contracts passed");
