import { api } from "../../convex/_generated/api";

const runtimeApi = (api as unknown as {
  readonly youtubeThumbnailReplacements: {
    readonly createPlanShell: never;
    readonly claimApproval: never;
    readonly getDispatch: never;
    readonly getExecution: never;
    readonly markQueued: never;
    readonly recordFailure: never;
    readonly completeApplication: never;
  };
}).youtubeThumbnailReplacements;

export const youtubeThumbnailReplacementRuntimeApi = runtimeApi;
