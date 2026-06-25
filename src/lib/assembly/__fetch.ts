/**
 * Source resolver for the ffmpeg RenderBackend.
 *
 * Timeline `src`/`bgSrc`/`musicSrc`/`narrationSrc` fields are opaque strings that
 * may be any of three flavours (per planTimeline's PlanInput doc: "local path /
 * R2 key / url"):
 *   - http(s) URL        → streamed to a local file via files.downloadTo
 *   - existing local path → passed through unchanged (no copy)
 *   - otherwise (R2 key)  → fetched from R2 via storage.getObjectBytes → writeBytes
 *
 * Fetches are content-addressed into `tmpDir` (sha1 of the src) so the SAME src
 * resolves to the SAME local file once — repeated clips/cards don't re-download.
 * An in-flight map makes concurrent resolves of the same src share one fetch
 * (concurrency-safe), and a small semaphore bounds parallelism.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { downloadTo, writeBytes } from "@/lib/files";
import { getObjectBytes } from "@/lib/storage";

const isHttp = (s: string) => /^https?:\/\//i.test(s);

/** Local-path heuristic: absolute path or ./ / ../ relative, AND it exists on disk. */
function isLocalPath(s: string): boolean {
  if (isHttp(s)) return false;
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return existsSync(s);
  // bare names that happen to exist locally (e.g. test fixtures) are treated as local
  return existsSync(s);
}

/** Stable local filename for a src inside tmpDir (preserves extension when present). */
function localNameFor(src: string, tmpDir: string): string {
  const h = createHash("sha1").update(src).digest("hex").slice(0, 16);
  let ext = "";
  try {
    const base = isHttp(src) ? new URL(src).pathname : src;
    ext = extname(base);
  } catch {
    ext = extname(src);
  }
  if (!/^\.[a-zA-Z0-9]{1,5}$/.test(ext)) ext = ".bin";
  return join(tmpDir, `src_${h}${ext}`);
}

/** Bounded-concurrency fetch resolver. One instance per render run. */
export class SourceResolver {
  private inflight = new Map<string, Promise<string>>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly tmpDir: string,
    private readonly maxConcurrent = 4,
  ) {}

  /** Resolve any src flavour to a readable LOCAL file path. Idempotent per src. */
  async resolve(src: string): Promise<string> {
    if (!src) throw new Error("SourceResolver.resolve: empty src");
    if (isLocalPath(src)) return src; // passthrough — never copy a file we already have locally
    const cached = this.inflight.get(src);
    if (cached) return cached;
    const p = this.acquire().then(async () => {
      try {
        const dest = localNameFor(src, this.tmpDir);
        if (existsSync(dest)) return dest; // already fetched this run
        if (isHttp(src)) {
          await downloadTo(src, dest);
        } else {
          const bytes = await getObjectBytes(src); // treat as R2 key
          await writeBytes(dest, bytes);
        }
        return dest;
      } finally {
        this.release();
      }
    });
    this.inflight.set(src, p);
    return p;
  }

  /** Resolve many srcs preserving order. */
  async resolveAll(srcs: string[]): Promise<string[]> {
    return Promise.all(srcs.map((s) => this.resolve(s)));
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.queue.push(res)).then(() => {
      this.active++;
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
