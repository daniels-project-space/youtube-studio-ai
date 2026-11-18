import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const callback = readFileSync("src/app/api/youtube-callback/route.ts", "utf8");
const revoke = readFileSync("src/app/api/youtube-revoke/route.ts", "utf8");
const channel = readFileSync("src/app/(app)/channels/[slug]/page.tsx", "utf8");
const settings = readFileSync("src/app/(app)/settings/page.tsx", "utf8");
assert.match(callback, /await pauseAfterConnectorChange\(convex,/);
assert.match(callback, /if \(channelPaused && process\.env\.TRIGGER_SECRET_KEY\)/, "connector follow-ups require confirmed pause");
assert.doesNotMatch(callback, /tasks\.trigger\("wire-youtube-branding"/, "OAuth consent must not silently overwrite YouTube branding");
assert.match(callback, /channelPaused \? "connected" : "connected_unpaused"/);
assert.match(channel, /ytStatus === "connected_unpaused"/);
assert.match(revoke, /channelPauseWarning/);
assert.match(channel, /d\.channelPauseWarning/);
assert.match(settings, /result\.channelPauseWarning/);
console.log("Connector pause warnings reach both user surfaces and gate follow-up tasks");
