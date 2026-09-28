import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { studioScheduleCron } from "@/lib/studioScheduleControl";

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
