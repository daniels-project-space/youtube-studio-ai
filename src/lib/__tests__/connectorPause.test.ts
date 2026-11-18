import assert from "node:assert/strict";
import type { Id } from "../../../convex/_generated/dataModel";
import type { StudioConvexHttpClient } from "../studioConvexHttpClient";
import { pauseAfterConnectorChange } from "../connectorPause";

async function run(status: string | null, failWrite = false, ownerId = "owner-a") {
  const client = {
    mutation: async () => { if (failWrite) throw new Error("write uncertain"); return { forked: false, state: "channel_locked" }; },
    query: async () => status === null ? null : { ownerId, status },
  } as unknown as StudioConvexHttpClient;
  return pauseAfterConnectorChange(client, "channel-a" as Id<"channels">, "owner-a");
}
async function main() {
  assert.equal(await run("paused"), true, "an already-paused locked channel is safe to report as paused");
  assert.equal(await run("active"), false, "a rejected pause must not be reported as successful");
  assert.equal(await run("paused", true), true, "readback resolves an uncertain mutation");
  assert.equal(await run(null), false);
  assert.equal(await run("paused", false, "other-owner"), false);
  console.log("Connector pause uses owner-bound readback after success or failure");
}
void main();
