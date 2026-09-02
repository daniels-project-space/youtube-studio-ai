import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function normalizeThumbnailCopy(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9$%/+]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function thumbnailOcrMatchesExpected(args: {
  ocrText: string;
  expectedWords: readonly string[];
}): { exact: boolean; missing: string[]; normalizedOcr: string } {
  const normalizedOcr = normalizeThumbnailCopy(args.ocrText);
  const observedTokens = normalizedOcr.split(" ").filter(Boolean);
  const missing = args.expectedWords
    .map((word) => normalizeThumbnailCopy(word))
    .filter((word) => {
      if (!word || normalizedOcr.includes(word)) return false;
      const expectedTokens = word.split(" ").filter(Boolean);
      return !expectedTokens.every((expected) => {
        // Currency, percentages, ratios, and compact number callouts are
        // semantic claims: never fuzzy-match them.
        if (/[^A-Z]/u.test(expected) || /\d/u.test(expected)) {
          return observedTokens.includes(expected);
        }
        const allowance = expected.length >= 7 ? 2 : expected.length >= 4 ? 1 : 0;
        return observedTokens.some((observed) =>
          /^[A-Z]+$/u.test(observed) &&
          Math.abs(observed.length - expected.length) <= allowance &&
          levenshtein(observed, expected) <= allowance
        );
      });
    });
  return { exact: missing.length === 0, missing, normalizedOcr };
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

async function tesseract(imagePath: string, psm: "3" | "6" | "11"): Promise<string> {
  const { stdout } = await execFileAsync(
    process.env.TESSERACT_BIN ?? "tesseract",
    [imagePath, "stdout", "--psm", psm, "-l", "eng"],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  return String(stdout ?? "").trim();
}

export async function readThumbnailOcr(imagePath: string): Promise<string> {
  const observations = [await tesseract(imagePath, "3")];
  const scratch = await mkdtemp(join(tmpdir(), "thumbnail-ocr-"));
  try {
    // Native physical typography is often tilted or carved. Read both likely
    // text halves at three deskew angles instead of mistaking a stylized but
    // obvious Golden headline for missing copy.
    const sides = [
      { name: "left", crop: "crop=iw*0.62:ih:0:0" },
      { name: "right", crop: "crop=iw*0.62:ih:iw*0.38:0" },
    ] as const;
    const angles = [
      { name: "flat", radians: "0" },
      { name: "plus8", radians: "0.13962634" },
      { name: "minus8", radians: "-0.13962634" },
    ] as const;
    for (const side of sides) {
      for (const angle of angles) {
        const variant = join(scratch, `${side.name}-${angle.name}.png`);
        const rotate = angle.radians === "0"
          ? ""
          : `,rotate=${angle.radians}:ow=rotw(iw):oh=roth(ih):fillcolor=white`;
        await execFileAsync(
          process.env.FFMPEG_BIN ?? "ffmpeg",
          [
            "-hide_banner", "-loglevel", "error", "-y", "-i", imagePath,
            "-vf", `${side.crop}${rotate},scale=1800:-2,format=gray,eq=contrast=1.7`,
            "-frames:v", "1", variant,
          ],
          { timeout: 30_000, maxBuffer: 1024 * 1024 },
        );
        observations.push(await tesseract(variant, "6"));
      }
    }
    for (const focus of [
      {
        name: "left-tight-plus8",
        filter:
          "crop=iw*0.51:ih*0.86:0:0," +
          "rotate=0.13962634:ow=rotw(iw):oh=roth(ih):fillcolor=white," +
          "scale=1800:-2,format=gray",
      },
      {
        name: "left-headline-flat",
        filter: "crop=iw*0.60:ih*0.83:0:ih*0.07,scale=1920:-2,format=gray,eq=contrast=2",
      },
    ] as const) {
      const variant = join(scratch, `${focus.name}.png`);
      await execFileAsync(
        process.env.FFMPEG_BIN ?? "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-y", "-i", imagePath,
          "-vf", focus.filter, "-frames:v", "1", variant,
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
      observations.push(await tesseract(variant, "11"));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const text = observations.filter(Boolean).join("\n");
  if (!text) throw new Error("thumbnail OCR returned no readable text");
  return text;
}
