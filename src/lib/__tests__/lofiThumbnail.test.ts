import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOFI_RENDER_THUMBNAIL_CONTRACT,
  lofiNanoBananaEditPrompt,
  measureLofiThumbnailBackgroundSsim,
} from "@/lib/lofiThumbnail";
import { solidImage } from "@/lib/ffmpeg";

async function main(): Promise<void> {
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.badge, "4K");
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.route, "nano-banana-lofi-video-reference");
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.minimumWidth, 3_840);
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.minimumHeight, 2_160);
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim, 0.995);
  assert.equal(LOFI_RENDER_THUMBNAIL_CONTRACT.minimumTypographyMatteUniformity, 0.98);
  const prompt = lofiNanoBananaEditPrompt({
    visualLanguage: { treatment: "neon", font: "rounded" },
  });
  assert.match(prompt, /exact 15-second video frame/i);
  assert.match(prompt, /"4K"/);
  assert.match(prompt, /read-only channel thumbnail visual language/i);
  assert.match(prompt, /Every output pixel outside the 4K emblem.*must remain exact solid #00ff00/i);
  assert.match(prompt, /Never place the 4K mark on a filled rectangle, pill, card, banner/i);
  assert.match(prompt, /Nano Banana itself must render the emblem/i);
  assert.match(prompt, /bottom-right corner/i);
  assert.match(prompt, /custom quality emblem/i);
  assert.match(prompt, /Do not add a headline, mood label, title, subtitle, or any other writing/i);
  assert.match(prompt, /pure black/i);
  assert.match(prompt, /tight pure white/i);
  assert.match(prompt, /Never use cream, beige, gold, gray/i);

  const root = await mkdtemp(join(tmpdir(), "lofi-thumbnail-preservation-"));
  try {
    const reference = await solidImage(join(root, "reference.jpg"), 1_280, 720, "#91c8ef");
    const altered = await solidImage(join(root, "altered.jpg"), 1_280, 720, "#18264f");
    assert.equal(
      await measureLofiThumbnailBackgroundSsim({
        referenceFramePath: reference,
        candidatePath: reference,
      }),
      1,
    );
    assert.ok(
      await measureLofiThumbnailBackgroundSsim({
        referenceFramePath: reference,
        candidatePath: altered,
      }) < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim,
      "a day-to-night rewrite must fail the deterministic preservation gate",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("LOFI THUMBNAIL CONTRACT PASS");
}

void main();
