/**
 * Bounded reference-video evidence for Channel Inception's Script Lab.
 *
 * OpenRouter accepts images, not YouTube URLs. Rather than restoring the
 * prohibited direct-Google video route, this adapter asks yt-dlp for YouTube's
 * own low-bandwidth storyboard and caption track. Only the first `windowSec`
 * of chronological contact sheets and captions are retained, and the temporary
 * evidence is deleted immediately after the caller's review finishes.
 */
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_WINDOW_SEC = 75;
const MAX_WINDOW_SEC = 90;
const MIN_CAPTION_WORDS = 8;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface ReferenceOpeningEvidence {
  framePaths: string[];
  transcript: string;
  observedSec: number;
  captionTrack: string;
  storyboardSheets: number;
}

export interface ReferenceOpeningCapability {
  available: boolean;
  reason: string;
  version?: string;
}

export type ReferenceOpeningCommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<void>;

function ytDlpBin(): string {
  return process.env.YT_DLP_BIN?.trim() || "yt-dlp";
}

export function referenceOpeningCapability(): ReferenceOpeningCapability {
  const result = spawnSync(ytDlpBin(), ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      reason: "the pinned yt-dlp storyboard/caption capture runtime is unavailable",
    };
  }
  const version = result.stdout.trim();
  return version
    ? { available: true, reason: "", version }
    : { available: false, reason: "the yt-dlp capture runtime returned no version" };
}

const defaultRunner: ReferenceOpeningCommandRunner = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = String(stderr || error.message).replace(/\s+/g, " ").trim().slice(0, 700);
      reject(new Error(`reference opening capture failed: ${detail || error.message}`, { cause: error }));
    });
  });

function boundedWindow(value: number | undefined): number {
  const windowSec = value ?? DEFAULT_WINDOW_SEC;
  if (!Number.isFinite(windowSec) || windowSec < 30 || windowSec > MAX_WINDOW_SEC) {
    throw new Error(`reference opening window must be between 30 and ${MAX_WINDOW_SEC} seconds`);
  }
  return windowSec;
}

function mhtmlBoundary(bytes: Buffer): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 8_192)).toString("latin1");
  const match = head.match(/boundary=(?:"([^"]+)"|([^;\r\n\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new Error("reference storyboard is not a valid bounded MHTML document");
  return boundary;
}

export interface StoryboardSheet {
  jpeg: Buffer;
  durationSec: number;
}

/** Parse only JPEG MIME parts needed to cover the requested opening window. */
export function parseOpeningStoryboardMhtml(bytes: Buffer, windowSec = DEFAULT_WINDOW_SEC): StoryboardSheet[] {
  const bounded = boundedWindow(windowSec);
  const boundary = Buffer.from(`--${mhtmlBoundary(bytes)}`, "latin1");
  const headerBreak = Buffer.from("\r\n\r\n", "latin1");
  const nextPartPrefix = Buffer.from("\r\n--", "latin1");
  const sheets: StoryboardSheet[] = [];
  let covered = 0;
  let cursor = bytes.indexOf(boundary);

  while (cursor >= 0 && cursor < bytes.length && covered < bounded) {
    const afterBoundary = cursor + boundary.length;
    if (bytes.subarray(afterBoundary, afterBoundary + 2).toString("latin1") === "--") break;
    const headersStart = afterBoundary +
      (bytes.subarray(afterBoundary, afterBoundary + 2).toString("latin1") === "\r\n" ? 2 : 0);
    const headersEnd = bytes.indexOf(headerBreak, headersStart);
    if (headersEnd < 0) break;
    const headers = bytes.subarray(headersStart, headersEnd).toString("latin1");
    const bodyStart = headersEnd + headerBreak.length;
    const nextPart = bytes.indexOf(nextPartPrefix, bodyStart);
    if (nextPart < 0) break;

    if (/content-type:\s*image\/jpeg/i.test(headers)) {
      const duration = Number(headers.match(/x\.yt-dlp\.duration:\s*([0-9.]+)/i)?.[1]);
      const jpeg = bytes.subarray(bodyStart, nextPart);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("reference storyboard sheet omitted its duration");
      }
      if (jpeg.length < 1_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        throw new Error("reference storyboard sheet is not a usable JPEG");
      }
      sheets.push({ jpeg: Buffer.from(jpeg), durationSec: duration });
      covered += duration;
    }
    cursor = bytes.indexOf(boundary, nextPart + 2);
  }

  if (sheets.length === 0 || covered + 0.5 < bounded) {
    throw new Error(
      `reference storyboard covers only ${covered.toFixed(1)}s of the required ${bounded.toFixed(1)}s opening`,
    );
  }
  return sheets;
}

