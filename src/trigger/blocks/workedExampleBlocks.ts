import type { Block } from "@/engine/types";
import { prepareWorkedExample, WorkedExampleRequestSchema } from "@/engine/workedExample";

/** Held preparation port only. No script/narration/approval outputs or provider path. */
export const workedExamplePrepare: Block = {
  id: "worked_example_prepare",
  consumes: ["workedExampleRequest"],
  produces: ["workedExamplePreparation"],
  resumePolicy: "recompute_unpaid_deterministic",
  run: async (ctx) => {
    if (Object.keys(ctx.params).length) throw new Error("worked_example_prepare: configuration belongs in the typed request");
    const request = WorkedExampleRequestSchema.parse(ctx.store["workedExampleRequest"]);
    if (request.ownerId !== ctx.ownerId || request.channelId !== ctx.channelId || request.runId !== ctx.runId) {
      throw new Error("worked_example_prepare: request namespace does not match the active caller");
    }
    const workedExamplePreparation = prepareWorkedExample(request);
    ctx.log(`worked_example_prepare: verified ${workedExamplePreparation.derivation.steps.length} integer steps; preparation only, no provider calls`);
    return { workedExamplePreparation };
  },
};

export const workedExampleBlocks: Block[] = [workedExamplePrepare];
