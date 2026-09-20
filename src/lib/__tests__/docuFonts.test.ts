import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOCU_FONT_SELECTIONS, localDocuFontInfo } from "../../remotion/docuFonts";
import manifest from "../../../public/fonts/documotion/manifest.json";

async function main(): Promise<void> {
  assert.deepEqual(DOCU_FONT_SELECTIONS.map(({ info, weights, subsets }) => ({
    family: info.fontFamily, weights, subsets,
  })), [
    { family: "Anton", weights: ["400"], subsets: ["vietnamese", "latin-ext", "latin"] },
    { family: "Oswald", weights: ["500", "600", "700"], subsets: ["latin"] },
    { family: "Caveat", weights: ["600", "700"], subsets: ["latin"] },
    { family: "Special Elite", weights: ["400"], subsets: ["latin"] },
  ]);
  const used = new Set<string>();
  let faces = 0;
  for (const { info, weights, subsets } of DOCU_FONT_SELECTIONS) {
    const original = structuredClone(info);
    const local = localDocuFontInfo(info, weights, subsets);
    assert.equal(local.fontFamily, info.fontFamily);
    assert.equal(local.version, info.version);
    assert.deepEqual(local.unicodeRanges, info.unicodeRanges);
    assert.deepEqual(Object.keys(local.fonts), ["normal"]);
    assert.deepEqual(Object.keys(local.fonts.normal), weights);
    for (const weight of weights) {
      assert.deepEqual(Object.keys(local.fonts.normal[weight]), subsets);
      for (const subset of subsets) {
        const source = info.fonts.normal[weight][subset];
        const asset = manifest.assets.find((entry) => entry.source === source);
        assert.ok(asset);
        assert.ok(local.fonts.normal[weight][subset].endsWith(`/fonts/documotion/${asset.file}`));
        assert.ok(!local.fonts.normal[weight][subset].includes("fonts.gstatic.com"));
        used.add(asset.file);
        faces++;
      }
    }
    assert.deepEqual(info, original, "metadata shared with other compositions is not mutated");
    const changed = structuredClone(info);
    changed.fonts.normal[weights[0]][subsets[0]] = "https://fonts.gstatic.com/new-version.woff2";
    assert.throws(() => localDocuFontInfo(changed, weights, subsets), /Unvendored DocuMotion font/);
  }
  assert.equal(faces, 9);
  assert.equal(used.size, 6);
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(process.cwd(), "public/fonts/documotion", asset.file));
    assert.equal(bytes.length, asset.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    if (asset.file.endsWith(".woff2")) {
      assert.ok(used.has(asset.file));
      assert.equal(bytes.subarray(0, 4).toString(), "wOF2");
    } else {
      assert.match(bytes.toString(), /SIL OPEN FONT LICENSE|Apache License/);
    }
  }
  assert.equal(manifest.assets.length, 10);
  console.log("DocuMotion font parity: 9 faces, 6 pinned WOFF2 files, 4 licenses; upgrade drift fails closed.");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
