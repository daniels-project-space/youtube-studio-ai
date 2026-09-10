import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { visionLocal } from "@/lib/vision";

const exec = promisify(execFile);

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    providers: process.env.VISION_PROVIDERS,
  };
  const originalFetch = global.fetch;
  const dir = await mkdtemp(join(tmpdir(), "ysa-vision-local-cache-test-"));
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.VISION_PROVIDERS = "openrouter";
    const source = join(dir, "frame.jpg");
    await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=s=1600x900:r=1:d=1",
      "-frames:v", "1", "-q:v", "2", source,
    ]);
    const sourceBytes = await readFile(source);
    const contentKey = createHash("sha1").update(sourceBytes).digest("hex").slice(0, 16);
    const cachePath = join(tmpdir(), "ysa-vision-cache", `prep-${contentKey}-768.jpg`);
    await unlink(cachePath).catch(() => {});
    let providerPosts = 0;
    global.fetch = async (input, init) => {
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      assert.ok(init?.signal);
      providerPosts += 1;
      return Response.json({
        id: `local-cache-${providerPosts}`,
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    };

    await visionLocal({ prompt: `vision-local-cache-first-${Date.now()}`, imagePaths: [source], json: true, noCache: true });
    const before = await stat(cachePath, { bigint: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await visionLocal({ prompt: `vision-local-cache-second-${Date.now()}`, imagePaths: [source], json: true, noCache: true });
    const after = await stat(cachePath, { bigint: true });
    assert.equal(after.mtimeNs, before.mtimeNs, "the second review reuses the content-addressed prepared frame");
    assert.equal(providerPosts, 2, "noCache only bypasses verdict reuse; both deliberate reviews still run");
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.providers === undefined) delete process.env.VISION_PROVIDERS;
    else process.env.VISION_PROVIDERS = saved.providers;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log("VISION LOCAL PREPARATION CACHE PASS — repeated frame reviews reuse content-addressed JPEGs");
}

void main();
