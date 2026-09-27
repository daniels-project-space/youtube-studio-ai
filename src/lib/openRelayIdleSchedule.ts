import { schedules } from "@trigger.dev/sdk";
import { studioSchedulesEnabled } from "@/lib/studioScheduleControl";

/** Arm a minute-resolution idle guard only while its VM is being used. */
export async function armOpenRelayIdleSchedule(
  task: "openrelay-h3-idle-reaper" | "openrelay-qwen-idle-reaper",
  vmId: string,
): Promise<string> {
  if (!studioSchedulesEnabled()) throw new Error("Studio schedules are paused");
  const schedule = await schedules.create({
    task,
    cron: "* * * * *",
    deduplicationKey: `studio:${task}:${vmId}`,
    externalId: vmId,
  });
  if (!schedule.active) await schedules.activate(schedule.id);
  return schedule.id;
}

export async function disarmOpenRelayIdleSchedule(scheduleId: string | undefined): Promise<void> {
  if (scheduleId) await schedules.deactivate(scheduleId);
}
