import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./channelHub.module.css", import.meta.url), "utf8");

  assert.match(page, /preparationManifestSha256\?: string/);
  assert.match(page, /function planPreparationLabel/);
  assert.match(page, /Inputs frozen/);
  assert.match(page, /className=\{styles\.weekPrepState\}/);
  assert.match(page, /className=\{styles\.weekPrepDigest\}/);
  assert.match(page, /dateTime=\{new Date\(p\.preparationFrozenAt\)\.toISOString\(\)\}/);
  assert.match(styles, /\.weekPrepState\[data-frozen="true"\]/);
  assert.match(styles, /\.weekPrepDigest/);

  console.log("Week-ahead preparation UI contracts passed");
}

void main();
