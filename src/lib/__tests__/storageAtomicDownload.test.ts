import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { mock, test } from "node:test";
import { getObjectToFile, getR2Client } from "../storage";

test("streamed downloads expose only complete bytes and preserve previous files on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "r2-download-contract-"));
  const target = join(directory, "master.mp4");
  const names = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { R2_ENDPOINT: "https://fixture.invalid", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture" });
  const client = getR2Client();
  let body = Readable.from([]), length: number | undefined;
  let responseFailure: Error | undefined;
  let emptyBody = false;
  let requests = 0;
  const send = mock.method(client, "send", async (command: { input: Record<string, unknown> }) => {
    requests++;
    assert.equal(command.input.Bucket, "fixture-private");
    assert.equal(command.input.Key, "owner/run/master.mp4");
    if (responseFailure) throw responseFailure;
    return { Body: emptyBody ? undefined : body, ContentLength: length };
  });
  const download = () => getObjectToFile("owner/run/master.mp4", target, "fixture-private");
  const original = Buffer.from("previous-complete-master");
  const restoredDirectories: string[] = [];
  const clean = async () => assert.deepEqual(await readdir(directory), ["master.mp4"], "owned temporary data is removed");
  try {
    await writeFile(target, original);
    const failure = new Error("interrupted provider stream");
    body = Readable.from((async function* () { yield Buffer.from("partial"); throw failure; })());
    length = 99;
    await assert.rejects(download(), error => error === failure);
    assert.deepEqual(await readFile(target), original, "failed transfer must not overwrite a complete file");
    assert.equal(body.destroyed, true);
    await clean();

    for (const claimed of [2, 20, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      body = Readable.from([Buffer.from("short")]); length = claimed;
      await assert.rejects(download(), /byte length|ContentLength/);
      assert.deepEqual(await readFile(target), original);
      assert.equal(body.destroyed, true);
      await clean();
    }

    let continueTransfer!: () => void;
    const paused = new Promise<void>(resolve => { continueTransfer = resolve; });
    let reachedPause!: () => void;
    const ready = new Promise<void>(resolve => { reachedPause = resolve; });
    body = Readable.from((async function* () {
      yield Buffer.from("first-"); reachedPause(); await paused; yield Buffer.from("last");
    })()); length = 10;
    const pending = download();
    await ready;
    try { assert.deepEqual(await readFile(target), original, "in-flight transfer cannot expose partial bytes"); }
    finally { continueTransfer(); }
    assert.equal(await pending, target);
    assert.equal(await readFile(target, "utf8"), "first-last"); await clean();

    await rm(target);
    body = Readable.from([Buffer.from("truncated")]); length = 100;
    await assert.rejects(download(), /byte length/);
    assert.deepEqual(await readdir(directory), [], "failed new download leaves no destination or partial file");
    body = Readable.from([Buffer.from("no-header")]); length = undefined;
    await download(); assert.equal(await readFile(target, "utf8"), "no-header"); await clean();
    body = Readable.from([]); length = 0;
    await download(); assert.equal((await readFile(target)).length, 0); await clean();

    let failTransfer!: () => void;
    const failGate = new Promise<void>(resolve => { failTransfer = resolve; });
    let failedTransferStarted!: () => void;
    const failStarted = new Promise<void>(resolve => { failedTransferStarted = resolve; });
    body = Readable.from((async function* () {
      failedTransferStarted(); yield Buffer.from("bad"); await failGate; throw failure;
    })());
    length = 10;
    const failedConcurrent = assert.rejects(download(), error => error === failure);
    await failStarted;
    body = Readable.from([Buffer.from("concurrent-good")]); length = 15;
    try { await download(); } finally { failTransfer(); }
    await failedConcurrent;
    assert.equal(await readFile(target, "utf8"), "concurrent-good"); await clean();

    await rm(target); await mkdir(target);
    body = Readable.from([Buffer.from("not-a-directory")]); length = 15;
    await assert.rejects(download(), /EISDIR|EPERM|EEXIST/);
    assert.deepEqual(await readdir(target), []); await clean();
    await rm(target, { recursive: true });

    const { rehydrateOutputsWithStorage } = await import("../rehydrate");
    const patch = { videoKey: "owner/run/master.mp4", videoLocalPath: join(directory, "missing.mp4") };
    const storage = {
      async getObjectToFile(key: string, path: string) {
        restoredDirectories.push(dirname(path));
        return getObjectToFile(key, path, "fixture-private");
      },
      async headObjectMetadata() { throw new Error("demanded recovery must not add a HEAD"); },
    };
    const restore = () => rehydrateOutputsWithStorage("assemble", { ...patch }, "atomic-download-fixture",
      { neededOutputKeys: new Set(["videoLocalPath"]) }, storage);
    body = Readable.from([Buffer.from("incomplete")]); length = 100;
    await assert.rejects(restore(), /byte length/, "actual recovery must throw, not return a reusable or regeneratable artifact");
    assert.deepEqual(await readdir(restoredDirectories.at(-1)!), []);
    body = Readable.from([Buffer.from("restored-master")]); length = 15;
    const restored = await restore();
    assert.equal(restored.ok, true);
    assert.equal(await readFile(restored.outputs.videoLocalPath as string, "utf8"), "restored-master");
    responseFailure = failure;
    await assert.rejects(download(), error => error === failure);
    assert.deepEqual(await readdir(directory), [], "a rejected GET also cleans up its owned directory");
    responseFailure = undefined; emptyBody = true;
    await assert.rejects(download(), /no body/);
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(getObjectToFile("owner/run/master.mp4", join(directory, "absent-parent", "master.mp4"), "fixture-private"), /ENOENT/);
    assert.equal(requests, 17, "one GET per transfer attempt; disk setup failure starts none; no HEAD or whole-transfer retry");
  } finally {
    send.mock.restore(); client.destroy();
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    await rm(directory, { recursive: true, force: true });
    for (const path of restoredDirectories) await rm(path, { recursive: true, force: true });
  }
});
