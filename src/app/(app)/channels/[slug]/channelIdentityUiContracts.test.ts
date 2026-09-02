import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./channelHub.module.css", import.meta.url), "utf8");

  assert.match(page, /<div className=\{styles\.identitySnapshot\}>/);
  assert.match(page, /artworkIdentity=\{channelArtIdentityFromSource\(/);
  assert.match(page, /<Field label="Vibe" value=\{artworkIdentity\.vibe \?\? bible\.vibe\}/);
  assert.match(page, /<Field label="Signature" value=\{artworkIdentity\.iconicMotif \?\? bible\.iconicMotif\}/);
  assert.match(page, /<details className=\{styles\.identityDetails\}>/);
  assert.match(page, /<span>Show rules<\/span>/);
  assert.match(page, /Positioning, style, topic pool, and guardrails/);
  assert.match(page, /<div className=\{styles\.identityDetailBlock\}>/);
  assert.match(page, /<ChipRow items=\{id\.topicPool\} tone="secondary" \/>/);
  assert.doesNotMatch(page, /<div className=\{styles\.sectionRail\}><span>Topic pool<\/span>/);

  assert.match(styles, /\.identityDetails summary \{[^}]*cursor: pointer/);
  assert.match(styles, /\.identityDetails\[open\] summary::after \{ content: "−"/);
  assert.match(styles, /\.identitySnapshot \{ display: grid; grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.identitySnapshot \{ grid-template-columns: 1fr; \}/);

  console.log("Channel identity compact UI contracts passed");
}

void main();
