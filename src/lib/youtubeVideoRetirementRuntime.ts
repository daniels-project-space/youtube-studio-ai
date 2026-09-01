import { api } from "../../convex/_generated/api";

const runtimeApi = (api as unknown as {
  readonly youtubeVideoRetirements: {
    readonly createPlanShell: never;
    readonly claimApproval: never;
    readonly getDispatch: never;
    readonly getExecution: never;
    readonly markQueued: never;
    readonly recordFailure: never;
    readonly completeDeletion: never;
  };
}).youtubeVideoRetirements;

export const youtubeVideoRetirementRuntimeApi = runtimeApi;
