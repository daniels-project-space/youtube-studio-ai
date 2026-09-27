import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

type IdleModule = {
  armOpenRelayIdleSchedule(task: string, vmId: string): Promise<string>;
  disarmOpenRelayIdleSchedule(scheduleId: string): Promise<void>;
};

function load(enabled: boolean) {
  const calls: Array<[string, unknown]> = [];
  const source = readFileSync("src/lib/openRelayIdleSchedule.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Partial<IdleModule> };
  const requireFixture = (name: string): unknown => {
    if (name === "@/lib/studioScheduleControl") return { studioSchedulesEnabled: () => enabled };
    if (name === "@trigger.dev/sdk") return { schedules: {
      create: async (options: unknown) => { calls.push(["create", options]); return { id: "schedule-1", active: false }; },
      activate: async (id: string) => { calls.push(["activate", id]); },
      deactivate: async (id: string) => { calls.push(["deactivate", id]); },
    } };
    throw new Error(`unexpected dependency ${name}`);
  };
  new Function("require", "module", "exports", code)(requireFixture, module, module.exports);
  return { calls, module: module.exports as IdleModule };
}

test("a paused fleet cannot arm a GPU idle schedule", async () => {
  const fixture = load(false);
  await assert.rejects(() => fixture.module.armOpenRelayIdleSchedule("openrelay-qwen-idle-reaper", "vm-1"), /paused/);
  assert.deepEqual(fixture.calls, []);
});

test("GPU idle checks use one deduplicated schedule and disarm after stop", async () => {
  const fixture = load(true);
  assert.equal(await fixture.module.armOpenRelayIdleSchedule("openrelay-h3-idle-reaper", "vm-1"), "schedule-1");
  await fixture.module.disarmOpenRelayIdleSchedule("schedule-1");
  assert.deepEqual(fixture.calls, [
    ["create", { task: "openrelay-h3-idle-reaper", cron: "* * * * *", deduplicationKey: "studio:openrelay-h3-idle-reaper:vm-1", externalId: "vm-1" }],
    ["activate", "schedule-1"],
    ["deactivate", "schedule-1"],
  ]);
});
