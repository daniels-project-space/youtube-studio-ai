import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

async function liveGroup(pid) {
  try { process.kill(-pid, 0); }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
  if (process.platform !== "linux") {
    return true;
  }
  // A killed orphan may remain a zombie until init reaps it. It cannot use
  // CPU or write files, so it must not prevent cleanup indefinitely.
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return true;
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
    }
  }
  return false;
}

/** Own only this test's temp directory and Unix process group. No provider
 * calls, global temp sweep, shared-cache deletion, or coverage selection. */
export async function runReadinessProcess({ command, args, cwd, env = process.env,
  label, timeoutMs, graceMs = 10_000, signal, tempRoot = tmpdir() }) {
  const result = { label, status: null, signal: null, stdout: "", stderr: "",
    spawnError: null, timedOut: false, interrupted: false, timeoutMs };
  let directory;
  try { directory = await mkdtemp(join(tempRoot, "studio-readiness-")); }
  catch (error) { result.spawnError = error; return result; }
  // tsx derives its compiler-cache directory from os.tmpdir(). Keep its
  // existing shared cache warm while isolating each test's disposable files.
  // rm(directory) unlinks this link; it never follows it into the cache.
  if (process.platform !== "win32") {
    const uid = process.geteuid?.();
    const cacheName = `tsx-${uid ?? userInfo().username}`;
    const shared = join(tempRoot, cacheName);
    try {
      await mkdir(shared, { recursive: true, mode: 0o700 });
      const stat = await lstat(shared);
      if (stat.isDirectory() && !stat.isSymbolicLink() && (uid === undefined || stat.uid === uid)) {
        await symlink(shared, join(directory, cacheName), "dir");
      }
    } catch {
      // An unavailable cache may cause cold compilation, never a skipped test.
    }
  }
  const grouped = process.platform !== "win32";
  let child, timer, forceKill, abort, cleanupError;
  function send(name) {
    if (!child?.pid) return;
    try {
      if (grouped) process.kill(-child.pid, name);
      else child.kill(name);
    } catch (error) { if (error.code !== "ESRCH") cleanupError = error.message; }
  }
  try {
    if (signal?.aborted) { result.interrupted = true; return result; }
    await new Promise(resolve => {
      try {
        child = spawn(command, args, { cwd, detached: grouped,
          env: { ...env, TMPDIR: directory, TMP: directory, TEMP: directory },
          stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { result.spawnError = error; resolve(); return; }
      let stopping = false;
      const stop = reason => {
        if (stopping) return;
        stopping = true;
        result.timedOut = reason === "timeout";
        result.interrupted = reason === "abort";
        send("SIGTERM");
        forceKill = setTimeout(() => send("SIGKILL"), graceMs);
        forceKill.unref();
      };
      abort = () => stop("abort");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => stop("timeout"), timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", text => { result.stdout += text; });
      child.stderr?.on("data", text => { result.stderr += text; });
      child.on("error", error => { result.spawnError = error; });
      child.on("close", (status, name) => { result.status = status; result.signal = name; resolve(); });
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(forceKill);
    if (abort) signal?.removeEventListener("abort", abort);
    // Closing the parent is not proof that its children stopped. In
    // particular, clearTimeout(forceKill) used to leave them running.
    send("SIGKILL");
    if (grouped && child?.pid) {
      try {
        const deadline = Date.now() + 2_000;
        while (await liveGroup(child.pid)) {
          if (Date.now() >= deadline) throw Error("Test process group is still active");
          await delay(50);
        }
      } catch (error) { cleanupError = error.message; }
    }
    if (!cleanupError) {
      try { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch (error) { cleanupError = error.message; }
    }
    if (cleanupError) {
      result.cleanupError = `${cleanupError}; retained owned temporary directory: ${directory}`;
    }
  }
  return result;
}
