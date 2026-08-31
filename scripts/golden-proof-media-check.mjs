// Golden proof-media audit.
//
// This is intentionally opt-in: it runs ffmpeg/ffprobe against every stored
// Golden artifact, so it is too slow for the normal unit-test loop. Its
// companion source test verifies the same manifest hashes cheaply on every
// production-readiness run. Run it after changing Golden media:
//
//   npm run test:golden-proof-media
//
// The versioned manifest is the authority for what the Golden catalog may
// present. `reference` assets may appear as evidence; `context` assets may be
// shown only with a non-evidence hold; `historical`, `quarantined`, and
// `duplicate` assets are retained for audit but cannot be resolved by the UI.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(root, "public");
const goldenRoot = join(publicRoot, "golden");
const manifestPath = join(root, "src", "engine", "goldenProofMediaManifest.json");

const JSON_OUTPUT = process.argv.includes("--json");
const INTEGRITY_ONLY = process.argv.includes("--integrity-only");
const PRESENTABLE = new Set(["reference", "context"]);
const STATUSES = new Set(["reference", "context", "historical", "quarantined", "duplicate"]);
const KINDS = new Set(["image", "video", "audio"]);
const EXTENSIONS = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  video: new Set([".mp4"]),
  audio: new Set([".mp3"]),
};

// Total black time as a percentage of runtime above which a blank-video run is
// reportable. A long individual run is reportable even below that percentage.
const BLACK_TOTAL_PCT_THRESHOLD = 5;
const BLACK_SEGMENT_SECONDS_THRESHOLD = 3;
const EDGE_TOLERANCE_SECONDS = 2;
const SILENCE_DB_THRESHOLD = -35;
const BLACKDETECT_FILTER = "blackdetect=d=0.5:pic_th=0.98:pix_th=0.10";

// `blackdetect` deliberately treats a mostly-dark title card as black. A
// designed dark frame is still visual evidence when it has persistent bright
// title/countdown content, so sample three points and require a high-luma
// signal in at least two. This keeps a genuine blank tail (Fordlandia YMAX 59)
// separate from the Quiz title/countdown (YMAX 255) without a per-file waiver.
const VISIBLE_CONTENT_YMAX_THRESHOLD = 96;
const VISIBLE_CONTENT_MIN_SAMPLES = 2;

function relativeToPublic(path) {
  return relative(publicRoot, path).replaceAll("\\", "/");
}

function findGoldenFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findGoldenFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function kindForPath(path) {
  const extension = extname(path).toLowerCase();
  for (const [kind, extensions] of Object.entries(EXTENSIONS)) {
    if (extensions.has(extension)) return kind;
  }
  return null;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runFfprobe(args) {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
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
    ["-hide_banner", "-loglevel", "info", "-i", file, "-vf", BLACKDETECT_FILTER, "-an", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const segments = [];
  const re = /black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g;
  let match;
  while ((match = re.exec(output)) !== null) {
    segments.push({
      start: Number.parseFloat(match[1]),
      end: Number.parseFloat(match[2]),
      duration: Number.parseFloat(match[3]),
    });
  }
  return segments;
}

function getAudioLevelDb(file, start, end) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "info", "-ss", String(start), "-to", String(end), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return match ? Number.parseFloat(match[1]) : null;
}

function getFrameYMax(file, timestamp) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "info", "-ss", String(timestamp), "-i", file,
      "-vf", "signalstats,metadata=print:file=-", "-frames:v", "1", "-an", "-f", "null", "-",
    ],
    { encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const values = [...output.matchAll(/lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/g)]
    .map((match) => Number.parseFloat(match[1]))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function visualContentSamples(file, segment) {
  const timestamps = [0.25, 0.5, 0.75].map(
    (portion) => segment.start + segment.duration * portion,
  );
  const yMax = timestamps.map((timestamp) => getFrameYMax(file, timestamp));
  const visibleCount = yMax.filter((value) => value !== null && value >= VISIBLE_CONTENT_YMAX_THRESHOLD).length;
  return { yMax, visibleCount, meaningful: visibleCount >= VISIBLE_CONTENT_MIN_SAMPLES };
}

function formatSeconds(value) {
  return `${value.toFixed(2)}s`;
}

function validateManifest(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { errors: ["manifest must be an object"], entries: [], entriesByPath: new Map(), entriesById: new Map() };
  if (value.schemaVersion !== 1) errors.push(`unsupported manifest schemaVersion ${String(value.schemaVersion)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.catalogVersion ?? "")) errors.push("manifest catalogVersion must be YYYY-MM-DD");
  if (!Array.isArray(value.entries) || value.entries.length === 0) errors.push("manifest entries must be a non-empty array");

  const entries = Array.isArray(value.entries) ? value.entries : [];
  const entriesByPath = new Map();
  const entriesById = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      errors.push("manifest contains a non-object entry");
      continue;
    }
    const label = typeof entry.id === "string" ? entry.id : "<unknown>";
    if (!/^[a-z0-9-]+$/.test(entry.id ?? "")) errors.push(`${label}: invalid id`);
    if (!/^golden\/[a-z0-9_/-]+\.(?:jpg|jpeg|png|webp|mp4|mp3)$/i.test(entry.path ?? "")) errors.push(`${label}: invalid public/golden path`);
    if (!KINDS.has(entry.kind)) errors.push(`${label}: invalid kind ${String(entry.kind)}`);
    if (!STATUSES.has(entry.status)) errors.push(`${label}: invalid status ${String(entry.status)}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) errors.push(`${label}: invalid SHA-256`);
    if (entry.path && kindForPath(entry.path) !== entry.kind) errors.push(`${label}: path extension does not match ${String(entry.kind)} kind`);
    if (entriesByPath.has(entry.path)) errors.push(`${label}: duplicate path ${entry.path}`);
    if (entriesById.has(entry.id)) errors.push(`${label}: duplicate id`);
    entriesByPath.set(entry.path, entry);
    entriesById.set(entry.id, entry);
    if (entry.status === "duplicate" && !entry.duplicateOf) errors.push(`${label}: duplicate status needs duplicateOf`);
    if (entry.status !== "duplicate" && entry.duplicateOf) errors.push(`${label}: only duplicate status may declare duplicateOf`);
    if ((entry.status === "context" || entry.status === "quarantined") && !entry.statusReason) errors.push(`${label}: ${entry.status} status needs a reason`);
  }

  for (const entry of entries.filter((candidate) => candidate?.status === "duplicate")) {
    const canonical = entriesById.get(entry.duplicateOf);
    if (!canonical) errors.push(`${entry.id}: duplicateOf ${entry.duplicateOf} is not in the manifest`);
    else if (canonical.status === "duplicate") errors.push(`${entry.id}: duplicateOf may not point to another duplicate`);
    else if (canonical.sha256 !== entry.sha256) errors.push(`${entry.id}: duplicateOf SHA-256 does not match canonical`);
    else if (canonical.kind !== entry.kind) errors.push(`${entry.id}: duplicateOf kind does not match canonical`);
  }

  const presentable = new Map();
  for (const entry of entries.filter((candidate) => PRESENTABLE.has(candidate?.status))) {
    const prior = presentable.get(entry.sha256);
    if (prior) errors.push(`${entry.id} and ${prior.id}: presentable duplicate SHA-256 is forbidden`);
    presentable.set(entry.sha256, entry);
  }
  return { errors, entries, entriesByPath, entriesById };
}

