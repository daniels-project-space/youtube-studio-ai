// Diagnostic quality check for public/golden/ proof videos.
//
// OPT-IN / NOT part of the default gate. This is intentionally NOT wired into
// `npm test` or `npm run test:production-readiness` (see package.json) because
// it shells out to ffmpeg/ffprobe against every committed video file under
// public/golden/, which is slow and would slow down every CI run for a class
// of defect (stale proof media) that changes rarely. Run it manually:
//
//   npm run test:golden-proof-media
//
// after touching anything under public/golden/, or periodically to catch
// media that went stale / got re-uploaded with a regression.
//
// Background: an audit on 2026-08-12 found public/golden/documotion/fordlandia.mp4
// had an 11.5%-of-runtime black tail (59.87s -> 67.63s of 67.71s) with narration
// still playing at full volume over the black screen -- a real defect in what the
// app's "golden modules" showcase page presents to viewers. It was traced to
// stale media (produced before the narration-driven-audio fix in commit
// f7543832, 2026-06-28) rather than a current bug, but nothing caught it
// automatically. This script exists so the next stale/bad upload gets flagged.
//
// It checks two things:
//   1. Black-frame defects: any video with a large black-frame run is flagged,
//      UNLESS the black segment is clearly an intentional intro/outro fade --
//      i.e. it sits at the very start or very end of the clip AND the audio is
//      also near-silent during that segment. A real fade drops picture and
//      sound together; the fordlandia bug is exactly the case where the
//      picture drops but the audio does not -- that's the tell we key on.
//   2. Byte-identical duplicates: any two golden .mp4 files (in the same or a
//      different proof directory) with the same MD5 are flagged, since two
//      files presented as separate pieces of evidence should not literally be
//      the same bytes.
//
// This is a diagnostic tool, not a hard gate: it prints clear, specific
// findings (file + defect) rather than a bare pass/fail, and it is written to
// be tolerant of edge cases (missing audio streams, unreadable files, etc.)
// rather than exhaustively engineered. Exit code is 1 if anything was flagged
// so a human running it manually gets a nonzero signal, but nothing in the
// default build/test pipeline depends on that exit code.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldenRoot = join(root, "public", "golden");

// ---- Tunable thresholds -----------------------------------------------
// Total black time as a percentage of runtime above which a video is flagged.
const BLACK_TOTAL_PCT_THRESHOLD = 5;
// Any single black segment longer than this (seconds) is flagged on its own.
const BLACK_SEGMENT_SECONDS_THRESHOLD = 3;
// How close (seconds) a black segment's start/end must be to the clip's own
// start/end to count as "the very start/end" for fade-exemption purposes.
const EDGE_TOLERANCE_SECONDS = 2;
// mean_volume (dB) at or below this counts as "near-silent" for fade checks.
// A real fade's audio bed sits far below normal dialogue/narration level.
const SILENCE_DB_THRESHOLD = -35;
// blackdetect tuning: minimum segment duration to report, and the picture /
// pixel thresholds that decide whether a frame counts as "black". These are
// close to ffmpeg's own defaults but with a shorter min duration (0.5s
// instead of ffmpeg's default 2.0s) so short intro/outro fades still surface
// and can go through the exemption check rather than being invisible.
const BLACKDETECT_FILTER = "blackdetect=d=0.5:pic_th=0.98:pix_th=0.10";
// -------------------------------------------------------------------------

function findMp4Files(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findMp4Files(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) {
      out.push(full);
    }
  }
  return out;
}

