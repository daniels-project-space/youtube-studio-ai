/** Wake only the owner-approved benchmark request, without scheduling a fleet scan. */
export async function requestRouteQualificationDispatch(input: { channelId: string; runId: string }): Promise<string> {
  if (!process.env.TRIGGER_SECRET_KEY) throw new Error("Job service is not configured");
  const { tasks } = await import("@trigger.dev/sdk");
  const dispatched = await tasks.trigger("route-qualification-benchmark-dispatcher", input);
  return dispatched.id;
}
