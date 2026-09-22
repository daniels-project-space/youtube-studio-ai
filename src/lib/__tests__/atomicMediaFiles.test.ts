import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadTo, writeBytes } from "../files";
import { SourceResolver } from "../assembly/__fetch";

async function fixture(run: (context: {
  dir: string; url: string; healthy: () => void; requests: () => number;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ysa-atomic-test-"));
  let healthy = false, requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (healthy) { response.end("complete-media"); return; }
    response.writeHead(200, { "Content-Length": 100_000 });
    response.write("partial-media");
    setTimeout(() => response.destroy(), 30);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run({ dir, url: `http://127.0.0.1:${address.port}/source.wav`,
      healthy: () => { healthy = true; }, requests: () => requests });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

test("interrupted HTTP body never publishes a partial destination", async () => {
  await fixture(async ({ dir, url, healthy, requests }) => {
    const dest = join(dir, "media.wav");
    await assert.rejects(downloadTo(url, dest));
    assert.equal(existsSync(dest), false);
    assert.deepEqual(await readdir(dir), [], "failed staging must be cleaned up");
    assert.equal(requests(), 1, "no automatic network retry");
    healthy();
    assert.equal(await downloadTo(url, dest), dest);
    assert.equal(await readFile(dest, "utf8"), "complete-media");
    assert.deepEqual(await readdir(dir), ["media.wav"]);
  });
});

test("failed replacement preserves the existing complete file", async () => {
  await fixture(async ({ dir, url, healthy }) => {
    const dest = join(dir, "media.wav");
    await writeFile(dest, "previous-complete-media");
    await assert.rejects(downloadTo(url, dest));
    assert.equal(await readFile(dest, "utf8"), "previous-complete-media");
    healthy();
    await downloadTo(url, dest);
    assert.equal(await readFile(dest, "utf8"), "complete-media");
    assert.deepEqual(await readdir(dir), ["media.wav"]);
  });
});

test("resolver coalesces failures but allows explicit recovery and successful reuse", async () => {
  await fixture(async ({ dir, url, healthy, requests }) => {
    const resolver = new SourceResolver(dir, 1);
    const results = await Promise.allSettled([resolver.resolve(url), resolver.resolve(url)]);
    assert.ok(results.every(result => result.status === "rejected"));
    assert.equal(requests(), 1);
    healthy();
    const [first, second] = await resolver.resolveAll([url, url]);
    assert.equal(first, second);
    assert.equal(await readFile(first, "utf8"), "complete-media");
    assert.equal(await resolver.resolve(url), first);
    assert.equal(await new SourceResolver(dir).resolve(url), first);
    assert.equal(requests(), 2, "successful cache survives a new resolver without another download");
    assert.equal(await resolver.resolve(first), first, "local files remain passthrough");
    assert.deepEqual(await readdir(dir), [first.slice(dir.length + 1)]);
  });
});

test("buffered writes publish complete bytes and clean up failed rename", async () => {
  await fixture(async ({ dir }) => {
    const dest = join(dir, "media.bin");
    const a = Buffer.alloc(512 * 1024, 11), b = Buffer.alloc(512 * 1024, 22);
    await Promise.all([writeBytes(dest, a), writeBytes(dest, b)]);
    const result = await readFile(dest);
    assert.ok(result.equals(a) || result.equals(b), "concurrent writes cannot interleave bytes");
    const occupied = join(dir, "occupied");
    await mkdir(occupied);
    await writeFile(join(occupied, "keep"), "untouched");
    await assert.rejects(writeBytes(occupied, a));
    assert.equal(await readFile(join(occupied, "keep"), "utf8"), "untouched");
    assert.deepEqual((await readdir(dir)).sort(), ["media.bin", "occupied"]);
  });
});