function checkFile(entry, path) {
  const finding = {
    id: entry.id,
    file: entry.path,
    status: entry.status,
    kind: entry.kind,
    issues: [],
    notes: [],
    corrupt: false,
  };
  const size = statSync(path).size;
  if (size === 0) {
    finding.corrupt = true;
    finding.issues.push("empty media file");
    return finding;
  }

  if (entry.kind === "image") return finding;

  const duration = getDuration(path);
  if (duration === null || duration <= 0) {
    finding.corrupt = true;
    finding.issues.push(`corrupt or unreadable: ffprobe could not read a valid duration (size=${size} bytes, duration=${duration})`);
    return finding;
  }
  if (entry.kind === "audio") return finding;

  const segments = detectBlackSegments(path);
  const audioPresent = hasAudioStream(path);
  const annotated = segments.map((segment) => {
    const visual = visualContentSamples(path, segment);
    const isAtStart = segment.start <= EDGE_TOLERANCE_SECONDS;
    const isAtEnd = duration - segment.end <= EDGE_TOLERANCE_SECONDS;
    const isEdge = isAtStart || isAtEnd;
    const audioDb = audioPresent ? getAudioLevelDb(path, segment.start, segment.end) : null;
    const isSilent = !audioPresent || audioDb === null || audioDb <= SILENCE_DB_THRESHOLD;
    const exemptFade = isEdge && isSilent;
    return { ...segment, ...visual, isAtStart, isAtEnd, audioDb, audioPresent, isSilent, exemptFade };
  });

  for (const segment of annotated.filter((candidate) => candidate.meaningful)) {
    finding.notes.push(
      `dark-design segment ${formatSeconds(segment.start)}-${formatSeconds(segment.end)} has persistent visible content (YMAX samples ${segment.yMax.map((value) => value ?? "?").join(", ")})`,
    );
  }

  const nonExempt = annotated.filter((segment) => !segment.exemptFade && !segment.meaningful);
  const nonExemptTotal = nonExempt.reduce((sum, segment) => sum + segment.duration, 0);
  const nonExemptPct = (nonExemptTotal / duration) * 100;
  const worstSegment = nonExempt.reduce(
    (max, segment) => (segment.duration > (max?.duration ?? 0) ? segment : max),
    null,
  );
  const overPct = nonExemptPct > BLACK_TOTAL_PCT_THRESHOLD;
  const overSingle = Boolean(worstSegment) && worstSegment.duration > BLACK_SEGMENT_SECONDS_THRESHOLD;

  if (overPct || overSingle) {
    for (const segment of nonExempt) {
      const position = segment.isAtStart ? "at start" : segment.isAtEnd ? "at end" : "mid-video";
      const audioDesc = segment.audioPresent
        ? segment.audioDb === null
          ? "audio level unreadable"
          : `audio mean level ${segment.audioDb.toFixed(1)} dB`
        : "no audio stream";
      const tell = segment.audioPresent && segment.audioDb !== null && !segment.isSilent
        ? " -- picture is black but audio is still at normal level (not a fade)"
        : "";
      finding.issues.push(
        `blank segment ${formatSeconds(segment.start)}-${formatSeconds(segment.end)} ` +
        `(${formatSeconds(segment.duration)}, ${((segment.duration / duration) * 100).toFixed(1)}% of ${formatSeconds(duration)} runtime), ` +
        `${position}, ${audioDesc}${tell}`,
      );
    }
  }

  return finding;
}

function duplicateErrors(groups, entriesByPath) {
  const errors = [];
  for (const group of groups) {
    const entries = group.paths.map((path) => entriesByPath.get(path)).filter(Boolean);
    if (entries.length !== group.paths.length) {
      errors.push(`duplicate bytes ${group.sha256}: an asset is missing from the manifest`);
      continue;
    }
    const canonical = entries.filter((entry) => entry.status !== "duplicate");
    if (canonical.length !== 1) {
      errors.push(`duplicate bytes ${group.sha256}: expected exactly one canonical asset, found ${canonical.length}`);
      continue;
    }
    for (const entry of entries) {
      if (entry === canonical[0]) continue;
      if (entry.status !== "duplicate" || entry.duplicateOf !== canonical[0].id) {
        errors.push(`duplicate bytes ${group.sha256}: ${entry.id} must be duplicateOf ${canonical[0].id}`);
      }
    }
  }
  return errors;
}

