import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { visionUrls } from "@/lib/vision";

const exec = promisify(execFile);

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    providers: process.env.VISION_PROVIDERS,
  };
  const originalFetch = global.fetch;
  const dir = await mkdtemp(join(tmpdir(), "ysa-vision-remote-test-"));
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.VISION_PROVIDERS = "openrouter";
    const source = join(dir, "source.jpg");
    await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=s=1600x900:r=1:d=1",
      "-frames:v", "1", "-q:v", "2", source,
    ]);
    const original = await readFile(source);
    let prepared: Buffer | undefined;
    global.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://images.test/large.jpg") {
        return new Response(original, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: Array<{ image_url?: { url?: string } }> }> };
      const imageUrl = body.messages?.[0]?.content?.[1]?.image_url?.url ?? "";
      prepared = Buffer.from(imageUrl.split(",")[1] ?? "", "base64");
      return Response.json({
        id: "remote-preparation-test",
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    };

    await visionUrls({
      prompt: `vision-remote-preparation-${Date.now()}-${Math.random()}`,
      imageUrls: ["https://images.test/large.jpg"],
      json: true,
      noCache: true,
    });
    assert.ok(prepared && prepared.length > 0, "the remote frame reaches the provider as an image");
    const preparedPath = join(dir, "prepared.jpg");
    await writeFile(preparedPath, prepared);
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", preparedPath,
    ]);
    const [width, height] = stdout.trim().split(",").map(Number);
    assert.ok(width <= 768 && height <= 768, `remote frames are downscaled before review (got ${width}x${height})`);
    assert.ok(prepared.length < original.length, "downscaling reduces the review payload for a large remote frame");
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.providers === undefined) delete process.env.VISION_PROVIDERS;
    else process.env.VISION_PROVIDERS = saved.providers;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log("VISION REMOTE PREPARATION PASS — remote frames honor the local 768px review envelope");
}

void main();
