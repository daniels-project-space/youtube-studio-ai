/**
 * PYDEPS — python-renderer preflight shared by the drawn engines.
 *
 * whiteboardSync + motionComic shell out to python3 (scripts/wb_scribe_sync.py,
 * scripts/whisper_align.py, scripts/mc_page_render.py + mc_textplace.py) which
 * need numpy/Pillow/scikit-image/scipy (+ faster-whisper for alignment). On the
 * VPS those were hand-installed; a fresh Trigger worker ships only python3 +
 * pip3 (trigger.config.ts aptGet) and gets the scripts via additionalFiles.
 * This module makes that machine state EXPLICIT instead of discovered mid-run:
 *
 *  - ensurePyDeps(): marker-guarded one-time `pip3 install` per machine — the
 *    exact pattern proven in audioQa's ensureAudiobox (try
 *    --break-system-packages for PEP-668 images, then plain for older pips).
 *    The marker lives under os.tmpdir(), NOT a hardcoded /tmp, so it also
 *    works on Windows dev machines.
 *  - preflightPythonRenderer(): THROWS with an actionable message when python3
 *    is missing, a required script wasn't baked into the image, or the pip
 *    install fails. Engines call it FIRST so a broken worker fails at $0 spend
 *    instead of after all the paid art + TTS (the render is the LAST step —
 *    without this gate a missing script burned the full art budget first).
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Logger = (msg: string) => void;

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

/**
 * pip3-install `packages` once per machine, guarded by a marker file named
 * `marker` in os.tmpdir(). Returns false (never throws) on failure so callers
 * choose their own severity — preflightPythonRenderer escalates to a throw.
 */
export async function ensurePyDeps(packages: string[], marker: string, log: Logger): Promise<boolean> {
  const markerPath = join(tmpdir(), marker);
  if (existsSync(markerPath)) return true;
  log(`pydeps: installing ${packages.join(", ")} (first use on this machine)…`);
  const r = await sh("pip3", ["install", "--quiet", "--break-system-packages", ...packages], 600_000);
  if (r.code !== 0) {
    // Older pip without --break-system-packages rejects the flag outright.
    const r2 = await sh("pip3", ["install", "--quiet", ...packages], 600_000);
    if (r2.code !== 0) {
      log(`pydeps: pip3 install failed: ${(r2.err || r.err).slice(-300)}`);
      return false;
    }
  }
  await writeFile(markerPath, "ok");
  return true;
}

/**
 * Fail-fast gate for engines that depend on the python renderer stack. Checks,
 * in order: python3 on PATH → every script present relative to process.cwd()
 * (additionalFiles bakes them at the same relative path the engines spawn
 * them with) → pip deps installable. Any failure THROWS so paid generation
 * never starts on a worker that cannot render the result.
 */
export async function preflightPythonRenderer(opts: { scripts: string[]; packages: string[]; marker: string; log: Logger }): Promise<void> {
  const { scripts, packages, marker, log } = opts;
  if ((await sh("python3", ["--version"], 10_000)).code !== 0) {
    throw new Error(
      "python renderer preflight: python3 not found on PATH — bake python3 + python3-pip into the worker image (trigger.config.ts aptGet)",
    );
  }
  const missing = scripts.filter((s) => !existsSync(join(process.cwd(), s)));
  if (missing.length) {
    throw new Error(
      `python renderer preflight: missing script(s) [${missing.join(", ")}] relative to ${process.cwd()} — add them to additionalFiles in trigger.config.ts`,
    );
  }
  if (!(await ensurePyDeps(packages, marker, log))) {
    throw new Error(
      `python renderer preflight: pip3 install failed for [${packages.join(", ")}] — the renderer cannot run on this worker (see log for pip output)`,
    );
  }
}
