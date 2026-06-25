/**
 * Assembly — standalone video edit-and-render module.
 *
 * Public surface. Stage 1 (now): the typed Timeline/EDL contract + validator + the
 * self-describing module card. Stages next (behind parity-proof): `planTimeline`
 * (pure brain) and `renderTimeline` (pure idempotent hands) land here.
 */
export {
  TimelineSchema,
  SegmentSchema,
  AudioPlanSchema,
  OverlaySchema,
  FormatSchema,
  ReceiptSchema,
  validateTimeline,
  projectedDurationSec,
} from "./timeline";
export type { Timeline, Segment, AudioPlan, Overlay, Format, Receipt } from "./timeline";
export { ASSEMBLY_MODULE } from "./module";
export {
  planTimeline,
  resolveAssembleParams,
  bodySegSeconds,
  ASSEMBLE_DEFAULTS,
} from "./planTimeline";
export type { PlanInput, AssembleParams } from "./planTimeline";
export { renderTimeline, hashTimeline } from "./renderTimeline";
export type { RenderBackend, CardSpec, RenderOpts } from "./renderTimeline";