async function main() {
  let rawManifest;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = `Could not parse Golden proof-media manifest: ${error instanceof Error ? error.message : String(error)}`;
    if (JSON_OUTPUT) process.stdout.write(`${JSON.stringify({ ok: false, errors: [message] }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 1;
    return;
  }

  const { errors, entries, entriesByPath } = validateManifest(rawManifest);
  let files = [];
  try {
    files = findGoldenFiles(goldenRoot).sort();
  } catch (error) {
    errors.push(`Could not read public/golden: ${error instanceof Error ? error.message : String(error)}`);
  }
  const filesByPath = new Map(files.map((path) => [relativeToPublic(path), path]));

  for (const path of filesByPath.keys()) {
    if (!kindForPath(path)) errors.push(`${path}: unsupported Golden media extension; add an explicit kind before it can be cataloged`);
    if (!entriesByPath.has(path)) errors.push(`${path}: missing from Golden proof-media manifest`);
  }
  for (const entry of entries) {
    if (!filesByPath.has(entry.path)) errors.push(`${entry.id}: manifest path ${entry.path} is missing on disk`);
  }

  const findings = [];
  const hashesByPath = new Map();
  for (const entry of entries.slice().sort((left, right) => left.path.localeCompare(right.path))) {
    const path = filesByPath.get(entry.path);
    if (!path) continue;
    const sha256 = sha256File(path);
    hashesByPath.set(entry.path, sha256);
    if (sha256 !== entry.sha256) errors.push(`${entry.id}: SHA-256 drift (${sha256} != ${entry.sha256})`);
    const finding = INTEGRITY_ONLY
      ? { id: entry.id, file: entry.path, status: entry.status, kind: entry.kind, issues: [], notes: [], corrupt: false }
      : checkFile(entry, path);
    findings.push(finding);
    if (finding.issues.length && PRESENTABLE.has(entry.status)) {
      errors.push(`${entry.id}: presentable ${entry.status} media failed quality audit: ${finding.issues.join("; ")}`);
    }
  }

  const duplicateMap = new Map();
  for (const [path, sha256] of hashesByPath.entries()) {
    if (!duplicateMap.has(sha256)) duplicateMap.set(sha256, []);
    duplicateMap.get(sha256).push(path);
  }
  const duplicateGroups = [...duplicateMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }));
  errors.push(...duplicateErrors(duplicateGroups, entriesByPath));

  const statusSummary = Object.fromEntries(
    [...STATUSES].map((status) => [status, entries.filter((entry) => entry.status === status).length]),
  );
  const report = {
    ok: errors.length === 0,
    manifest: {
      schemaVersion: rawManifest.schemaVersion,
      catalogVersion: rawManifest.catalogVersion,
      auditedAt: rawManifest.auditedAt,
    },
    integrityOnly: INTEGRITY_ONLY,
    filesChecked: findings.length,
    statusSummary,
    findings,
    duplicateGroups,
    errors,
  };

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`Golden proof-media audit · catalog v${rawManifest.catalogVersion} · ${INTEGRITY_ONLY ? "integrity only" : "full visual check"}`);
    for (const finding of findings) {
      const label = finding.status.toUpperCase().padEnd(11);
      console.log(`${label} ${finding.file}`);
      for (const note of finding.notes) console.log(`             note: ${note}`);
      for (const issue of finding.issues) console.log(`             ${PRESENTABLE.has(finding.status) ? "ERROR" : "excluded"}: ${issue}`);
    }
    if (duplicateGroups.length) {
      console.log("\nDuplicate byte groups (all noncanonical paths are excluded):");
      for (const group of duplicateGroups) {
        console.log(`  SHA-256=${group.sha256}`);
        for (const path of group.paths) console.log(`    - ${path}`);
      }
    }
    console.log("\n--- Summary ---");
    console.log(`Checked ${findings.length} manifest assets: ${Object.entries(statusSummary).map(([status, count]) => `${count} ${status}`).join(", ")}.`);
    if (errors.length) {
      console.log(`FAILED with ${errors.length} manifest/evidence error(s):`);
      for (const error of errors) console.log(`  - ${error}`);
    } else {
      console.log("PASS: all presentable assets match their recorded SHA-256; no presentable video failed the configured blank-frame check; quarantined and duplicate assets remain nonpresentable.");
    }
  }
  if (errors.length) process.exitCode = 1;
}

await main();
