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

/**
 * Words that exist ONLY as art-direction instructions in the thumbnail brief.
 * A provider that bakes one of these into the artwork has rendered the
 * instruction instead of obeying it — the "(the payoff word, HUGE)" class of
 * defect. Checking `missing` alone cannot catch this: a leaked word adds no
 * missing copy, so the candidate scores exact and ships.
 *
 * A word here is only a leak when it is NOT part of this video's planned copy,
 * so a channel that genuinely writes "PAYOFF" on a thumbnail is unaffected.
 */
export const PROMPT_INSTRUCTION_LEAK_WORDS = [
  "HUGE", "PAYOFF", "ACCENT", "HEADLINE", "SUBTITLE", "BADGE", "HEROPROP",
  "BACKGROUND", "TEXTZONE", "PLACEHOLDER", "UPPERCASE", "PALETTE", "TEMPLATE",
  "LOREM", "IPSUM", "OMIT", "CAPTION", "KEYLINE", "COMPOSITION", "THUMBNAIL",
] as const;

export function thumbnailOcrMatchesExpected(args: {
  ocrText: string;
  expectedWords: readonly string[];
}): {
  matched: boolean;
  exact: boolean;
  missing: string[];
  misspelled: { expected: string; observed: string }[];
  leaked: string[];
  normalizedOcr: string;
} {
  const normalizedOcr = normalizeThumbnailCopy(args.ocrText);
  const observedTokens = normalizedOcr.split(" ").filter(Boolean);
  // Anything the channel actually planned is legitimate copy, never a leak.
  const plannedTokens = new Set(
    args.expectedWords.flatMap((word) => normalizeThumbnailCopy(word).split(" ")).filter(Boolean),
  );
  const leaked = PROMPT_INSTRUCTION_LEAK_WORDS
    .filter((word) => !plannedTokens.has(word) && observedTokens.includes(word));
  const missing: string[] = [];
  // A word the provider ATTEMPTED but spelled wrong. The fuzzy allowance below
  // exists so stylized type is not mistaken for absent copy — but silently
  // passing a near-miss also ships "GONE QUIETLI". Record every word that only
  // survived on fuzz so the caller can fail closed on a genuine misspelling.
  const misspelled: { expected: string; observed: string }[] = [];
  for (const raw of args.expectedWords) {
    const word = normalizeThumbnailCopy(raw);
    if (!word || normalizedOcr.includes(word)) continue;
    let wordMissing = false;
    for (const expected of word.split(" ").filter(Boolean)) {
      if (observedTokens.includes(expected)) continue;
      // Currency, percentages, ratios, and compact number callouts are
      // semantic claims: never fuzzy-match them.
      if (/[^A-Z]/u.test(expected) || /\d/u.test(expected)) {
        wordMissing = true;
        continue;
      }
      const allowance = expected.length >= 7 ? 2 : expected.length >= 4 ? 1 : 0;
      const nearMiss = observedTokens.find((observed) =>
        /^[A-Z]+$/u.test(observed) &&
        Math.abs(observed.length - expected.length) <= allowance &&
        levenshtein(observed, expected) <= allowance
      );
      // A near miss that is a strict PREFIX or SUFFIX of the planned word is an
      // OCR crop, not a spelling error — readers routinely clip the last glyph
      // of oversized type. A real misspelling substitutes a character
      // ("QUIETLI" for "QUIETLY"), which survives this filter.
      const truncation = nearMiss
        && (expected.startsWith(nearMiss) || expected.endsWith(nearMiss))
        && nearMiss.length < expected.length;
      if (nearMiss && !truncation) misspelled.push({ expected, observed: nearMiss });
      else if (!nearMiss) wordMissing = true;
    }
    if (wordMissing) missing.push(word);
  }
  return {
    // `matched` keeps the historical lenient reading: every planned word is
    // present, spelling fuzz allowed. `exact` is the strict contract.
    matched: missing.length === 0,
    exact: missing.length === 0 && misspelled.length === 0 && leaked.length === 0,
    missing,
    misspelled,
    leaked,
    normalizedOcr,
  };
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