type CaptionEvent = {
  tStartMs?: unknown;
  segs?: Array<{ utf8?: unknown }>;
};

/** Extract visible caption text from the bounded opening without persisting it. */
export function transcriptFromJson3(value: unknown, windowSec = DEFAULT_WINDOW_SEC): string {
  const bounded = boundedWindow(windowSec);
  const events = value && typeof value === "object" && Array.isArray((value as { events?: unknown }).events)
    ? ((value as { events: CaptionEvent[] }).events)
    : [];
  const lines: string[] = [];
  for (const event of events) {
    const startMs = Number(event.tStartMs);
    if (!Number.isFinite(startMs) || startMs < 0 || startMs >= bounded * 1_000 || !Array.isArray(event.segs)) continue;
    const line = event.segs
      .map((segment) => typeof segment.utf8 === "string" ? segment.utf8 : "")
      .join("")
      .replace(/<[^>]+>/g, " ")
      .replace(/\[[^\]]{1,40}\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || lines.at(-1) === line) continue;
    lines.push(line);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function captionPreference(name: string): number {
  if (/\.en\.json3$/i.test(name)) return 0;
  if (/\.en-orig\.json3$/i.test(name)) return 1;
  if (/\.en-en\.json3$/i.test(name)) return 2;
  return 10;
}

async function readOpeningTranscript(dir: string, windowSec: number): Promise<{ text: string; track: string }> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".json3"))
    .sort((a, b) => captionPreference(a) - captionPreference(b) || a.localeCompare(b));
  let best = { text: "", track: "" };
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as unknown;
      const text = transcriptFromJson3(parsed, windowSec);
      if (text.split(/\s+/).filter(Boolean).length > best.text.split(/\s+/).filter(Boolean).length) {
        best = { text, track: name };
      }
    } catch {
      // A malformed optional language track cannot displace a valid one.
    }
  }
  if (best.text.split(/\s+/).filter(Boolean).length < MIN_CAPTION_WORDS) {
    throw new Error(
      `reference opening has no usable English caption evidence in the first ${windowSec.toFixed(0)} seconds`,
    );
  }
  return best;
}

/**
 * Capture, inspect, and immediately delete a reference opening. The action must
 * finish before the temporary files disappear, so callers cannot accidentally
 * turn competitor footage into a retained asset library.
 */
export async function withReferenceOpeningEvidence<T>(args: {
  videoId: string;
  windowSec?: number;
  runner?: ReferenceOpeningCommandRunner;
  inspect: (evidence: ReferenceOpeningEvidence) => Promise<T>;
}): Promise<T> {
  if (!VIDEO_ID.test(args.videoId)) throw new Error("reference opening requires a valid YouTube video id");
  const windowSec = boundedWindow(args.windowSec);
  const runner = args.runner ?? defaultRunner;
  const dir = await mkdtemp(join(tmpdir(), `studio-reference-${args.videoId}-`));
  const url = `https://www.youtube.com/watch?v=${args.videoId}`;
  try {
    // web_safari exposes YouTube's storyboard even when CDN video bytes reject
    // server IPs. Captions use the default extractor, which exposes English
    // tracks on the same videos but not under the storyboard-only client.
    await runner(ytDlpBin(), [
      "--no-playlist", "--no-warnings", "--no-progress",
      "--extractor-args", "youtube:player_client=web_safari",
      "-f", "sb0",
      "-o", join(dir, "reference.%(ext)s"),
      url,
    ], 45_000);
    await runner(ytDlpBin(), [
      "--no-playlist", "--no-warnings", "--no-progress", "--skip-download",
      "--write-subs", "--write-auto-subs",
      "--sub-langs", "en-orig,en,en-en",
      "--sub-format", "json3",
      "-o", join(dir, "reference.%(ext)s"),
      url,
    ], 45_000);

    const storyboard = await readFile(join(dir, "reference.mhtml"));
    const sheets = parseOpeningStoryboardMhtml(storyboard, windowSec);
    const framePaths: string[] = [];
    for (const [index, sheet] of sheets.entries()) {
      const path = join(dir, `opening-${String(index + 1).padStart(2, "0")}.jpg`);
      await writeFile(path, sheet.jpeg);
      framePaths.push(path);
    }
    const transcript = await readOpeningTranscript(dir, windowSec);
    return await args.inspect({
      framePaths,
      transcript: transcript.text,
      captionTrack: transcript.track,
      storyboardSheets: sheets.length,
      observedSec: Math.min(windowSec, sheets.reduce((sum, sheet) => sum + sheet.durationSec, 0)),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
