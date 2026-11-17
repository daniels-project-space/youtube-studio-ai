import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const oldUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.invalid";
let writes = 0;
const proposed = [{ block: "script_gen", params: { tone: "calm" } }];
class Convex {
  async query(ref: Parameters<typeof getFunctionName>[0]) {
    if (getFunctionName(ref) === "channels:getChannel") return {
      ownerId: "owner", name: "Channel", identity: {}, styleDNA: {}, pipeline: [{ block: "old" }],
    };
    throw new Error("unexpected query");
  }
  async mutation() { writes++; throw new Error("active channel must not be changed"); }
}
loader._load = function (id, ...args) {
  if (id === "@trigger.dev/sdk") return { task: (definition: unknown) => definition };
  if (id === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Convex };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
  if (id === "@/engine/creative/architect") return { architectPipeline: async () => ({ pipeline: proposed, report: { applied: [] } }) };
  return originalLoad.call(this, id, ...args);
};

async function main() {
  // Install boundary mocks before loading the task.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { architectPipelineTask } = require("../architectPipelineTask") as {
    architectPipelineTask: { run: (payload: { channelId: string; dryRun?: boolean }) => Promise<{ dryRun: boolean; pipeline: unknown }> };
  };
  for (const dryRun of [undefined, false, true]) {
    const result = await architectPipelineTask.run({ channelId: "channel", dryRun });
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.pipeline, proposed);
    assert.equal(writes, 0, "a proposal cannot write an active channel");
  }
  console.log("ARCHITECT PROPOSAL PASS: legacy task inputs never apply a channel pipeline");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = oldUrl;
});
