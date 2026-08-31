import { api } from "../../convex/_generated/api";
import {
  reviewedLtxRuntimeTarget,
  type ReviewedLtxRuntimeTargetResolution,
} from "@/engine/reviewedLtxRuntimeTarget";

/**
 * Narrow no-codegen bridge for the service-only reviewed LTX registry. The
 * caller receives a derived runtime target, never a browser-controlled GPU or
 * model selection. A later authorized Convex codegen will replace this cast.
 */
const reviewedLtxRuntimeStateApi = (api as unknown as {
  readonly reviewedLtxRuntimeState: {
    readonly listActiveReviewedLtxBenchmarkAdmissions: never;
  };
}).reviewedLtxRuntimeState;

type QueryClient = {
  query(reference: never, args: never): Promise<unknown>;
};

export async function resolveOwnerReviewedLtxRuntime(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<ReviewedLtxRuntimeTargetResolution> {
  const admissions = await input.client.query(
    reviewedLtxRuntimeStateApi.listActiveReviewedLtxBenchmarkAdmissions,
    { ownerId: input.ownerId } as never,
  );
  if (!Array.isArray(admissions)) {
    throw new Error("reviewed LTX runtime registry returned an invalid admission collection");
  }
  return reviewedLtxRuntimeTarget(admissions);
}
