import { channelScheduleWriteFence } from "./channelScheduleWriteFence";

type Schedule = { frequency?: string; days?: number[]; [key: string]: unknown };
export type AdvancedScheduleDraft = { schedule: Schedule | undefined; cadence: string; days: number[] };

export function advancedScheduleWrite(draft: AdvancedScheduleDraft, cadence: string, days: number[]) {
  if (cadence === draft.cadence && JSON.stringify(days) === JSON.stringify(draft.days)) return null;
  return {
    expectedScheduleFence: channelScheduleWriteFence(draft.schedule),
    schedule: { ...draft.schedule, frequency: cadence, days },
  };
}
