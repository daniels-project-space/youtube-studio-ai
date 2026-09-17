import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./channelHub.module.css", import.meta.url), "utf8");

  // A channel workspace must open the retained private master through the
  // R2-backed carousel, never send an operator out to a public YouTube watch
  // page from its primary overview.
  assert.match(page, /<RecentVideos ownerId=\{channel\.ownerId\} channelId=\{channel\._id as Id<"channels">\} limit=\{8\} \/>/);
  assert.doesNotMatch(page, /LatestVideoWidget/);
  assert.doesNotMatch(page, /<RunCard key=\{r\._id\}/,
    "the same run rows must not repeat beneath the private render carousel");

  // Doctrine is available without consuming the overview until it is needed.
  assert.match(page, /<details className=\{styles\.channelBrief\}>/);
  assert.match(page, /<span>Voice &amp; production rules<\/span>/);
  assert.match(page, /<small>\{settings\.length\} active controls<\/small>/);
  assert.match(styles, /\.channelBrief > summary \{[\s\S]*?min-height: 44px/);
  assert.match(styles, /\.channelBrief\[open\] > summary::before \{ content: "−"/);

  console.log("Channel overview compact UI contracts passed");
}

void main();
