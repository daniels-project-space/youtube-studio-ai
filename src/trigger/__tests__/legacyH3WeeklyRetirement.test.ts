import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { AbortTaskRunError } from "@trigger.dev/sdk";

type Definition = {
  id: string;
  maxDuration: number;
  retry: { maxAttempts: number };
  queue: { concurrencyLimit: number };
  run: (payload: unknown) => Promise<unknown>;
};

async function main() {
  let externalCalls = 0;
  const definitions: Definition[] = [];
  const cached = new Map<string, Record<string, unknown>>();
  const load = (filename: string): Record<string, unknown> => {
    const prior = cached.get(filename);
    if (prior) return prior;
    const source = readFileSync(resolve(process.cwd(), "src/trigger", filename), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const fixtureModule = { exports: {} as Record<string, unknown> };
    const requireFixture = (name: string): unknown => {
      if (name === "@trigger.dev/sdk") return {
        AbortTaskRunError,
        task: (definition: Definition) => { definitions.push(definition); return definition; },
      };
      if (name === "./legacyH3WeeklyRetirement") return load("legacyH3WeeklyRetirement.ts");
      return new Proxy({}, { get: () => () => {
        externalCalls++;
        throw new Error("external work forbidden in a retired task");
      } });
    };
    new Function("require", "module", "exports", compiled)(requireFixture, fixtureModule, fixtureModule.exports);
    cached.set(filename, fixtureModule.exports);
    return fixtureModule.exports;
  };

  const expected = [
    ["minimaxH3WeeklyBatch.ts", "minimax-h3-weekly-batch", 3600],
    ["minimaxH3WeeklyCapacityRetry.ts", "minimax-h3-weekly-capacity-retry", 120],
    ["minimaxH3WeeklyNovitaFallback.ts", "minimax-h3-weekly-novita-fallback", 3600],
    ["minimaxH3WeeklyOpenRelayFallback.ts", "minimax-h3-weekly-openrelay-fallback", 3600],
  ] as const;
  for (const [file, id, maxDuration] of expected) {
    load(file);
    const definition = definitions.find(item => item.id === id);
    assert.ok(definition, `${file} preserves its historical task identity`);
    assert.equal(definition.maxDuration, maxDuration);
    assert.equal(definition.retry.maxAttempts, 1);
    assert.equal(definition.queue.concurrencyLimit, 1);
    const untouchedPayload = new Proxy({}, { get: () => {
      throw new Error("retirement must precede payload access");
    } });
    for (const payload of [untouchedPayload, null, { ownerId: "owner", jobs: [] }]) {
      await assert.rejects(() => definition.run(payload), error => {
        assert.ok(error instanceof AbortTaskRunError);
        assert.equal(error.message,
          "Studio weekly H3 provider route is retired; stage the request through Render Engine.");
        return true;
      });
    }
    assert.equal(externalCalls, 0, "no credentials, dispatch, provider, storage or budget work");
  }
  console.log("Four actual legacy weekly entrypoints abort before all payload and external work");
}

void main();