function runFfprobe(args) {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function getDuration(file) {
  const out = runFfprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  if (out === null) return null;
  const value = Number.parseFloat(out.trim());
  return Number.isFinite(value) ? value : null;
}

function hasAudioStream(file) {
  const out = runFfprobe([
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    file,
  ]);
  return typeof out === "string" && out.trim().length > 0;
}

function detectBlackSegments(file) {
  const result = spawnSync(
    "ffmpeg",
    ["-i", file, "-vf", BLACKDETECT_FILTER, "-an", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const stderr = result.stderr || "";
  const segments = [];
  const re = /black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g;
  let match;
  while ((match = re.exec(stderr)) !== null) {
    segments.push({
      start: Number.parseFloat(match[1]),
      end: Number.parseFloat(match[2]),
      duration: Number.parseFloat(match[3]),
    });
  }
  return segments;
}

// Returns mean_volume in dB for the given window, or null if there's no
// audio to measure (no audio stream, or ffmpeg couldn't parse a level).
function getAudioLevelDb(file, start, end) {
  const result = spawnSync(
    "ffmpeg",
    ["-ss", String(start), "-to", String(end), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const stderr = result.stderr || "";
  const match = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function md5File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function formatSeconds(value) {
  return `${value.toFixed(2)}s`;
}

async function checkFile(file) {
  const label = relative(root, file);
  const finding = { file: label, issues: [], corrupt: false };

  const size = statSync(file).size;
  const duration = getDuration(file);

  if (size === 0 || duration === null || duration <= 0) {
    finding.corrupt = true;
    finding.issues.push(
      `corrupt or unreadable: ffprobe could not read a valid duration (size=${size} bytes, duration=${duration})`,
    );
    return finding;
  }

  const segments = detectBlackSegments(file);
  if (segments.length > 0) {
    const audioPresent = hasAudioStream(file);
    const annotated = segments.map((seg) => {
      const isAtStart = seg.start <= EDGE_TOLERANCE_SECONDS;
      const isAtEnd = duration - seg.end <= EDGE_TOLERANCE_SECONDS;
      const isEdge = isAtStart || isAtEnd;
      const audioDb = audioPresent ? getAudioLevelDb(file, seg.start, seg.end) : null;
      // No audio stream at all counts as silent for fade-detection purposes.
      const isSilent = !audioPresent || audioDb === null || audioDb <= SILENCE_DB_THRESHOLD;
      const exempt = isEdge && isSilent;
      return { ...seg, isAtStart, isAtEnd, isEdge, audioDb, audioPresent, isSilent, exempt };
    });

    const nonExempt = annotated.filter((s) => !s.exempt);
    const nonExemptTotal = nonExempt.reduce((sum, s) => sum + s.duration, 0);
    const nonExemptPct = (nonExemptTotal / duration) * 100;
    const worstSegment = nonExempt.reduce(
      (max, s) => (s.duration > (max?.duration ?? 0) ? s : max),
      null,
    );

    const overPct = nonExemptPct > BLACK_TOTAL_PCT_THRESHOLD;
    const overSingle = Boolean(worstSegment) && worstSegment.duration > BLACK_SEGMENT_SECONDS_THRESHOLD;

    if (overPct || overSingle) {
      for (const seg of nonExempt) {
        const position = seg.isAtStart ? "at start" : seg.isAtEnd ? "at end" : "mid-video";
        const audioDesc = seg.audioPresent
          ? seg.audioDb === null
            ? "audio level unreadable"
            : `audio mean level ${seg.audioDb.toFixed(1)} dB`
          : "no audio stream";
        const tell = seg.audioPresent && seg.audioDb !== null && !seg.isSilent
          ? " -- picture is black but audio is still at normal level (not a fade)"
          : "";
        finding.issues.push(
          `black segment ${formatSeconds(seg.start)}-${formatSeconds(seg.end)} ` +
          `(${formatSeconds(seg.duration)}, ${((seg.duration / duration) * 100).toFixed(1)}% of ${formatSeconds(duration)} runtime), ` +
          `${position}, ${audioDesc}${tell}`,
        );
      }
    } else if (annotated.some((s) => s.exempt)) {
      // Nothing to report at file level; exempted fades are expected and not printed as issues.
    }
  }

  return finding;
}

async function findDuplicates(files) {
  const byHash = new Map();
  for (const file of files) {
    const hash = await md5File(file);
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(file);
  }
  const duplicateGroups = [];
  for (const [hash, group] of byHash.entries()) {
    if (group.length > 1) {
      duplicateGroups.push({ hash, files: group.map((f) => relative(root, f)) });
    }
  }
  return duplicateGroups;
}

async function main() {
  console.log("Golden proof media check (opt-in diagnostic -- not part of the default test gate)");
  console.log(`Scanning: ${relative(root, goldenRoot)}\n`);

  let files;
  try {
    files = findMp4Files(goldenRoot).sort();
  } catch (err) {
    console.error(`Could not read ${goldenRoot}: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No .mp4 files found under public/golden/. Nothing to check.");
    return;
  }

  const findings = [];
  for (const file of files) {
    findings.push(await checkFile(file));
  }

  const duplicateGroups = await findDuplicates(files);

  const flaggedFindings = findings.filter((f) => f.issues.length > 0);
  const cleanCount = findings.length - flaggedFindings.length;

  for (const finding of findings) {
    if (finding.issues.length === 0) {
      console.log(`OK    ${finding.file}`);
      continue;
    }
    console.log(`${finding.corrupt ? "CORRUPT" : "FLAGGED"} ${finding.file}`);
    for (const issue of finding.issues) {
      console.log(`         - ${issue}`);
    }
  }

  if (duplicateGroups.length > 0) {
    console.log("\nDuplicate (byte-identical) proof files:");
    for (const group of duplicateGroups) {
      console.log(`  DUPLICATE md5=${group.hash}`);
      for (const path of group.files) {
        console.log(`    - ${path}`);
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Checked ${files.length} file(s): ${cleanCount} clean, ${flaggedFindings.length} flagged.`);
  console.log(`Duplicate groups: ${duplicateGroups.length}.`);

  if (flaggedFindings.length > 0 || duplicateGroups.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`golden-proof-media-check failed: ${err.stack || err.message}`);
  process.exit(1);
});
