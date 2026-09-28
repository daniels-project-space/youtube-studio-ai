import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { studioRetentionMaintenanceCron, studioScheduleCron } from "@/lib/studioScheduleControl";

test("the paused fleet registers no declarative Trigger schedules", () => {
  const previous = process.env.STUDIO_SCHEDULES_ENABLED;
  try {
    delete process.env.STUDIO_SCHEDULES_ENABLED;
    assert.equal(studioScheduleCron("* * * * *"), undefined);
    process.env.STUDIO_SCHEDULES_ENABLED = "false";
    assert.equal(studioScheduleCron("* * * * *"), undefined);
    process.env.STUDIO_SCHEDULES_ENABLED = "true";
    assert.equal(studioScheduleCron("*/30 * * * *"), "*/30 * * * *");
  } finally {
    if (previous === undefined) delete process.env.STUDIO_SCHEDULES_ENABLED;
    else process.env.STUDIO_SCHEDULES_ENABLED = previous;
  }
});

test("retention maintenance has an independent fail-closed schedule switch", () => {
  const previousGlobal = process.env.STUDIO_SCHEDULES_ENABLED;
  const previousMaintenance = process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
  try {
    delete process.env.STUDIO_SCHEDULES_ENABLED;
    delete process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
    assert.equal(studioScheduleCron("0 * * * *"), undefined);
    assert.equal(studioRetentionMaintenanceCron("17 3 * * *"), undefined);

    process.env.STUDIO_SCHEDULES_ENABLED = "true";
    assert.equal(studioRetentionMaintenanceCron("17 3 * * *"), undefined,
      "enabling the render schedule fleet must not enable retention maintenance");

    delete process.env.STUDIO_SCHEDULES_ENABLED;
    process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = "true";
    assert.equal(studioScheduleCron("0 * * * *"), undefined,
      "enabling retention maintenance must not enable render schedules");
    assert.equal(studioRetentionMaintenanceCron("17 3 * * *"), "17 3 * * *");

    const config = readFileSync("trigger.config.ts", "utf8");
    assert.match(config, /FORWARDED_ENV = \[([\s\S]*?)"STUDIO_RETENTION_MAINTENANCE_ENABLED"/,
      "Trigger deployment must explicitly forward the independent opt-in");
    const secretForwarding = /SECRET_FORWARDED_ENV = new Set\(\[([\s\S]*?)\]\)/.exec(config)?.[1] ?? "";
    assert.doesNotMatch(secretForwarding, /STUDIO_RETENTION_MAINTENANCE_ENABLED/,
      "the boolean schedule opt-in is not a secret");
  } finally {
    if (previousGlobal === undefined) delete process.env.STUDIO_SCHEDULES_ENABLED;
    else process.env.STUDIO_SCHEDULES_ENABLED = previousGlobal;
    if (previousMaintenance === undefined) delete process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
    else process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = previousMaintenance;
  }
});

test("an enabled idle fleet stays below five percent of the former 7,806 daily runs", () => {
  let worstDay = 0;
  for (const file of readdirSync("src/trigger").filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(`src/trigger/${file}`, "utf8");
    for (const line of source.split("\n")) {
      const cron = /cron: studioScheduleCron\("([^"]+)"\)/.exec(line)?.[1];
      if (!cron || line.includes('deliveryRecoveryMode() === "individual"')) continue;
      const [minute, hour, , , weekday] = cron.split(" ");
      const perHour = minute === "*" ? 60 : minute?.startsWith("*/") ? 60 / Number(minute.slice(2)) : 1;
      const hours = hour === "*" ? 24 : hour?.startsWith("*/") ? 24 / Number(hour.slice(2)) : 1;
      const runs = perHour * hours;
      assert.ok(Number.isFinite(runs) && runs > 0, `unaccounted schedule ${file}: ${cron}`);
      // Count every weekly task in the same day for a conservative peak.
      worstDay += weekday === "*" || weekday === "1" ? runs : 0;
    }
  }
  assert.ok(worstDay <= Math.floor(7_806 * 0.05), `idle schedules would run ${worstDay} times in the busiest day`);
});
