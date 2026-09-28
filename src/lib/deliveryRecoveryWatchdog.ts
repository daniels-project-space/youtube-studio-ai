import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { studioSchedulesEnabled } from "@/lib/studioScheduleControl";

const INTERVAL_MS = 10 * 60_000;

/** One delayed recovery check per active owner and time slot. */
export async function armDeliveryRecoveryWatchdog(ownerId: string): Promise<void> {
  if (!studioSchedulesEnabled()) return;
  const nextCheckAt = Math.ceil((Date.now() + INTERVAL_MS) / INTERVAL_MS) * INTERVAL_MS;
  const idempotencyKey = await idempotencyKeys.create(
    `shared-delivery-recovery:${ownerId}:${nextCheckAt}`,
    { scope: "global" },
  );
  await tasks.trigger("shared-delivery-recovery", { ownerId }, {
    delay: new Date(nextCheckAt),
    idempotencyKey,
  });
}
