import {
  SELF_CONTAINED_STORY_FAMILY_CONTRACTS,
  SelfContainedStoryFamilySchema,
  createSelfContainedStoryPlan,
  type SelfContainedStoryFamily,
  type SelfContainedStoryPlan,
} from "@/engine/selfContainedStoryReceipt";
import type { PipelineEntry } from "@/engine/types";
import { z } from "zod";

/**
 * A native story is planned before its renderer is admitted.  It is deliberately
 * narrower than a renderer: adapters may spend only on bounded text planning,
 * and must return the accepted critique record that will be sealed into the
 * route/topic-bound story receipt by the following block.
 */
export interface CritiquedSelfContainedStory {
  readonly planner: {
    readonly id: string;
    readonly provenance: string;
  };
  readonly critique: {
    readonly accepted: true;
    readonly score: number;
    readonly iterations: number;
    readonly issues: readonly string[];
  };
  readonly story: unknown;
}

export type SelfContainedStoryPlanner = () => Promise<CritiquedSelfContainedStory>;

const PlannedRouteSchema = z.object({
  family: SelfContainedStoryFamilySchema,
  contentLaneKey: z.string().trim().min(1).max(120),
  requiredBlocks: z.array(z.string().trim().min(1).max(120)).min(1).max(24),
  requiredBlockOrder: z.array(z.tuple([
    z.string().trim().min(1).max(120),
    z.string().trim().min(1).max(120),
  ])).max(32),
});

function hasOrder(
  route: z.infer<typeof PlannedRouteSchema>,
  before: string,
  after: string,
): boolean {
  return route.requiredBlockOrder.some(([left, right]) => left === before && right === after);
}

/**
 * Shared route-shape assertion for designer-time composition and runtime
 * planning. A future route therefore cannot choose a native planner under a
 * different lane or renderer than the one that will consume its sealed plan.
 */
export function assertSelfContainedStoryPlanningRoute(routeInput: unknown): {
  readonly route: z.infer<typeof PlannedRouteSchema>;
  readonly contract: (typeof SELF_CONTAINED_STORY_FAMILY_CONTRACTS)[SelfContainedStoryFamily];
} {
  const route = PlannedRouteSchema.parse(routeInput);
  const contract = SELF_CONTAINED_STORY_FAMILY_CONTRACTS[route.family];
  if (route.contentLaneKey !== contract.contentLaneKey) {
    throw new Error(
      `self_contained_story_plan: ${route.family} requires content lane ${contract.contentLaneKey}, received ${route.contentLaneKey}`,
    );
  }
  const required = ["self_contained_story_plan", "self_contained_story", contract.rendererBlockId];
  const missing = required.filter((block) => !route.requiredBlocks.includes(block));
  if (missing.length) {
    throw new Error(
      `self_contained_story_plan: route is missing required native handoff block(s): ${missing.join(", ")}`,
    );
  }
  if (
    !hasOrder(route, "self_contained_story_plan", "self_contained_story")
    || !hasOrder(route, "self_contained_story", contract.rendererBlockId)
  ) {
    throw new Error(
      "self_contained_story_plan: route must order native planning before sealing and sealing before its renderer",
    );
  }
  return { route, contract };
}

/**
 * Insert the bounded native plan and provider-free seal directly before the
 * matching renderer. It is pure composition: route admission remains wholly
 * upstream, while a declared route cannot silently fall back to the old
 * renderer-owned planning branch.
 */
export function materializeSelfContainedStoryPlanningHandoff(args: {
  readonly route: unknown;
  readonly visualEngine: string;
  readonly pipeline: readonly PipelineEntry[];
}): PipelineEntry[] {
  const hasAnyHandoffBlock = args.pipeline.some(
    (entry) => entry.block === "self_contained_story_plan" || entry.block === "self_contained_story",
  );
  const routeShape = PlannedRouteSchema.safeParse(args.route);
  const routeDeclaresHandoff = routeShape.success && routeShape.data.requiredBlocks.some(
    (block) => block === "self_contained_story_plan" || block === "self_contained_story",
  );
  if (!routeDeclaresHandoff && !hasAnyHandoffBlock) return [...args.pipeline];

  const { route, contract } = assertSelfContainedStoryPlanningRoute(args.route);
  if (args.visualEngine !== contract.rendererBlockId) {
    throw new Error(
      `self_contained_story_plan: ${route.family} route requires renderer ${contract.rendererBlockId}, received ${args.visualEngine}`,
    );
  }
  const planIndices = args.pipeline
    .map((entry, index) => entry.block === "self_contained_story_plan" ? index : -1)
    .filter((index) => index >= 0);
  const sealIndices = args.pipeline
    .map((entry, index) => entry.block === "self_contained_story" ? index : -1)
    .filter((index) => index >= 0);
  if (planIndices.length > 1 || sealIndices.length > 1) {
    throw new Error("self_contained_story_plan: a route may materialize exactly one native plan and one seal");
  }
  const rendererIndex = args.pipeline.findIndex((entry) => entry.block === contract.rendererBlockId);
  if (rendererIndex < 0) {
    throw new Error(`self_contained_story_plan: composed pipeline is missing renderer ${contract.rendererBlockId}`);
  }
  if (planIndices.length || sealIndices.length) {
    if (planIndices.length !== 1 || sealIndices.length !== 1) {
      throw new Error("self_contained_story_plan: plan and seal must be materialized together");
    }
    if (!(planIndices[0] < sealIndices[0] && sealIndices[0] < rendererIndex)) {
      throw new Error("self_contained_story_plan: composed plan, seal, and renderer must keep their sealed order");
    }
    return [...args.pipeline];
  }
  const pipeline = [...args.pipeline];
  pipeline.splice(rendererIndex, 0, { block: "self_contained_story_plan" }, { block: "self_contained_story" });
  return pipeline;
}

/**
 * Dispatch exactly one family-native planner only after the route has declared
 * the full plan → seal → matching-renderer handoff. This catches a future
 * composition that would buy a storyboard but omit its only consumer.
 */
export async function produceSelfContainedStoryPlan(args: {
  readonly route: unknown;
  readonly planners: Partial<Record<SelfContainedStoryFamily, SelfContainedStoryPlanner>>;
}): Promise<SelfContainedStoryPlan> {
  const { route } = assertSelfContainedStoryPlanningRoute(args.route);
  const planner = args.planners[route.family];
  if (!planner) {
    throw new Error(`self_contained_story_plan: no registered planner adapter for ${route.family}`);
  }
  const outcome = await planner();
  return createSelfContainedStoryPlan({
    family: route.family,
    planner: outcome.planner,
    critique: outcome.critique,
    story: outcome.story,
  });
}
