import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveAssetUrl, invalidateAssetUrl } from "../asset-url";
import { OWNER_ID } from "../config";
import type { GET } from "../../app/api/asset-url/route";

async function main() {
  let requests = 0;
  let signatures = 0;
  const loaded = { exports: {} as { GET: typeof GET } };
  const compiled = ts.transpileModule(readFileSync("src/app/api/asset-url/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/config") return { OWNER_ID };
    if (name === "@/lib/storage") return { presignDownload: async (key: string) => {
      signatures++; return `https://storage.invalid/${encodeURIComponent(key)}?signature=${signatures}`;
    } };
    throw new Error(`Unexpected import: ${name}`);
  }, loaded, loaded.exports);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    requests++;
    return loaded.exports.GET(new Request(new URL(String(input), "https://studio.invalid")));
  };
  try {
    const formats = ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "MP4", "PNG"];
    for (const extension of formats) {
      const key = `owner/${OWNER_ID}/channel/space & + # ? %/frame.${extension}`;
      const expected = await (await loaded.exports.GET(new Request(
        `https://studio.invalid/api/asset-url?key=${encodeURIComponent(key)}`,
      ))).json() as { url: string };
      assert.equal(await resolveAssetUrl(key), expected.url, "must match the actual server's existing media URL");
      assert.equal(new URL(expected.url, "https://studio.invalid").searchParams.get("key"), key);
      invalidateAssetUrl(key);
      assert.equal(await resolveAssetUrl(key), expected.url, "no signature to expire or rotate for a proxy URL");
    }
    const cards = Array.from({ length: 100 }, (_, i) => `owner/${OWNER_ID}/channel/asset-${i}.webp`);
    await Promise.all(cards.map(resolveAssetUrl));
    assert.equal(requests, 0, "all selected image/video URLs resolve without invoking Vercel");
    assert.equal(signatures, 0);

    for (const key of [`owner/${OWNER_ID}/music.wav`, `owner/${OWNER_ID}/music.mp3`,
      `owner/${OWNER_ID}/captions.srt`, "voicebank/auditions/fixture_voice.mp3"]) {
      const before: number = requests;
      assert.match(await resolveAssetUrl(key), /^https:\/\/storage\.invalid\//);
      assert.equal(requests, before + 1, "audio, captions and shared auditions still require the server");
      await resolveAssetUrl(key);
      assert.equal(requests, before + 1, "signed cache remains shared");
    }
    for (const key of ["owner/foreign-owner/frame.png", `owner/${OWNER_ID}/../frame.mp4`,
      "https://foreign.invalid/frame.png"]) {
      const before: number = requests;
      await assert.rejects(resolveAssetUrl(key), /Asset URL request failed/);
      assert.equal(requests, before + 1, "out-of-scope keys must retain server admission");
    }
    for (const key of [`owner/${OWNER_ID}/back\\slash.png`, `owner/${OWNER_ID}/${"a".repeat(1024)}.png`]) {
      const before: number = requests;
      await resolveAssetUrl(key);
      assert.equal(requests, before + 1, "do not locally admit keys the media endpoints reject");
    }
    assert.equal(signatures, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("Asset proxy resolution: exact server parity, zero URL requests for 100 cards, unchanged signed audio and owner boundaries");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
