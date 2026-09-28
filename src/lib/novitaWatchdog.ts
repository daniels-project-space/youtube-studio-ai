import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

const WATCHDOG_INTERVAL_MS = 60_000;

/** Arm before provider create; repeated callers share one delayed minute slot. */
export async function armNovita4090Watchdog(): Promise<void> {
  const nextCheckAt = Math.ceil((Date.now() + WATCHDOG_INTERVAL_MS) / WATCHDOG_INTERVAL_MS) * WATCHDOG_INTERVAL_MS;
  const idempotencyKey = await idempotencyKeys.create(`novita-4090-watchdog:${nextCheckAt}`, { scope: "global" });
  await tasks.trigger("novita-4090-reaper", {}, {
    delay: new Date(nextCheckAt),
    idempotencyKey,
  });
}
