/** Schedules are opt-in while the channel fleet is paused. The same switch is
 * read when tasks are bundled and when an on-demand GPU schedule is armed. */
export function studioScheduleCron(pattern: string): string | undefined {
  return process.env.STUDIO_SCHEDULES_ENABLED === "true" ? pattern : undefined;
}

export function studioSchedulesEnabled(): boolean {
  return process.env.STUDIO_SCHEDULES_ENABLED === "true";
}
