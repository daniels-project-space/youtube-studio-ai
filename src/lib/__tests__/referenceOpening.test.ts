import assert from "node:assert/strict";

import {
  parseOpeningStoryboardMhtml,
  transcriptFromJson3,
  withReferenceOpeningEvidence,
} from "@/lib/referenceOpening";

function jpeg(seed: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(1_100, seed),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function mhtml(sheetCount: number, durationSec: number): Buffer {
  const boundary = "studio-proof-boundary";
  const parts: Buffer[] = [Buffer.from(
    `MIME-Version: 1.0\r\nContent-type: multipart/related; boundary="${boundary}"\r\n\r\n`,
    "latin1",
  )];
  for (let index = 0; index < sheetCount; index++) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Type: image/jpeg\r\nX.yt-dlp.Duration: ${durationSec}\r\n\r\n`,
      "latin1",
    ));
    parts.push(jpeg(index + 1));
    parts.push(Buffer.from("\r\n", "latin1"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "latin1"));
  return Buffer.concat(parts);
}

const sheets = parseOpeningStoryboardMhtml(mhtml(6, 17.75), 75);
assert.equal(sheets.length, 5, "the parser retains only sheets needed to cover the bounded opening");
assert.equal(sheets[0]?.jpeg[0], 0xff);
assert.equal(sheets[0]?.jpeg[1], 0xd8);
assert.throws(() => parseOpeningStoryboardMhtml(mhtml(3, 17.75), 75), /covers only 53\.3s/);
assert.throws(() => parseOpeningStoryboardMhtml(Buffer.from("not mhtml"), 75), /valid bounded MHTML/);

const transcript = transcriptFromJson3({
  events: [
    { tStartMs: 0, segs: [{ utf8: "[Music]" }] },
    { tStartMs: 1_000, segs: [{ utf8: "The first spoken claim." }] },
    { tStartMs: 10_000, segs: [{ utf8: "We withhold the answer until the proof." }] },
    { tStartMs: 80_000, segs: [{ utf8: "This must not enter the opening." }] },
  ],
}, 75);
assert.equal(transcript, "The first spoken claim. We withhold the answer until the proof.");

async function main(): Promise<void> {
  const originalBin = process.env.YT_DLP_BIN;
  process.env.YT_DLP_BIN = "hermetic-yt-dlp";
  try {
    const commands: readonly string[][] = [];
    let inspectedPaths: string[] = [];
    const result = await withReferenceOpeningEvidence({
    videoId: "dQw4w9WgXcQ",
    windowSec: 75,
    runner: async (_command, args) => {
      (commands as string[][]).push([...args]);
      const outputTemplate = args[args.indexOf("-o") + 1]!;
      const suffix = "/reference.%(ext)s";
      assert.ok(outputTemplate.endsWith(suffix));
      const dir = outputTemplate.slice(0, -suffix.length);
      if (args.includes("sb0")) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${dir}/reference.mhtml`, mhtml(5, 17.75));
      } else {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${dir}/reference.en.json3`, JSON.stringify({
          events: [
            { tStartMs: 1_000, segs: [{ utf8: "Eight real opening words establish a concrete promise right away." }] },
            { tStartMs: 20_000, segs: [{ utf8: "Then the evidence delays the answer." }] },
          ],
        }));
      }
    },
    inspect: async (evidence) => {
      inspectedPaths = [...evidence.framePaths];
      assert.equal(evidence.storyboardSheets, 5);
      assert.equal(evidence.observedSec, 75);
      assert.match(evidence.transcript, /concrete promise/);
      return "reviewed";
    },
    });
    assert.equal(result, "reviewed");
    assert.equal(commands.length, 2);
    const { access } = await import("node:fs/promises");
    for (const path of inspectedPaths) {
      await assert.rejects(() => access(path), /ENOENT/, "temporary competitor evidence must be deleted");
    }

    let failedCaptureDir = "";
    await assert.rejects(
      () => withReferenceOpeningEvidence({
        videoId: "dQw4w9WgXcQ",
        runner: async (_command, args) => {
          const outputTemplate = args[args.indexOf("-o") + 1]!;
          failedCaptureDir = outputTemplate.slice(0, -"/reference.%(ext)s".length);
          throw new Error("intentional capture failure");
        },
        inspect: async () => "unreachable",
      }),
      /intentional capture failure/,
    );
    assert.ok(failedCaptureDir);
    await assert.rejects(
      () => access(failedCaptureDir),
      /ENOENT/,
      "failed capture directories must be deleted too",
    );
  } finally {
    if (originalBin === undefined) delete process.env.YT_DLP_BIN;
    else process.env.YT_DLP_BIN = originalBin;
  }
  console.log("reference opening capture/parser/retention tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
