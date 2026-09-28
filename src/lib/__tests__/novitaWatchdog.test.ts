import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

test("Novita worker arms one delayed cleanup before the provider create boundary", async () => {
  const source = readFileSync("src/lib/novitaDirectRender.ts", "utf8");
  const arm = source.indexOf("await armNovita4090Watchdog();", source.indexOf("async function startWorker"));
  const create = source.indexOf("instanceId = await recoverOrCreateInstance({", arm);
  assert.ok(arm >= 0 && create > arm, "a crash after provider create must leave a watchdog behind");

  const compiled = ts.transpileModule(readFileSync("src/lib/novitaWatchdog.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const calls: Array<{ task: string; delay: Date; idempotencyKey: string }> = [];
  const loaded = { exports: {} as { armNovita4090Watchdog?: () => Promise<void> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.equal(name, "@trigger.dev/sdk");
    return {
      idempotencyKeys: { create: async (seed: string, options: unknown) => {
        assert.deepEqual(options, { scope: "global" });
        return seed;
      } },
      tasks: { trigger: async (task: string, _payload: unknown, options: { delay: Date; idempotencyKey: string }) => {
        calls.push({ task, ...options });
      } },
    };
  }, loaded, loaded.exports);
  await loaded.exports.armNovita4090Watchdog!();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, "novita-4090-reaper");
  assert.ok(calls[0].delay.getTime() > Date.now());
  assert.match(calls[0].idempotencyKey, /^novita-4090-watchdog:\d+$/);
  assert.equal(calls[0].delay.getTime(), Number(calls[0].idempotencyKey.split(":")[1]));
});
