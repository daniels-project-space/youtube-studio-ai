/**
 * Executable designer boundary.
 *
 * The deterministic planning algorithm lives in designerCore so read-only web
 * projections do not bundle Trigger/Remotion implementations. Execution and
 * historical callers retain full registered-manifest validation here.
 */
import { registerAllBlocks } from "./blocks";
import {
  designPipelineCore,
  type DesignOptions,
  type DesignResult,
} from "./designerCore";

export * from "./designerCore";

export function designPipeline(opts: DesignOptions): DesignResult {
  registerAllBlocks();
  return designPipelineCore(opts);
}
