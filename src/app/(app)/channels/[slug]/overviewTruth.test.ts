import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const channels = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
assert.match(page, /channelCard\.recentPublishedCount\} uploads/);
assert.match(page, /label="Recent uploads"/);
assert.match(page, /recent run spend divided by uploads/);
assert.match(page, /channel\.schedule\?\.enabled === false \? "Scheduler disabled"/);
assert.doesNotMatch(page, /label="Recent published"|Nano Banana ·|gradual duck, fades out/);
assert.match(page, /thumbnailTemplate \?\? "Not configured"/);
assert.match(page, /YouTube-linked outputs, including private/);
assert.doesNotMatch(channels, /<small>Published<\/small>|<CardStat label="Published"/);
console.log("Channel overview truthfulness contracts passed");
