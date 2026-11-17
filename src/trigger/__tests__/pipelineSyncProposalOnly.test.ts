import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const oldUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.invalid";
const calls: Array<{ ownerId: string; dryRun: boolean }> = [];
loader._load = function (id, ...args) {
  if (id === "@trigger.dev/sdk") return { task: (definition: unknown) => definition };
  if (id === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: class {} };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
  if (id === "@/lib/goldenChannelSync") return {
    syncChannelPipelines: async (options: { ownerId: string; dryRun: boolean }) => {
      calls.push(options);
      return { changed: 1, applied: 0 };
    },
  };
  return originalLoad.call(this, id, ...args);
};

async function main() {
  // Install boundary mocks before loading the task.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { syncChannelPipelinesTask } = require("../syncChannelPipelines") as {
    syncChannelPipelinesTask: { run: (payload: { ownerId: string; dryRun?: boolean }) => Promise<unknown> };
  };
  for (const dryRun of [undefined, false, true]) {
    await syncChannelPipelinesTask.run({ ownerId: "owner", dryRun });
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.ownerId === "owner" && call.dryRun === true));
  console.log("PIPELINE SYNC PROPOSAL PASS: legacy fleet task never applies changes");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = oldUrl;
});
