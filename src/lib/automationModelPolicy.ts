/** Daniel has excluded Nano Banana Pro from the private Automation project. */
export function assertAutomationModelAllowed(model: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env.YOUTUBE_AUTOMATION_PRIVATE !== "1") return;
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini-3-pro-image") || normalized.includes("nano-banana-pro")) {
    throw new Error("Nano Banana Pro is disabled for private YouTube Automation");
  }
}

export function assertAutomationNarrationProviderAllowed(provider: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env.YOUTUBE_AUTOMATION_PRIVATE === "1" && provider !== "qwen3") {
    throw new Error("Private Automation requires an explicitly selected Qwen narration voice");
  }
}
