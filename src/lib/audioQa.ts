/**
 * AUDIO QA — the ear the pipeline never had (QA was vision-only).
 *
 * Meta's audiobox-aesthetics scores audio with no reference on four axes:
 *   PQ production quality, PC production complexity,
 *   CE content enjoyment,  CU content usefulness   (each ~1-10).
 *
 * We sample three 30s windows from the final video's audio (start/mid/late),
 * score each, and average. ADVISORY by default — scores land in the QA report
 * and the log; gating decisions stay with the operator/architect (param).
 *
 * Cost note: the model checkpoint (~600MB) downloads once per machine, and
 * pip installs on first use — so this is OPT-IN per channel (param audioQa;
 * music channels default on: audio IS their product).
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

type Logger = (msg: string) => void;

export interface AudioScores {
  productionQuality: number;
  complexity: number;
  enjoyment: number;
  usefulness: number;
}

function sh(cmd: string, args: string[], timeoutMs = 600_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); resolve({ code: -1, out, err: err + " [timeout]" }); }, timeoutMs);
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", () => { clearTimeout(t); resolve({ code: -1, out, err }); });
    c.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
  });
}

/** pip-install audiobox-aesthetics once per machine (marker-guarded). */
async function ensureAudiobox(log: Logger): Promise<boolean> {
  const marker = "/tmp/.audiobox_ready";
  if (existsSync(marker)) return true;
  log("audioQa: installing audiobox-aesthetics (first use on this machine)…");
  const r = await sh("pip3", ["install", "--quiet", "--break-system-packages", "audiobox_aesthetics"], 480_000);
  if (r.code !== 0) {
    // older pip without --break-system-packages
    const r2 = await sh("pip3", ["install", "--quiet", "audiobox_aesthetics"], 480_000);
    if (r2.code !== 0) {
      log(`audioQa: pip install failed (skipping audio scoring): ${(r2.err || r.err).slice(-200)}`);
      return false;
    }
  }
  await writeFile(marker, "ok");
  return true;
}

/**
 * Score the audio of a video/audio file. Returns null when unavailable
 * (no python, install failed, model failure) — callers treat as "not judged".
 */
export async function scoreAudio(
  mediaPath: string,
  tmpDir: string,
  durationSec: number,
  log: Logger = () => {},
): Promise<AudioScores | null> {
  try {
    if ((await sh("python3", ["--version"], 10_000)).code !== 0) {
      log("audioQa: python3 not available — skipping");
      return null;
    }
    if (!(await ensureAudiobox(log))) return null;

    // Three 30s windows: post-intro, midpoint, late (skip the outro fade).
    const starts = [
      Math.min(20, Math.max(0, durationSec * 0.1)),
      Math.max(0, durationSec * 0.5),
      Math.max(0, durationSec * 0.85 - 30),
    ];
    const wavs: string[] = [];
    for (let i = 0; i < starts.length; i++) {
      const wav = join(tmpDir, `aqa_${i}.wav`);
      const r = await sh("ffmpeg", [
        "-y", "-ss", starts[i].toFixed(2), "-t", "30", "-i", mediaPath,
        "-vn", "-ac", "2", "-ar", "44100", wav,
      ], 120_000);
      if (r.code === 0 && existsSync(wav)) wavs.push(wav);
    }
    if (!wavs.length) return null;

    const jsonl = join(tmpDir, "aqa_in.jsonl");
    await writeFile(jsonl, wavs.map((w) => JSON.stringify({ path: w })).join("\n"));
    const run = await sh("audio-aes", [jsonl, "--batch-size", String(wavs.length)], 600_000);
    if (run.code !== 0) {
      log(`audioQa: scorer failed (skipping): ${run.err.slice(-180)}`);
      return null;
    }
    // One JSON per line: {"CE":x,"CU":x,"PC":x,"PQ":x}
    const rows = run.out.trim().split("\n")
      .map((l) => { try { return JSON.parse(l) as Record<string, number>; } catch { return null; } })
      .filter((r): r is Record<string, number> => Boolean(r));
    if (!rows.length) return null;
    const avg = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rows.length;
    const scores: AudioScores = {
      productionQuality: Math.round(avg("PQ") * 10) / 10,
      complexity: Math.round(avg("PC") * 10) / 10,
      enjoyment: Math.round(avg("CE") * 10) / 10,
      usefulness: Math.round(avg("CU") * 10) / 10,
    };
    log(`audioQa: PQ ${scores.productionQuality} | enjoyment ${scores.enjoyment} | complexity ${scores.complexity} | usefulness ${scores.usefulness} (avg of ${rows.length} windows)`);
    return scores;
  } catch (e) {
    log(`audioQa: error (skipping): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
