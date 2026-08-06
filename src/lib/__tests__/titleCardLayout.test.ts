import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fitTitleCardFontSize, probe, solidImage, titleCard } from "../ffmpeg";

const LONG_LIVE_TITLE = "Gratitude for the People Beside You";

async function main(): Promise<void> {
  assert.equal(fitTitleCardFontSize("Peace"), 72);

  const fitted = fitTitleCardFontSize(LONG_LIVE_TITLE);
  assert.ok(fitted < 72, "the live overflow fixture must shrink");
  assert.ok(
    Array.from(LONG_LIVE_TITLE).length * fitted * 0.72 <= 1_104,
    "the conservative projected headline width must remain inside the safe area",
  );

  const directory = await mkdtemp(join(tmpdir(), "title-card-layout-"));
  try {
    const base = await solidImage(join(directory, "base.jpg"), 1280, 720, "#223044");
    const output = join(directory, "card.jpg");
    await titleCard({
      basePath: base,
      outJpg: output,
      title: LONG_LIVE_TITLE,
      subtitle: "Gratitude Springs",
    });
    const media = await probe(output);
    assert.equal(media.width, 1280);
    assert.equal(media.height, 720);
    assert.equal(media.hasVideo, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log("TITLE CARD LAYOUT PASS");
}

void main();
