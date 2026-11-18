import type { Doc } from "../../convex/_generated/dataModel";
import { channelScheduleWriteFence } from "@/lib/channelScheduleWriteFence";

type Schedule = NonNullable<Doc<"channels">["schedule"]>;

export function prepareInceptionScheduleUpdate(existing: Schedule | undefined, update: { frequency: string; days?: number[] }) {
  return {
    schedule: { ...existing, frequency: update.frequency, ...(update.days !== undefined ? { days: update.days } : {}) },
    expectedScheduleFence: channelScheduleWriteFence(existing),
  };
}
