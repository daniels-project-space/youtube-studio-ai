/** YouTube Automation's weekly producer may not dispatch a non-Qwen voice. */
export function assertAutomationWeeklyProvider(provider: string): void {
  if (provider !== "qwen3") throw new Error("YouTube Automation weekly narration requires Qwen3; update the selected provider before preparing audio");
}
