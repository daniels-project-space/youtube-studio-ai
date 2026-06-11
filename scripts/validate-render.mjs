/**
 * DETERMINISTIC render validator — no LLM, no flakiness. Catches the structural
 * defects that actually matter via ffmpeg signal analysis over a presigned R2 URL
 * (streamed, no full download):
 *   - missing/blank TITLE CARD  = black/near-black frames at the start
 *   - premature/mid-video OUTRO = the outro's fade-to-black appearing mid-timeline
 *   - empty inserts / dead air   = black or frozen segments anywhere
 * Runs in seconds and is 100% reproducible. Env: VIDEO_KEY, INTRO_SEC, TAIL_SEC.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spawnSync } from "node:child_process";

const E = process.env;
const FFMPEG = E.FFMPEG_BIN || "ffmpeg";
const FFPROBE = E.FFPROBE_BIN || "ffprobe";
const introSec = Number(E.INTRO_SEC || 5);
const tailSec = Number(E.TAIL_SEC || 4);

const s3 = new S3Client({ region: "auto", endpoint: E.R2_ENDPOINT, credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: E.VIDEO_KEY }), { expiresIn: 3600 });

const dur = parseFloat((spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url], { encoding: "utf8" }).stdout || "0").trim()) || 0;

// Decode at 4fps for speed. Threshold 2.0s so legit chapter/quote FADES (≈0.3-0.8s)
// are ignored — only real DEAD AIR / blank segments are flagged.
const bd = spawnSync(FFMPEG, ["-i", url, "-vf", "fps=4,blackdetect=d=2.0:pix_th=0.10", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 27 });
const blacks = [...((bd.stderr || "").matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g))].map((m) => ({ start: +m[1], end: +m[2], dur: +m[3] }));

const fd = spawnSync(FFMPEG, ["-i", url, "-vf", "fps=4,freezedetect=n=0.003:d=2.5", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 27 });
const freezes = [...((fd.stderr || "").matchAll(/freeze_start:\s*([\d.]+)/g))].map((m) => +m[1]);

// Title-card frame brightness (blank card => near-black).
// signalstats via metadata=print emits "lavfi.signalstats.YAVG=NN" and ".YDIF=NN".
const frameStats = (t) => {
  const r = spawnSync(FFMPEG, ["-ss", String(t), "-i", url, "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" });
  const s = r.stderr || "";
  const y = s.match(/YAVG[=:]\s*([\d.]+)/);
  const d = s.match(/YDIF[=:]\s*([\d.]+)/); // spatial diff ≈ how much detail/text/contrast
  return { yavg: y ? +y[1] : null, ydif: d ? +d[1] : null };
};
// Sample 3 frames across the title-card window (text only shows ~middle of a 5s card).
const tFrames = [introSec * 0.35, introSec * 0.5, introSec * 0.65].map(frameStats).filter((f) => f.yavg != null);
const titleLuma = tFrames.length ? Math.max(...tFrames.map((f) => f.yavg)) : null;
const titleDetail = tFrames.length ? Math.max(...tFrames.map((f) => f.ydif ?? 0)) : null;

const defects = [];
for (const b of blacks) {
  const atEnd = b.end > dur - (tailSec + 2);
  if (b.start < introSec + 1.0) defects.push({ sev: "critical", t: b.start, msg: `dead-air/black at start (${b.dur.toFixed(1)}s) → missing/blank intro` });
  else if (!atEnd) defects.push({ sev: "critical", t: b.start, msg: `dead-air/black mid-video (${b.dur.toFixed(1)}s) → empty insert / dropped segment` });
}
// Blank title card: a real card has bright-ish text + spatial detail; a blank/black
// card is dark AND flat. Flag only when BOTH luma is low AND detail is near-zero.
if (titleLuma != null && titleLuma < 22 && (titleDetail ?? 0) < 3)
  defects.push({ sev: "critical", t: introSec / 2, msg: `title card looks blank (luma ${titleLuma.toFixed(0)}, detail ${(titleDetail ?? 0).toFixed(1)}) → missing title text` });
for (const f of freezes) if (f > introSec + 1 && f < dur - tailSec - 1) defects.push({ sev: "major", t: f, msg: `frozen frames from ${f.toFixed(1)}s` });

const crit = defects.filter((d) => d.sev === "critical").length;
const major = defects.filter((d) => d.sev === "major").length;
console.log(`duration=${dur.toFixed(0)}s  longBlacks(>=2s)=${blacks.length} ${JSON.stringify(blacks)}  freezes=${freezes.length}  titleLuma=${titleLuma} titleDetail=${titleDetail}`);
console.log(`VERDICT: ${crit >= 1 || major >= 2 ? "FAIL" : "PASS"} (critical ${crit}, major ${major})`);
for (const d of defects) console.log(` - [${d.sev}] @${d.t.toFixed(1)}s: ${d.msg}`);
